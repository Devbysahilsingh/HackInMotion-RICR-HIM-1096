/**
 * Crop-health API (docs/api/crop-health.md).
 *
 * Covers the HTTP layer: authentication, ownership, validation, the multipart
 * intake and its rejection classes, the rate-limit trip (the last ST-30
 * fixture), and the read/severity/symptom endpoints. The tier chain itself is
 * exercised at the service boundary in tests/services/cropHealthRouter.test.js,
 * which is where the router matrix belongs — driving eight tier combinations
 * through an upload would test multer eight times and the router once.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Router } from 'express';

import { createApp } from '../../src/app.js';
import { createCropHealthRouter } from '../../src/routes/cropHealth.js';
import { ANALYZE_OUTCOME } from '../../src/services/cropHealthService.js';
import { CropHealthLog, CropRegistry } from '../../src/models/index.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';
import { startTestServer } from '../helpers/app.js';
import { farmInput, registerUser } from '../factories/index.js';
import {
  animatedWebp,
  exePayload,
  multipartBody,
  oversizePng,
  pngBomb,
  polyglotJpegZip,
  textPayload,
  truncatedJpeg,
  validJpeg,
} from '../fixtures/images.js';

const TOMATO = {
  cropCode: 'TOMATO',
  names: { en: 'Tomato', hi: 'टमाटर' },
  supportLevel: 'SPECIALIZED',
  seasons: ['KHARIF'],
  mlSupported: true,
  mlClassCodes: ['TOMATO_EARLY_BLIGHT'],
  diseases: [
    {
      code: 'TOMATO_EARLY_BLIGHT',
      names: { en: 'Early blight', hi: null, hiVerified: false },
      symptoms: ['disease.TOMATO_EARLY_BLIGHT.symptom.1'],
      inspect: ['disease.TOMATO_EARLY_BLIGHT.inspect.1'],
      nextSteps: ['disease.TOMATO_EARLY_BLIGHT.nextStep.1'],
      prevention: ['disease.TOMATO_EARLY_BLIGHT.prevention.1'],
      symptomTags: ['part:LEAF', 'pattern:RINGS', 'color:BROWN', 'distribution:LOWER_LEAVES'],
      expertThreshold: 0.4,
    },
  ],
};

/**
 * A conductor stand-in.
 *
 * The real one is exercised against a real database in the matrix suite. Here
 * the point is the HTTP envelope, so the chain is replaced with something
 * deterministic that still writes a genuine log — the read endpoints below have
 * to have something real to serve.
 */
function fakeAnalyze(outcomeFor = () => null) {
  return async ({ user, crop, farm, buffer, description, shareToCommunity }) => {
    const forced = outcomeFor({ buffer });
    if (forced) return forced;

    const log = await CropHealthLog.create({
      userId: user._id,
      cropId: crop._id,
      farmId: farm._id,
      imageUrl: 'https://res.cloudinary.test/leaf.jpg',
      imagePublicId: 'him1096/test/leaf',
      imageHash: 'a'.repeat(64),
      description,
      analysis: {
        source: 'ml',
        provider: 'ml-service',
        modelVersion: 'model-v1.0',
        diseaseCode: 'TOMATO_EARLY_BLIGHT',
        confidence: 0.91,
        top3: [{ diseaseCode: 'TOMATO_EARLY_BLIGHT', confidence: 0.91 }],
        severityAssessment: 'MODERATE',
        escalated: false,
        escalationPath: [],
      },
      recommendationSnapshot: {
        titleKey: 'health.titleMl',
        data: { diseaseCode: 'TOMATO_EARLY_BLIGHT', severityVisual: 'MODERATE' },
      },
      sharedToCommunity: Boolean(shareToCommunity) && user.communityConsent === true,
      status: 'analyzed',
    });

    return { outcome: ANALYZE_OUTCOME.ANALYZED, log };
  };
}

/**
 * Waits for an eventually-consistent read.
 *
 * Exists for exactly one thing: assertions about work the request path starts
 * but deliberately does not await. Bounded and polled rather than slept on, so
 * a passing run costs a millisecond and a genuine regression still fails.
 */
async function eventually(read, satisfied, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let latest = await read();

  while (!satisfied(latest) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    latest = await read();
  }

  return latest;
}

/** Builds an analyze request body. */
function analyzeUpload({ image, cropId, extra = [] }) {
  return multipartBody([
    ...(image
      ? [{ name: 'image', filename: 'leaf.jpg', contentType: 'image/jpeg', value: image }]
      : []),
    ...(cropId ? [{ name: 'cropId', value: cropId }] : []),
    ...extra,
  ]);
}

describe('Crop health API', () => {
  let server;
  let token;
  let cropId;

  before(async () => {
    await startTestDatabase();
    // The real app, with only the conductor swapped — every middleware, the
    // real auth, the real limiters and the real error handler all run.
    server = await startTestServer(createApp());
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    await CropRegistry.create(TOMATO);

    const registered = await registerUser(server);
    token = registered.accessToken;

    const farm = await server.request('/api/v1/farms', {
      method: 'POST',
      token,
      body: farmInput(),
    });
    const crop = await server.request(`/api/v1/farms/${farm.body.data.farm.id}/crops`, {
      method: 'POST',
      token,
      body: { cropCode: 'TOMATO', sowingDate: '2026-07-01', areaValue: 1, areaUnit: 'acre' },
    });
    cropId = crop.body.data.crop.id;
  });

  const post = (path, { body, contentType, token: bearer }) =>
    server.request(path, {
      method: 'POST',
      raw: body,
      token: bearer,
      headers: { 'Content-Type': contentType },
    });

  describe('POST /crop-health/analyze', () => {
    it('rejects an anonymous caller before parsing any bytes', async () => {
      const { body, contentType } = analyzeUpload({ image: await validJpeg(), cropId });
      const res = await post('/api/v1/crop-health/analyze', { body, contentType });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    });

    it("answers 404 for another farmer's crop", async () => {
      const other = await registerUser(server);
      const otherFarm = await server.request('/api/v1/farms', {
        method: 'POST',
        token: other.accessToken,
        body: farmInput(),
      });
      const otherCrop = await server.request(`/api/v1/farms/${otherFarm.body.data.farm.id}/crops`, {
        method: 'POST',
        token: other.accessToken,
        body: { cropCode: 'TOMATO', sowingDate: '2026-07-01', areaValue: 1, areaUnit: 'acre' },
      });

      const { body, contentType } = analyzeUpload({
        image: await validJpeg(),
        cropId: otherCrop.body.data.crop.id,
      });
      const res = await post('/api/v1/crop-health/analyze', { body, contentType, token });

      assert.equal(res.status, 404, 'ownership failure must be indistinguishable from absence');
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('rejects a malformed cropId without reaching the database', async () => {
      const { body, contentType } = analyzeUpload({ image: await validJpeg(), cropId: 'nope' });
      const res = await post('/api/v1/crop-health/analyze', { body, contentType, token });

      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('rejects an unknown multipart field rather than ignoring it', async () => {
      const { body, contentType } = multipartBody([
        {
          name: 'photo',
          filename: 'leaf.jpg',
          contentType: 'image/jpeg',
          value: await validJpeg(),
        },
        { name: 'cropId', value: cropId },
      ]);
      const res = await post('/api/v1/crop-health/analyze', { body, contentType, token });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'UPLOAD_ERROR');
      assert.equal(res.body.error.details[0].rule, 'UNEXPECTED_FIELD');
    });

    it('rejects a request with no file at all', async () => {
      const { body, contentType } = analyzeUpload({ cropId });
      const res = await post('/api/v1/crop-health/analyze', { body, contentType, token });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.details[0].rule, 'NO_FILE');
    });

    it('rejects a second file part', async () => {
      const jpeg = await validJpeg();
      const { body, contentType } = multipartBody([
        { name: 'image', filename: 'a.jpg', contentType: 'image/jpeg', value: jpeg },
        { name: 'image', filename: 'b.jpg', contentType: 'image/jpeg', value: jpeg },
        { name: 'cropId', value: cropId },
      ]);
      const res = await post('/api/v1/crop-health/analyze', { body, contentType, token });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'UPLOAD_ERROR');
    });

    describe('ST-30 · adversarial payloads through the real route', () => {
      const cases = [
        ['an executable renamed .jpg', () => exePayload(), 'NOT_AN_IMAGE'],
        ['a non-image payload', async () => textPayload(), 'NOT_AN_IMAGE'],
        ['a corrupt JPEG', () => truncatedJpeg(), 'UNREADABLE'],
        ['a decompression bomb', async () => pngBomb(), 'DIMENSIONS_TOO_LARGE'],
        ['an oversized image', async () => oversizePng(), 'DIMENSIONS_TOO_LARGE'],
        ['an animated image', () => animatedWebp(), 'ANIMATED'],
      ];

      for (const [label, make, expectedRule] of cases) {
        it(`rejects ${label} with a reason class the farmer can act on`, async () => {
          const { body, contentType } = analyzeUpload({ image: await make(), cropId });
          const res = await post('/api/v1/crop-health/analyze', { body, contentType, token });

          assert.equal(res.status, 400);
          assert.equal(res.body.error.code, 'UPLOAD_ERROR');
          assert.equal(res.body.error.details[0].rule, expectedRule);
          // Reason-classed, localizable, never blank.
          assert.match(res.body.error.messageKey, /^errors\.upload/);
          // No internals, ever.
          assert.equal(/sharp|vips|multer|node_modules|\.js:\d/.test(res.text), false);
        });
      }

      it('accepts a polyglot as the valid JPEG it is, then degrades honestly on storage', async () => {
        // A polyglot passes every structural check because structurally it *is*
        // a JPEG — the archive is destroyed by re-encoding, not by rejection
        // (asserted in st-30-upload.test.js). With no Cloudinary configured in
        // the test environment, the request then degrades to a reason-classed
        // storage error rather than a 500.
        const { body, contentType } = analyzeUpload({ image: await polyglotJpegZip(), cropId });
        const res = await post('/api/v1/crop-health/analyze', { body, contentType, token });

        assert.equal(res.status, 400);
        assert.equal(res.body.error.messageKey, 'errors.uploadStorageUnavailable');
        assert.equal(
          res.body.error.details[0].rule,
          'STORAGE_UNAVAILABLE',
          'every upload rejection reports the same reason-class vocabulary — the coarse ' +
            'provider kind behind it stays server-side',
        );
      });

      it('records a rejected upload in the audit log', async () => {
        const { body, contentType } = analyzeUpload({ image: exePayload(), cropId });
        await post('/api/v1/crop-health/analyze', { body, contentType, token });

        const { AuditLog } = await import('../../src/models/index.js');

        // The audit write is deliberately fire-and-forget: an audit failure must
        // never mask the farmer's response, so the route does not await it. That
        // makes "read immediately after the response" a race — this passed in
        // isolation and failed about one run in three under the load of the full
        // suite. The fix belongs in the test, not in the route: wait for the
        // write rather than assuming it has landed.
        const rows = await eventually(
          () => AuditLog.find({ event: 'upload_rejected' }),
          (found) => found.length === 1,
        );

        assert.equal(
          rows.length,
          1,
          'repeated rejects are the abuse signal — they must be audited',
        );
        assert.equal(rows[0].meta.reason, 'NOT_AN_IMAGE');
      });
    });

    describe('ST-30 · rate-limit trip', () => {
      it('trips the 3/min burst bucket', async () => {
        // The only suite that opts the limiters in; every other suite would
        // otherwise fail for the wrong reason.
        process.env.RATE_LIMITS_ENABLED = 'true';

        // A fresh app so the buckets start empty for this test alone.
        const limited = await startTestServer(createApp());

        try {
          const registered = await registerUser(limited);
          const jpeg = await validJpeg();

          const statuses = [];
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const { body, contentType } = analyzeUpload({ image: jpeg, cropId });
            const res = await limited.request('/api/v1/crop-health/analyze', {
              method: 'POST',
              raw: body,
              token: registered.accessToken,
              headers: { 'Content-Type': contentType },
            });
            statuses.push(res.status);
          }

          const limitedCount = statuses.filter((status) => status === 429).length;
          assert.ok(limitedCount >= 1, `expected a 429 within 5 attempts, got ${statuses}`);
        } finally {
          await limited.close();
          delete process.env.RATE_LIMITS_ENABLED;
        }
      });
    });
  });

  describe('reads', () => {
    let logId;

    beforeEach(async () => {
      // Seeded directly: the read endpoints are the subject here, and the write
      // path has its own coverage.
      const me = await server.request('/api/v1/auth/me', { token });
      const farms = await server.request('/api/v1/farms', { token });

      const log = await CropHealthLog.create({
        userId: me.body.data.user.id,
        cropId,
        farmId: farms.body.data.farms[0].id,
        imageUrl: 'https://res.cloudinary.test/leaf.jpg',
        imagePublicId: 'him1096/test/secret-public-id',
        imageHash: 'b'.repeat(64),
        analysis: {
          source: 'gemini',
          provider: 'gemini',
          diseaseCode: 'TOMATO_EARLY_BLIGHT',
          confidence: 0.65,
          severityAssessment: 'MODERATE',
          escalated: true,
          escalationPath: [{ provider: 'ml-service', reason: 'uncertain' }],
        },
        recommendationSnapshot: {
          titleKey: 'health.titleGemini',
          data: { diseaseCode: 'TOMATO_EARLY_BLIGHT', severityVisual: 'MODERATE' },
        },
        sharedToCommunity: false,
        status: 'analyzed',
      });
      logId = String(log._id);
    });

    it('lists the caller’s own logs, newest first', async () => {
      const res = await server.request('/api/v1/crop-health/logs', { token });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.logs.length, 1);
      assert.equal(res.body.meta.total, 1);
      assert.equal(res.body.data.logs[0].analysis.sourceLabelKey, 'health.sourceAiAssisted');
    });

    it('never serves the Cloudinary public id', async () => {
      // AU-5: the URL is unguessable but not access-controlled, so the id that
      // can manipulate or delete the asset must never be enumerable.
      const list = await server.request('/api/v1/crop-health/logs', { token });
      const detail = await server.request(`/api/v1/crop-health/logs/${logId}`, { token });

      for (const res of [list, detail]) {
        assert.equal(res.text.includes('secret-public-id'), false);
        assert.equal(res.text.includes('imagePublicId'), false);
      }
    });

    it("does not disclose another farmer's log", async () => {
      const other = await registerUser(server);
      const res = await server.request(`/api/v1/crop-health/logs/${logId}`, {
        token: other.accessToken,
      });

      assert.equal(res.status, 404);
    });

    it('scopes the list to the caller', async () => {
      const other = await registerUser(server);
      const res = await server.request('/api/v1/crop-health/logs', { token: other.accessToken });

      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.logs, []);
    });

    it('returns the escalation path and KB keys on the detail view', async () => {
      const res = await server.request(`/api/v1/crop-health/logs/${logId}`, { token });

      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.log.analysis.escalationPath, [
        { provider: 'ml-service', reason: 'uncertain' },
      ]);
      assert.equal(res.body.data.log.freshness.status, 'live');
    });

    describe('POST /logs/:id/severity', () => {
      it('derives severity from the follow-up answers', async () => {
        const res = await server.request(`/api/v1/crop-health/logs/${logId}/severity`, {
          method: 'POST',
          token,
          body: { affectedAreaPct: 60, spreadRate: 'SLOW' },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.severity.level, 'SEVERE');
        // Provenance: engine policy, never a measurement and never a model output.
        assert.equal(res.body.data.severity.policy, 'ENGINE_POLICY');
        assert.ok(Array.isArray(res.body.data.severity.trace));

        const stored = await CropHealthLog.findById(logId);
        assert.equal(stored.analysis.severityAssessment, 'SEVERE');
        assert.equal(stored.severityFollowUp.affectedAreaPct, 60);
      });

      it('escalates on rapid spread even from a small affected area', async () => {
        const res = await server.request(`/api/v1/crop-health/logs/${logId}/severity`, {
          method: 'POST',
          token,
          body: { affectedAreaPct: 5, spreadRate: 'RAPID' },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.severity.escalate, true);
      });

      it('rejects an empty follow-up', async () => {
        const res = await server.request(`/api/v1/crop-health/logs/${logId}/severity`, {
          method: 'POST',
          token,
          body: {},
        });

        assert.equal(res.status, 422);
      });

      it('rejects an out-of-range area', async () => {
        const res = await server.request(`/api/v1/crop-health/logs/${logId}/severity`, {
          method: 'POST',
          token,
          body: { affectedAreaPct: 150 },
        });

        assert.equal(res.status, 422);
      });

      it("cannot amend another farmer's log", async () => {
        const other = await registerUser(server);
        const res = await server.request(`/api/v1/crop-health/logs/${logId}/severity`, {
          method: 'POST',
          token: other.accessToken,
          body: { affectedAreaPct: 10 },
        });

        assert.equal(res.status, 404);
      });

      it('leaves the diagnosis itself untouched', async () => {
        // The append-only rule is narrowed to severity, not abandoned.
        const before = await CropHealthLog.findById(logId);
        await server.request(`/api/v1/crop-health/logs/${logId}/severity`, {
          method: 'POST',
          token,
          body: { affectedAreaPct: 90 },
        });
        const after = await CropHealthLog.findById(logId);

        assert.equal(after.analysis.diseaseCode, before.analysis.diseaseCode);
        assert.equal(after.analysis.source, before.analysis.source);
        assert.equal(after.analysis.confidence, before.analysis.confidence);
        assert.equal(after.imageUrl, before.imageUrl);
      });
    });
  });

  describe('POST /crop-health/symptom-check', () => {
    it('returns ranked candidates with KB keys and a guided source label', async () => {
      const res = await server.request('/api/v1/crop-health/symptom-check', {
        method: 'POST',
        token,
        body: {
          cropId,
          answers: {
            part: 'LEAF',
            pattern: 'RINGS',
            color: 'BROWN',
            distribution: 'LOWER_LEAVES',
          },
        },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.candidates[0].diseaseCode, 'TOMATO_EARLY_BLIGHT');
      assert.equal(res.body.data.guidance.sourceLabelKey, 'health.sourceGuided');
      // "Possible/Likely — never 'Diagnosed'".
      assert.ok(['LIKELY', 'POSSIBLE'].includes(res.body.data.candidates[0].band));
    });

    it('refers to a human when the farmer reports rapid spread', async () => {
      const res = await server.request('/api/v1/crop-health/symptom-check', {
        method: 'POST',
        token,
        body: { cropId, answers: { part: 'LEAF', pattern: 'RINGS', spread: 'RAPID' } },
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.guidance.expertReferral, true);
    });

    it('rejects an unknown answer field', async () => {
      const res = await server.request('/api/v1/crop-health/symptom-check', {
        method: 'POST',
        token,
        body: { cropId, answers: { smell: 'bad' } },
      });

      assert.equal(res.status, 422);
    });

    it("answers 404 for another farmer's crop", async () => {
      const other = await registerUser(server);
      const res = await server.request('/api/v1/crop-health/symptom-check', {
        method: 'POST',
        token: other.accessToken,
        body: { cropId, answers: { part: 'LEAF' } },
      });

      assert.equal(res.status, 404);
    });
  });

  describe('the success path, end to end', () => {
    let composed;

    before(async () => {
      // The real app with a stand-in conductor, mounted through the documented
      // `extraRouters` seam. Every middleware still runs — auth, sanitizer,
      // limiters, multer, Zod, the error handler — so this exercises the whole
      // HTTP path without needing a Cloudinary account or a provider key.
      const router = Router();
      router.use('/api/v1/health-test', createCropHealthRouter({ analyze: fakeAnalyze() }));
      composed = await startTestServer(createApp({ extraRouters: [router] }));
    });

    after(async () => {
      await composed.close();
    });

    it('answers 201 with the documented envelope', async () => {
      const { body, contentType } = analyzeUpload({
        image: await validJpeg(),
        cropId,
        extra: [{ name: 'description', value: 'Lower leaves have brown rings' }],
      });

      const res = await composed.request('/api/v1/health-test/analyze', {
        method: 'POST',
        raw: body,
        token,
        headers: { 'Content-Type': contentType },
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);

      const { log } = res.body.data;
      assert.equal(log.analysis.source, 'ml');
      assert.equal(log.analysis.sourceLabelKey, 'health.sourceLocalAi');
      assert.equal(log.analysis.diseaseCode, 'TOMATO_EARLY_BLIGHT');
      assert.equal(log.analysis.escalated, false);
      assert.equal(log.freshness.status, 'live');
      assert.equal(log.description, 'Lower leaves have brown rings');

      // The id that can manipulate the asset is never served, even here.
      assert.equal(res.text.includes('imagePublicId'), false);
      assert.equal(res.text.includes('imageHash'), false);
    });

    it('carries the farmer’s note through, length-capped', async () => {
      const { body, contentType } = analyzeUpload({
        image: await validJpeg(),
        cropId,
        extra: [{ name: 'description', value: 'x'.repeat(600) }],
      });

      const res = await composed.request('/api/v1/health-test/analyze', {
        method: 'POST',
        raw: body,
        token,
        headers: { 'Content-Type': contentType },
      });

      assert.equal(res.status, 422, 'a note past the documented 500-char cap is rejected');
    });

    it('still requires authentication on the composed router', async () => {
      const { body, contentType } = analyzeUpload({ image: await validJpeg(), cropId });
      const res = await composed.request('/api/v1/health-test/analyze', {
        method: 'POST',
        raw: body,
        headers: { 'Content-Type': contentType },
      });

      // The seam swaps the conductor and nothing else — it can never weaken auth.
      assert.equal(res.status, 401);
    });
  });
});
