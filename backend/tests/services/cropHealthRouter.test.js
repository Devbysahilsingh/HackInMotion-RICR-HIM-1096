/**
 * The tier-router matrix.
 *
 * docs/testing/api-testing.md: "health analyze = tier-router matrix (**8
 * combinations** of ML/Gemini/rules availability × confidence) asserting source
 * labels + escalation flags".
 *
 * The chain is exercised at the service boundary with every tier injected,
 * which is what makes the matrix meaningful: each row states exactly what each
 * tier did, and asserts the stored `source`, `escalated` flag and escalation
 * path. Driving it over HTTP would add an upload and an auth round-trip to
 * every row without testing anything the API suite does not already cover.
 *
 * The database is real (mongodb-memory-server) because the outcome of a row is
 * the persisted log, not a return value.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { HEALTH_SOURCES, UNKNOWN_DISEASE_CODE } from '../../src/config/constants.js';
import { analyzeCropHealth, ANALYZE_OUTCOME } from '../../src/services/cropHealthService.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';
import { validJpeg } from '../fixtures/images.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DISEASE = {
  code: 'TOMATO_EARLY_BLIGHT',
  names: { en: 'Early blight', hi: 'अगेती झुलसा' },
  symptoms: ['disease.TOMATO_EARLY_BLIGHT.symptom.1'],
  inspect: ['disease.TOMATO_EARLY_BLIGHT.inspect.1'],
  nextSteps: ['disease.TOMATO_EARLY_BLIGHT.nextStep.1'],
  prevention: ['disease.TOMATO_EARLY_BLIGHT.prevention.1'],
  symptomTags: ['part:LEAF', 'pattern:RINGS', 'color:BROWN', 'distribution:LOWER_LEAVES'],
  expertThreshold: 0.4,
  sourceRefs: [],
};

const registryCrop = (supportLevel) => ({
  cropCode: 'TOMATO',
  names: { en: 'Tomato', hi: 'टमाटर' },
  supportLevel,
  mlSupported: supportLevel === 'SPECIALIZED',
  mlClassCodes: ['TOMATO_EARLY_BLIGHT', 'TOMATO_HEALTHY'],
  diseases: [DISEASE],
});

/** A well-formed provider reply, as `analyzeWithFallback` would return it. */
const aiAnswer = (overrides = {}) => ({
  ok: true,
  provider: 'gemini',
  imageAssessment: 'OK',
  diseaseCode: 'TOMATO_EARLY_BLIGHT',
  confidence: 0.65,
  confidenceBand: 'MEDIUM',
  visualFindings: ['Brown concentric rings on lower leaves'],
  severityVisual: 'MODERATE',
  affectedParts: ['LEAF'],
  coerced: false,
  attempts: [],
  ...overrides,
});

const mlAnswer = (overrides = {}) => ({
  ok: true,
  uncertain: false,
  diseaseCode: 'TOMATO_EARLY_BLIGHT',
  confidence: 0.91,
  top3: [{ diseaseCode: 'TOMATO_EARLY_BLIGHT', confidence: 0.91 }],
  cropMismatch: false,
  modelVersion: 'model-v1.0',
  ...overrides,
});

/** Storage always succeeds in this matrix — storage failure is an ST-30 case. */
const store = async () => ({
  ok: true,
  url: 'https://res.cloudinary.test/leaf.jpg',
  publicId: 'him1096/test/leaf',
  bytes: 1234,
});

describe('P3-6 · tier-router matrix', () => {
  let jpeg;
  let user;
  let crop;
  let farm;

  before(async () => {
    await startTestDatabase();
    jpeg = await validJpeg();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();

    // Plain objects with the fields the conductor reads. The ownership layer
    // that produces the real ones is covered by ST-10 and the API suite.
    const userId = new mongoose.Types.ObjectId();
    user = { _id: userId, communityConsent: false };
    farm = { _id: new mongoose.Types.ObjectId(), location: { state: 'Maharashtra' } };
    crop = { _id: new mongoose.Types.ObjectId(), cropCode: 'TOMATO', season: 'KHARIF' };
  });

  /**
   * @param {object} row
   * @param {string} row.supportLevel
   * @param {object|null} row.ml        the ml-service reply, or null for "not called"
   * @param {object} row.ai             what the AI walk returns
   */
  const run = ({ supportLevel, ml, ai }) =>
    analyzeCropHealth({
      user,
      crop,
      farm,
      registryCrop: registryCrop(supportLevel),
      buffer: jpeg,
      deps: {
        store,
        mlPredict: async () => ml,
        aiWalk: async () => ai,
      },
    });

  // ── The 8 combinations ─────────────────────────────────────────────────────

  const MATRIX = [
    {
      name: '1 · SPECIALIZED · ML answers confidently',
      supportLevel: 'SPECIALIZED',
      ml: mlAnswer(),
      ai: { ok: false, reason: 'should_not_be_called', attempts: [] },
      expect: {
        source: HEALTH_SOURCES.ML,
        escalated: false,
        diseaseCode: 'TOMATO_EARLY_BLIGHT',
        modelVersion: 'model-v1.0',
        escalationPath: [],
      },
    },
    {
      name: '2 · SPECIALIZED · ML uncertain → Gemini answers',
      supportLevel: 'SPECIALIZED',
      ml: mlAnswer({ uncertain: true, diseaseCode: null, confidence: null }),
      ai: aiAnswer(),
      expect: {
        source: HEALTH_SOURCES.GEMINI,
        escalated: true,
        diseaseCode: 'TOMATO_EARLY_BLIGHT',
        escalationPath: [{ provider: 'ml-service', reason: 'uncertain' }],
      },
    },
    {
      name: '3 · SPECIALIZED · ML uncertain · Gemini down → OpenRouter answers',
      supportLevel: 'SPECIALIZED',
      ml: mlAnswer({ uncertain: true, diseaseCode: null, confidence: null }),
      ai: aiAnswer({
        provider: 'openrouter',
        attempts: [{ provider: 'gemini', reason: 'http_status', status: 503 }],
      }),
      expect: {
        source: HEALTH_SOURCES.GEMINI,
        provider: 'openrouter',
        escalated: true,
        escalationPath: [
          { provider: 'ml-service', reason: 'uncertain' },
          { provider: 'gemini', reason: 'http_status' },
        ],
      },
    },
    {
      name: '4 · SPECIALIZED · ML uncertain · every AI tier exhausted → rules',
      supportLevel: 'SPECIALIZED',
      ml: mlAnswer({ uncertain: true, diseaseCode: null, confidence: null }),
      ai: {
        ok: false,
        reason: 'ai_tiers_exhausted',
        attempts: [
          { provider: 'gemini', reason: 'timeout' },
          { provider: 'openrouter', reason: 'not_configured' },
        ],
      },
      expect: {
        source: HEALTH_SOURCES.RULES,
        escalated: true,
        escalationPath: [
          { provider: 'ml-service', reason: 'uncertain' },
          { provider: 'gemini', reason: 'timeout' },
          { provider: 'openrouter', reason: 'not_configured' },
        ],
      },
    },
    {
      name: '5 · SPECIALIZED · ML down → Gemini answers',
      supportLevel: 'SPECIALIZED',
      ml: { ok: false, reason: 'network' },
      ai: aiAnswer(),
      expect: {
        source: HEALTH_SOURCES.GEMINI,
        escalated: true,
        escalationPath: [{ provider: 'ml-service', reason: 'network' }],
      },
    },
    {
      name: '6 · SPECIALIZED · ML down · all AI down → rules',
      supportLevel: 'SPECIALIZED',
      ml: { ok: false, reason: 'disabled' },
      ai: {
        ok: false,
        reason: 'ai_tiers_exhausted',
        attempts: [{ provider: 'gemini', reason: 'disabled' }],
      },
      expect: {
        source: HEALTH_SOURCES.RULES,
        escalated: true,
        escalationPath: [
          { provider: 'ml-service', reason: 'disabled' },
          { provider: 'gemini', reason: 'disabled' },
        ],
      },
    },
    {
      name: '7 · GENERAL · Gemini is primary, so answering is not an escalation',
      supportLevel: 'GENERAL',
      ml: null,
      ai: aiAnswer(),
      expect: {
        source: HEALTH_SOURCES.GEMINI,
        escalated: false,
        escalationPath: [],
      },
    },
    {
      name: '8 · LIMITED · rules only, no AI tier is consulted at all',
      supportLevel: 'LIMITED',
      ml: null,
      ai: { ok: false, reason: 'should_not_be_called', attempts: [] },
      expect: {
        source: HEALTH_SOURCES.RULES,
        escalated: false,
        escalationPath: [],
      },
    },
  ];

  for (const row of MATRIX) {
    it(row.name, async () => {
      const result = await run(row);

      assert.equal(result.outcome, ANALYZE_OUTCOME.ANALYZED);

      const { analysis } = result.log;

      assert.equal(analysis.source, row.expect.source, 'stored source label');
      assert.equal(analysis.escalated, row.expect.escalated, 'escalation flag');

      if (row.expect.provider) assert.equal(analysis.provider, row.expect.provider);
      if (row.expect.diseaseCode) assert.equal(analysis.diseaseCode, row.expect.diseaseCode);
      if (row.expect.modelVersion) assert.equal(analysis.modelVersion, row.expect.modelVersion);

      // The escalation path is the honesty record: every tier that declined,
      // in order, with why. Compared on (provider, reason) so an added
      // diagnostic field cannot silently break the matrix.
      assert.deepEqual(
        analysis.escalationPath.map(({ provider, reason }) => ({ provider, reason })),
        row.expect.escalationPath,
      );
    });
  }

  it('covers exactly the eight documented combinations', () => {
    assert.equal(MATRIX.length, 8);
  });

  // ── Invariants the matrix exists to protect ────────────────────────────────

  describe('a low-confidence answer never becomes a confident diagnosis', () => {
    it('never serves an uncertain model prediction, however high its number', async () => {
      // The dangerous shape: the service flagged uncertainty (a margin guard or
      // the healthy rule) while still reporting a high top-1 probability. A
      // conductor that re-derived the gate from `confidence` would serve it.
      const result = await run({
        supportLevel: 'SPECIALIZED',
        ml: mlAnswer({ uncertain: true, confidence: 0.97 }),
        ai: { ok: false, reason: 'ai_tiers_exhausted', attempts: [] },
      });

      assert.equal(result.log.analysis.source, HEALTH_SOURCES.RULES);
      assert.notEqual(result.log.analysis.confidence, 0.97);
    });

    it('does not use a disease code when the image is not of a plant', async () => {
      const result = await run({
        supportLevel: 'GENERAL',
        ml: null,
        ai: aiAnswer({
          imageAssessment: 'NOT_A_PLANT',
          diseaseCode: UNKNOWN_DISEASE_CODE,
          coerced: true,
        }),
      });

      assert.equal(result.log.analysis.diseaseCode, UNKNOWN_DISEASE_CODE);
      assert.equal(
        result.log.analysis.confidence ?? null,
        null,
        'a band from a discarded answer must not be stored as confidence in the result',
      );
    });

    it('does not fabricate severity for an unknown diagnosis', async () => {
      const result = await run({
        supportLevel: 'GENERAL',
        ml: null,
        ai: aiAnswer({
          diseaseCode: UNKNOWN_DISEASE_CODE,
          severityVisual: 'SEVERE',
          coerced: true,
        }),
      });

      assert.equal(
        result.log.analysis.severityAssessment,
        'NOT_ASSESSED',
        'a model saying SEVERE about a condition it could not name must not produce a severity',
      );
    });

    it('does not grade a healthy result as mildly diseased', async () => {
      const result = await run({
        supportLevel: 'SPECIALIZED',
        ml: mlAnswer({ diseaseCode: 'TOMATO_HEALTHY' }),
        ai: { ok: false, reason: 'unused', attempts: [] },
      });

      assert.equal(result.log.analysis.severityAssessment, 'NOT_ASSESSED');
    });
  });

  describe('guidance comes from the KB, never from the model', () => {
    it('renders only registry i18n keys, and attributes AI text separately', async () => {
      const result = await run({
        supportLevel: 'GENERAL',
        ml: null,
        ai: aiAnswer(),
      });

      const { data } = result.log.recommendationSnapshot;

      assert.deepEqual(data.nextStepKeys, DISEASE.nextSteps);
      assert.deepEqual(data.symptomKeys, DISEASE.symptoms);
      assert.deepEqual(data.preventionKeys, DISEASE.prevention);

      // The model's prose survives only under its own attributed field.
      assert.deepEqual(data.aiObservations, ['Brown concentric rings on lower leaves']);

      // No guidance field may contain prose. Keys are dotted identifiers.
      for (const key of [...data.nextStepKeys, ...data.symptomKeys, ...data.preventionKeys]) {
        assert.match(key, /^[\w.]+$/, `guidance must be an i18n key, got: ${key}`);
      }
    });

    it('carries no guidance keys when the KB has no entry for the code', async () => {
      // The honest outcome for a diagnosis with no reviewed guidance behind it:
      // empty arrays, not invented text.
      const result = await analyzeCropHealth({
        user,
        crop,
        farm,
        registryCrop: { ...registryCrop('GENERAL'), diseases: [] },
        buffer: jpeg,
        deps: {
          store,
          mlPredict: async () => null,
          aiWalk: async () => aiAnswer({ diseaseCode: UNKNOWN_DISEASE_CODE, coerced: true }),
        },
      });

      const { data } = result.log.recommendationSnapshot;
      assert.deepEqual(data.nextStepKeys, []);
      assert.deepEqual(data.symptomKeys, []);
    });
  });

  describe('the image-hash cache', () => {
    it('serves an identical re-upload without spending provider quota', async () => {
      let mlCalls = 0;
      let aiCalls = 0;

      const deps = {
        store,
        mlPredict: async () => {
          mlCalls += 1;
          return mlAnswer();
        },
        aiWalk: async () => {
          aiCalls += 1;
          return aiAnswer();
        },
      };

      const args = {
        user,
        crop,
        farm,
        registryCrop: registryCrop('SPECIALIZED'),
        buffer: jpeg,
        deps,
      };

      const first = await analyzeCropHealth(args);
      const second = await analyzeCropHealth(args);

      assert.equal(first.outcome, ANALYZE_OUTCOME.ANALYZED);
      assert.equal(second.outcome, ANALYZE_OUTCOME.CACHED);
      assert.equal(String(second.log._id), String(first.log._id), 'the same log is returned');
      assert.equal(mlCalls, 1, 'the second upload must not reach the model');
      assert.equal(aiCalls, 0);
    });

    it('never serves one farmer a cache entry created by another', async () => {
      // The whole reason the key is scoped to userId. A global image-hash cache
      // would answer B's request with A's analysis and would disclose that
      // someone else uploaded the same photograph (AU-1).
      const deps = { store, mlPredict: async () => mlAnswer(), aiWalk: async () => aiAnswer() };
      const base = { crop, farm, registryCrop: registryCrop('SPECIALIZED'), buffer: jpeg, deps };

      await analyzeCropHealth({ ...base, user });

      const other = { _id: new mongoose.Types.ObjectId(), communityConsent: false };
      const result = await analyzeCropHealth({ ...base, user: other });

      assert.equal(result.outcome, ANALYZE_OUTCOME.ANALYZED, 'must re-analyse, not hit the cache');
      assert.equal(String(result.log.userId), String(other._id));
    });

    it('does not reuse an analysis across different crops', async () => {
      // The same leaf declared as a different crop is a different question:
      // the allowed code list and the routing both change.
      const deps = { store, mlPredict: async () => mlAnswer(), aiWalk: async () => aiAnswer() };
      const base = { user, farm, registryCrop: registryCrop('SPECIALIZED'), buffer: jpeg, deps };

      await analyzeCropHealth({ ...base, crop });

      const otherCrop = { _id: new mongoose.Types.ObjectId(), cropCode: 'POTATO' };
      const result = await analyzeCropHealth({ ...base, crop: otherCrop });

      assert.equal(result.outcome, ANALYZE_OUTCOME.ANALYZED);
    });
  });

  describe('the E2E budget', () => {
    it('skips a tier that has no time left rather than overrunning', async () => {
      let mlCalled = false;

      const result = await analyzeCropHealth({
        user,
        crop,
        farm,
        registryCrop: registryCrop('SPECIALIZED'),
        buffer: jpeg,
        deps: {
          store,
          // The budget is already spent by the time routing begins.
          budgetMs: 0,
          mlPredict: async () => {
            mlCalled = true;
            return mlAnswer();
          },
          aiWalk: async () => ({ ok: false, reason: 'ai_tiers_exhausted', attempts: [] }),
        },
      });

      assert.equal(mlCalled, false, 'a hop with no budget must not be started');
      assert.equal(result.log.analysis.source, HEALTH_SOURCES.RULES);
      assert.deepEqual(
        result.log.analysis.escalationPath.map((hop) => hop.reason),
        ['deadline_exhausted'],
      );
    });
  });

  describe('community sharing', () => {
    it('requires both the per-request opt-in and standing account consent', async () => {
      const deps = { store, mlPredict: async () => mlAnswer(), aiWalk: async () => aiAnswer() };
      const base = { crop, farm, registryCrop: registryCrop('SPECIALIZED'), deps };

      // Opted in on the request, but the account has never consented.
      const withoutConsent = await analyzeCropHealth({
        ...base,
        user,
        buffer: jpeg,
        shareToCommunity: true,
      });
      assert.equal(withoutConsent.log.sharedToCommunity, false);

      // Consenting account, but the farmer did not tick this photo.
      const consenting = { _id: new mongoose.Types.ObjectId(), communityConsent: true };
      const withoutOptIn = await analyzeCropHealth({
        ...base,
        user: consenting,
        buffer: jpeg,
        shareToCommunity: false,
      });
      assert.equal(withoutOptIn.log.sharedToCommunity, false);

      const shared = await analyzeCropHealth({
        ...base,
        user: consenting,
        crop: { _id: new mongoose.Types.ObjectId(), cropCode: 'TOMATO' },
        buffer: jpeg,
        shareToCommunity: true,
      });
      assert.equal(shared.log.sharedToCommunity, true);
    });
  });

  describe('failure cleanup', () => {
    it('destroys the stored image when a later step throws', async () => {
      const destroyed = [];

      await assert.rejects(() =>
        analyzeCropHealth({
          user,
          crop,
          farm,
          registryCrop: registryCrop('SPECIALIZED'),
          buffer: jpeg,
          deps: {
            store,
            destroy: async (publicId) => {
              destroyed.push(publicId);
              return { ok: true };
            },
            mlPredict: async () => {
              throw new Error('unexpected fault after storage');
            },
            aiWalk: async () => aiAnswer(),
          },
        }),
      );

      assert.deepEqual(
        destroyed,
        ['him1096/test/leaf'],
        'an orphaned asset must not be left in the account',
      );
    });

    it('still surfaces the original error when cleanup itself fails', async () => {
      // A cleanup failure must not replace the real fault with a storage one —
      // that would send an operator looking in the wrong place entirely.
      await assert.rejects(
        () =>
          analyzeCropHealth({
            user,
            crop,
            farm,
            registryCrop: registryCrop('SPECIALIZED'),
            buffer: jpeg,
            deps: {
              store,
              destroy: async () => {
                throw new Error('cleanup also failed');
              },
              mlPredict: async () => {
                throw new Error('the original fault');
              },
              aiWalk: async () => aiAnswer(),
            },
          }),
        /the original fault/,
      );
    });
  });
});
