/**
 * Fertilizer guidance (docs/api/intelligence.md:
 * "GET /crops/:id/fertilizer-guidance | Auth | → current-stage card + full
 *  schedule + deficiency symptoms + sources + disclaimer. Pure registry read.").
 *
 * docs/fertilizer/fertilizer-intelligence.md §Testing names three tests
 * verbatim, and this file is their implementation:
 *   · "Snapshot tests: each crop×stage renders expected guidanceKey + sourceRef"
 *   · "unit-preservation test (per-acre sources never silently become per-ha)"
 *   · "disclaimer presence test on every response"
 *
 * Every expected value is READ FROM `backend/src/knowledge/crops.fertilizer.json`
 * at test time rather than retyped: a snapshot test that hard-codes a dose is a
 * second, unsourced copy of a published number, which is exactly what the
 * knowledge file's own rules forbid. The registry is seeded through the real
 * seed service, so what is asserted is what the demo will serve.
 *
 * `asOf` is passed explicitly wherever the current-stage highlight is under
 * test — there are no fake timers here.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CropRegistry, SeedMeta } from '../../src/models/index.js';
import {
  DISCLAIMER_KEY,
  fertilizerGuidance,
  parseTiming,
} from '../../src/services/fertilizerService.js';
import { applyRegistrySeed } from '../../src/services/registrySeedRunner.js';
import { composeRegistry, registryVersion } from '../../src/services/registrySeedService.js';
import { farmInput, registerUser } from '../factories/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

/** The knowledge file is the source of truth for every expectation below. */
const KNOWLEDGE = JSON.parse(
  readFileSync(new URL('../../src/knowledge/crops.fertilizer.json', import.meta.url), 'utf8'),
);

const I18N = fileURLToPath(new URL('../../../shared/i18n/', import.meta.url));
const loadFertilizerStrings = (language) => {
  const file = path.join(I18N, language, 'fertilizer.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

// ── parseTiming · pure, no database ─────────────────────────────────────────

describe('parseTiming · reads the published timing string, and nothing more', () => {
  it('parses a point timing in days after sowing', () => {
    assert.deepEqual(parseTiming('25 DAS'), { fromDay: 25, toDay: 25, basis: '25 DAS' });
  });

  it('parses a range written with an en dash', () => {
    // The knowledge file transcribes TNAU's cotton timing as "40–45 DAS" with a
    // typographic en dash, so the dash character itself is load-bearing.
    assert.deepEqual(parseTiming('40–45 DAS'), { fromDay: 40, toDay: 45, basis: '40–45 DAS' });
  });

  it('parses a range written with a plain hyphen too', () => {
    assert.deepEqual(parseTiming('60-65 DAS'), { fromDay: 60, toDay: 65, basis: '60-65 DAS' });
  });

  it('parses the bare-day form used by the vegetable schedules', () => {
    assert.deepEqual(parseTiming('30 d'), { fromDay: 30, toDay: 30, basis: '30 d' });
  });

  it('parses DAP as a day count, exactly as the onion row publishes it', () => {
    // Gap F7b: "30 DAP" is ambiguous in the source (days-after-planting vs the
    // fertiliser di-ammonium phosphate). It is read as a day count and the
    // ambiguity stays recorded in the knowledge file, not resolved here.
    assert.deepEqual(parseTiming('30 DAP'), { fromDay: 30, toDay: 30, basis: '30 DAP' });
  });

  it('parses "at sowing" as day zero', () => {
    assert.deepEqual(parseTiming('at sowing'), { fromDay: 0, toDay: 0, basis: 'at sowing' });
  });

  it('returns null for a published timing that is real but not a day number', () => {
    // PAU's wheat schedule is written against irrigations, not days. It is not
    // discarded — it simply is not highlighted.
    assert.equal(parseTiming('before 1st irrigation'), null);
    assert.equal(parseTiming('before 2nd irrigation'), null);
  });

  it('returns null for an absent timing rather than guessing one', () => {
    for (const timing of [null, undefined, '', '   ', 42, {}, ['25 DAS']]) {
      assert.equal(parseTiming(timing), null, `accepted ${JSON.stringify(timing)}`);
    }
  });

  it('is case-insensitive about the published unit', () => {
    assert.deepEqual(parseTiming('25 das'), { fromDay: 25, toDay: 25, basis: '25 das' });
  });

  it('parses every timing string the knowledge file actually publishes, or null', () => {
    for (const crop of Object.values(KNOWLEDGE.crops)) {
      for (const recommendation of crop.recommendations) {
        for (const entry of recommendation.schedule ?? []) {
          const window = parseTiming(entry.timing);
          if (window === null) continue;
          assert.ok(Number.isInteger(window.fromDay), `${entry.timing} → non-integer fromDay`);
          assert.ok(window.toDay >= window.fromDay, `${entry.timing} → inverted window`);
          assert.equal(window.basis, entry.timing);
        }
      }
    }
  });
});

// ── fractionKey i18n coverage ───────────────────────────────────────────────

describe('fertilizer · every published fractionKey has en and hi strings', () => {
  /**
   * The generic message-key scanner (tests/i18n/message-keys.test.js) reads
   * source files, so it cannot see these keys at all: they live in DATA. An
   * unrendered fractionKey shows a farmer a raw identifier next to a nutrient
   * dose, which is the highest-harm surface in the product.
   */
  const fractionKeys = [
    ...new Set(
      Object.values(KNOWLEDGE.crops).flatMap((crop) =>
        crop.recommendations.flatMap((recommendation) =>
          (recommendation.schedule ?? []).map((entry) => entry.fractionKey),
        ),
      ),
    ),
  ].sort();

  it('finds the keys — the collector is not silently empty', () => {
    assert.ok(fractionKeys.length > 0, 'no fractionKeys were collected from the knowledge file');
    for (const key of fractionKeys) {
      assert.match(key, /^fertilizer\./, `${key} is outside the fertilizer namespace`);
    }
  });

  for (const language of ['en', 'hi']) {
    it(`resolves every fractionKey in ${language}`, () => {
      const strings = loadFertilizerStrings(language);
      assert.ok(strings, `${language}/fertilizer.json is missing`);

      const missing = fractionKeys.filter(
        (key) => strings[key.replace(/^fertilizer\./, '')] === undefined,
      );
      assert.deepEqual(missing, [], `missing ${language} strings: ${missing.join(', ')}`);
    });
  }

  it('resolves the response’s own unconditional keys in both languages', () => {
    for (const language of ['en', 'hi']) {
      const strings = loadFertilizerStrings(language);
      for (const key of [
        DISCLAIMER_KEY,
        'fertilizer.notCovered',
        'fertilizer.typeGeneralNoSoilTest',
        'fertilizer.verificationPending',
        'fertilizer.limitations',
        'fertilizer.soilTestCta',
      ]) {
        assert.ok(
          strings[key.replace(/^fertilizer\./, '')] !== undefined,
          `${language}: ${key} does not resolve`,
        );
      }
    }
  });
});

// ── The endpoint ────────────────────────────────────────────────────────────

describe('Fertilizer guidance API', () => {
  let server;
  let alice;
  let bob;
  let farmId;
  /** cropCode → crop instance id, for the caller's own farm. */
  const cropIds = new Map();

  const SEEDED_CROPS = ['RICE', 'WHEAT', 'COTTON', 'ONION', 'SOYBEAN'];

  before(async () => {
    await startTestDatabase();
    server = await startTestServer();
  });

  after(async () => {
    await server.close();
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    cropIds.clear();

    const { documents } = composeRegistry();
    await applyRegistrySeed({
      CropRegistry,
      SeedMeta,
      documents,
      version: registryVersion(documents),
    });

    alice = await registerUser(server);
    bob = await registerUser(server);

    const farm = await server.request('/api/v1/farms', {
      method: 'POST',
      token: alice.accessToken,
      body: farmInput(),
    });
    assert.equal(farm.status, 201, farm.text);
    farmId = farm.body.data.farm.id;

    for (const cropCode of SEEDED_CROPS) {
      const res = await server.request(`/api/v1/farms/${farmId}/crops`, {
        method: 'POST',
        token: alice.accessToken,
        body: { cropCode, sowingDate: isoDaysAgo(42) },
      });
      assert.equal(res.status, 201, res.text);
      cropIds.set(cropCode, res.body.data.crop.id);
    }
  });

  const guidance = (cropCode, token = alice.accessToken) =>
    server.request(`/api/v1/crops/${cropIds.get(cropCode)}/fertilizer-guidance`, { token });

  // ── Access control ───────────────────────────────────────────────────────

  it('requires a token', async () => {
    const res = await server.request(`/api/v1/crops/${cropIds.get('RICE')}/fertilizer-guidance`);

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
  });

  it('answers 404 — never 403 — for another user’s crop', async () => {
    const res = await guidance('RICE', bob.accessToken);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    // No fragment of the crop leaked alongside the refusal.
    assert.ok(!res.text.includes('RICE'));
  });

  it('answers 404 for a malformed crop id without leaking a cast error', async () => {
    for (const malformed of ['not-an-object-id', '1', '%2e%2e']) {
      const res = await server.request(`/api/v1/crops/${malformed}/fertilizer-guidance`, {
        token: alice.accessToken,
      });

      assert.equal(res.status, 404, `${malformed} did not 404`);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      assert.ok(!res.text.includes('Cast'), 'leaked a driver cast error');
    }
  });

  it('answers 404 for a well-formed crop id that belongs to nobody', async () => {
    const res = await server.request('/api/v1/crops/6890000000000000000000aa/fertilizer-guidance', {
      token: alice.accessToken,
    });
    assert.equal(res.status, 404);
  });

  it('serves the caller’s own crop', async () => {
    const res = await guidance('RICE');

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.data.cropCode, 'RICE');
    assert.equal(res.body.data.covered, true);
    assert.ok(res.body.data.names.en && res.body.data.names.hi);
  });

  // ── Disclaimer presence (required on EVERY response) ──────────────────────

  describe('disclaimer presence', () => {
    it('attaches the disclaimer key to a covered crop', async () => {
      const res = await guidance('RICE');

      assert.equal(res.body.data.disclaimerKey, DISCLAIMER_KEY);
      assert.equal(KNOWLEDGE.disclaimer.mandatory, true);
    });

    it('attaches the disclaimer key to an UNCOVERED crop as well', async () => {
      // 'OTHER' is a real registry document with no fertilizer knowledge at
      // all — the "uncovered crop/region: say so; never extrapolate numbers"
      // path. The disclaimer is attached before that early return.
      const created = await server.request(`/api/v1/farms/${farmId}/crops`, {
        method: 'POST',
        token: alice.accessToken,
        body: {
          cropCode: 'DRAGONFRUIT',
          freeTextLabel: 'Dragon fruit',
          sowingDate: isoDaysAgo(20),
        },
      });
      assert.equal(created.status, 201, created.text);
      assert.equal(created.body.data.crop.cropCode, 'OTHER');

      const res = await server.request(
        `/api/v1/crops/${created.body.data.crop.id}/fertilizer-guidance`,
        { token: alice.accessToken },
      );

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.disclaimerKey, DISCLAIMER_KEY);
      assert.equal(res.body.data.covered, false);
      assert.equal(res.body.data.reasonKey, 'fertilizer.notCovered');
      // Nothing was extrapolated into the gap.
      assert.deepEqual(res.body.data.recommendations, []);
      assert.deepEqual(res.body.data.sources, []);
      assert.deepEqual(res.body.data.deficiencySymptoms, []);
    });

    it('attaches it to every seeded crop, without exception', async () => {
      for (const cropCode of SEEDED_CROPS) {
        const res = await guidance(cropCode);
        assert.equal(
          res.body.data.disclaimerKey,
          DISCLAIMER_KEY,
          `${cropCode} carried no disclaimer`,
        );
      }
    });
  });

  // ── Snapshot: fractionKey + sourceRef per crop × stage ────────────────────

  describe('snapshots · each crop renders the published schedule and citation', () => {
    for (const cropCode of ['RICE', 'WHEAT', 'COTTON', 'ONION']) {
      it(`${cropCode} renders exactly the fractionKeys and source URLs the knowledge file publishes`, async () => {
        const published = KNOWLEDGE.crops[cropCode];
        const res = await guidance(cropCode);

        assert.equal(res.status, 200, res.text);
        const { recommendations } = res.body.data;
        assert.equal(
          recommendations.length,
          published.recommendations.length,
          `${cropCode}: recommendation count drifted from the knowledge file`,
        );

        published.recommendations.forEach((expected, index) => {
          const served = recommendations[index];

          // `varietyClass` is deliberately not compared here: it never reaches
          // the response at all. See the defect test below.
          assert.equal(served.basis, expected.basis, `${cropCode}[${index}] basis`);

          // "each crop×stage renders expected fractionKey + sourceRef"
          assert.deepEqual(
            served.schedule.map((entry) => [entry.stage, entry.timing, entry.fractionKey]),
            (expected.schedule ?? []).map((entry) => [
              entry.stage,
              entry.timing ?? null,
              entry.fractionKey,
            ]),
            `${cropCode}[${index}] schedule`,
          );

          assert.equal(served.source.url, expected.source.url, `${cropCode}[${index}] source.url`);
          assert.equal(served.source.org, expected.source.org, `${cropCode}[${index}] source.org`);
          assert.equal(
            served.source.title,
            expected.source.title,
            `${cropCode}[${index}] source.title`,
          );
          assert.equal(served.source.confidence, expected.source.confidence);
          assert.equal(served.source.accessed, expected.source.accessed);
        });
      });
    }

    /**
     * Variety class is the label that says WHICH published dose applies.
     *
     * TNAU publishes three different rice doses — 120–150 N short-duration,
     * 150 N medium/long, 175 N hybrid — and two different cotton doses
     * (varieties 32:16:16 vs hybrids 48:24:24). `CropRegistry`'s fertilizer
     * sub-schema did not declare the field, so Mongoose stripped it during the
     * seed and every dose reached the farmer as an unlabelled row with nothing
     * to say which was theirs. Fixed in P2-8; asserted here end to end, from
     * the knowledge file through the seed to the wire.
     */
    it('labels each published dose with the variety class the source stated', async () => {
      const published = KNOWLEDGE.crops.RICE.recommendations;
      assert.deepEqual(
        published.map((entry) => entry.varietyClass),
        ['short_duration', 'medium_long_duration', 'hybrid'],
        'the knowledge file no longer publishes three rice variety classes',
      );

      const res = await guidance('RICE');
      const served = res.body.data.recommendations;

      // The doses stay distinct and in published order…
      assert.deepEqual(
        served.map((entry) => entry.totalNpk.n),
        [[120, 150], 150, 175],
      );
      // …and each now carries the label that identifies it.
      assert.deepEqual(
        served.map((entry) => entry.varietyClass),
        published.map((entry) => entry.varietyClass),
      );

      // The field survives persistence, not just the response mapping.
      const registry = await CropRegistry.findOne({ cropCode: 'RICE' }).lean();
      assert.deepEqual(
        registry.fertilizer.recommendations.map((entry) => entry.varietyClass),
        ['short_duration', 'medium_long_duration', 'hybrid'],
      );
    });

    it('labels the two cotton doses so a hybrid grower is not shown the variety rate', async () => {
      const res = await guidance('COTTON');
      assert.deepEqual(
        res.body.data.recommendations.map((entry) => entry.varietyClass),
        KNOWLEDGE.crops.COTTON.recommendations.map((entry) => entry.varietyClass),
      );
    });

    it('deduplicates the citation list by URL without dropping a distinct source', async () => {
      // Rice publishes three variety-class doses from one TNAU page.
      const res = await guidance('RICE');
      assert.equal(res.body.data.recommendations.length, 3);
      assert.equal(res.body.data.sources.length, 1);
      assert.equal(
        res.body.data.sources[0].url,
        KNOWLEDGE.crops.RICE.recommendations[0].source.url,
      );
    });

    it('serves the soybean dose with a null URL rather than inventing a citation', async () => {
      // Gap F3: the repo publishes a provenance chain, not a URL, for
      // ICAR-IISR. `null` is the honest value and it must survive to the wire.
      const res = await guidance('SOYBEAN');
      assert.equal(res.body.data.recommendations[0].source.url, null);
      assert.equal(res.body.data.recommendations[0].source.confidence, 'S');
    });

    it('carries the published organics and micronutrients through untouched', async () => {
      const res = await guidance('SOYBEAN');
      const [recommendation] = res.body.data.recommendations;
      const expected = KNOWLEDGE.crops.SOYBEAN.recommendations[0];

      assert.equal(recommendation.organics.fym.published, expected.organics.fym.published);
      // Gap F1: FYM is published in tonnes with no per-area denominator.
      assert.equal(recommendation.organics.fym.unit, null);
      assert.equal(
        recommendation.micronutrients.sulphur.value,
        expected.micronutrients.sulphur.value,
      );
      assert.equal(recommendation.micronutrients.sulphur.unit, 'kg/ha');
    });
  });

  // ── Unit preservation ────────────────────────────────────────────────────

  describe('unit preservation · a per-acre source never silently becomes per-ha', () => {
    it('serves COTTON in kg/acre, exactly as TNAU publishes it', async () => {
      const res = await guidance('COTTON');
      const published = KNOWLEDGE.crops.COTTON.recommendations;

      res.body.data.recommendations.forEach((served, index) => {
        assert.equal(served.totalNpk.unit, 'kg/acre', `COTTON[${index}] unit was normalised`);
        assert.equal(served.totalNpk.unit, published[index].totalNpk.unit);
        // The numbers are the published ones, not converted ones: a per-acre
        // 32 becoming a per-hectare ~79 would change what a farmer applies.
        assert.equal(served.totalNpk.n, published[index].totalNpk.n);
        assert.equal(served.totalNpk.p2o5, published[index].totalNpk.p2o5);
        assert.equal(served.totalNpk.k2o, published[index].totalNpk.k2o);
      });

      assert.ok(!res.text.includes('kg/ha'), 'a per-hectare unit appeared in a per-acre response');
    });

    it('serves RICE in kg/ha, exactly as TNAU publishes it', async () => {
      const res = await guidance('RICE');

      for (const served of res.body.data.recommendations) {
        assert.equal(served.totalNpk.unit, 'kg/ha');
        assert.equal(served.totalNpk.unitUnknown, false);
      }
      assert.ok(!res.text.includes('kg/acre'));
    });

    it('serves WHEAT in kg/acre and keeps its unpublished potash figure null, not zero', async () => {
      const res = await guidance('WHEAT');
      const [first] = res.body.data.recommendations;

      assert.equal(first.totalNpk.unit, 'kg/acre');
      // Gap F4: PAU publishes no K2O for wheat. Zero would assert "no potash
      // is recommended", a claim the repository does not make.
      assert.equal(first.totalNpk.k2o, null);
    });

    it('preserves the published range form rather than averaging it', async () => {
      // Rice short-duration N is published as "120–150", stored as [min, max].
      const res = await guidance('RICE');
      const expected = KNOWLEDGE.crops.RICE.recommendations[0].totalNpk;

      assert.deepEqual(res.body.data.recommendations[0].totalNpk.n, expected.n);
      assert.deepEqual(res.body.data.recommendations[0].totalNpk.n, [120, 150]);
      assert.equal(res.body.data.recommendations[0].totalNpk.published, expected.published);
    });
  });

  // ── Unlabelled dose ──────────────────────────────────────────────────────

  it('flags ONION’s unlabelled dose: unit null and unitUnknown true', async () => {
    // Gap F7: the onion row publishes no unit at all, and onion is the
    // designated mandi demo crop. An unlabelled dose must never render as
    // though it had a unit.
    const res = await guidance('ONION');

    assert.equal(res.body.data.recommendations.length, 2);
    for (const served of res.body.data.recommendations) {
      assert.equal(served.totalNpk.unit, null, 'a unit was invented for onion');
      assert.equal(served.totalNpk.unitUnknown, true, 'the missing unit was not flagged');
      assert.ok(served.totalNpk.published, 'the published string was dropped');
    }

    // The flag distinguishes onion from every crop whose unit IS published.
    const rice = await guidance('RICE');
    assert.equal(rice.body.data.recommendations[0].totalNpk.unitUnknown, false);
  });

  // ── Verification pending ─────────────────────────────────────────────────

  describe('verification status travels to the client rather than being hidden', () => {
    it('marks WHEAT as pending, with a note key', async () => {
      const res = await guidance('WHEAT');

      assert.equal(KNOWLEDGE.crops.WHEAT.verificationPending, true);
      assert.equal(res.body.data.verificationPending, true);
      assert.equal(res.body.data.verificationNoteKey, 'fertilizer.verificationPending');
      // The source is shown anyway: "UI shows source anyway".
      assert.ok(res.body.data.sources.length > 0);
    });

    it('marks SOYBEAN as pending, with a note key', async () => {
      const res = await guidance('SOYBEAN');

      assert.equal(KNOWLEDGE.crops.SOYBEAN.verificationPending, true);
      assert.equal(res.body.data.verificationPending, true);
      assert.equal(res.body.data.verificationNoteKey, 'fertilizer.verificationPending');
    });

    it('does NOT mark RICE as pending', async () => {
      const res = await guidance('RICE');

      assert.equal(KNOWLEDGE.crops.RICE.verificationPending, false);
      assert.equal(res.body.data.verificationPending, false);
      assert.equal(res.body.data.verificationNoteKey, null);
    });
  });

  // ── Framing keys ─────────────────────────────────────────────────────────

  it('frames the card as a general compilation, with the soil-test route attached', async () => {
    const res = await guidance('RICE');

    assert.equal(res.body.data.guidanceTypeKey, 'fertilizer.typeGeneralNoSoilTest');
    assert.equal(res.body.data.limitationsKey, 'fertilizer.limitations');
    assert.equal(res.body.data.soilTestCtaKey, 'fertilizer.soilTestCta');
    // Keys, never prose (rule 8) — no rendered sentence rides on the wire.
    assert.ok(!res.text.includes('Soil Health Card'));
  });

  it('states the region context the source published, and null where it published none', async () => {
    const rice = await guidance('RICE');
    assert.equal(rice.body.data.context.region, KNOWLEDGE.crops.RICE.context.region);

    // Gap F9: five rows publish no region, so none is inferred from the source
    // organisation — the knowledge file writes an explicit null and it survives.
    const soybean = await guidance('SOYBEAN');
    assert.equal(KNOWLEDGE.crops.SOYBEAN.context.region, null);
    assert.equal(soybean.body.data.context.region, null);
  });

  // ── Current-stage highlight (explicit asOf, no fake timers) ───────────────

  describe('current-stage highlight', () => {
    const SOWN = new Date('2026-03-01T00:00:00.000Z');
    const onDay = (n) => new Date(SOWN.getTime() + n * DAY);

    /** Calls the service directly so the clock is an argument, not ambient. */
    const guidanceAt = (cropCode, day) =>
      fertilizerGuidance({ cropCode, sowingDate: SOWN, status: 'active' }, { asOf: onDay(day) });

    it('marks the entry whose published window contains today', async () => {
      // TNAU cotton varieties: basal, then "40–45 DAS".
      const result = await guidanceAt('COTTON', 42);

      assert.equal(result.daysSinceSowing, 42);
      const [varieties] = result.recommendations;
      const topdress = varieties.schedule.find((entry) => entry.timing === '40–45 DAS');

      assert.equal(topdress.isCurrent, true);
      assert.deepEqual(topdress.window, { fromDay: 40, toDay: 45, basis: '40–45 DAS' });
      assert.equal(topdress.timingUnknown, false);
    });

    it('marks nothing current outside every published window', async () => {
      const result = await guidanceAt('COTTON', 20);

      for (const recommendation of result.recommendations) {
        for (const entry of recommendation.schedule) {
          assert.equal(entry.isCurrent, false, `${entry.stage} was current on day 20`);
        }
      }
    });

    it('reports an unparseable timing as unknown rather than as "not now"', async () => {
      // PAU's wheat product schedule: "before 1st irrigation" is real and
      // published, but it is not a day number.
      const result = await guidanceAt('WHEAT', 42);
      const productSchedule = result.recommendations[1].schedule;

      const irrigationEntry = productSchedule.find(
        (entry) => entry.timing === 'before 1st irrigation',
      );
      assert.equal(irrigationEntry.timingUnknown, true);
      assert.equal(irrigationEntry.isCurrent, false);
      assert.equal(irrigationEntry.window, null);

      // "at sowing" in the same schedule does parse — the two are distinguished.
      const sowingEntry = productSchedule.find((entry) => entry.timing === 'at sowing');
      assert.equal(sowingEntry.timingUnknown, false);
      assert.equal(sowingEntry.isCurrent, false, 'an at-planting step was current 42 days later');
    });

    it('marks an at-sowing step current on the sowing day itself', async () => {
      const result = await guidanceAt('WHEAT', 0);
      const sowingEntry = result.recommendations[1].schedule.find(
        (entry) => entry.timing === 'at sowing',
      );

      assert.equal(result.daysSinceSowing, 0);
      assert.equal(sowingEntry.isCurrent, true);
    });

    it('reports a null published timing as unknown, never as day zero', async () => {
      // Rice's four N&K splits are named by growth stage with no day offsets
      // published (gap F12); no day number was borrowed from the Kc curve.
      const result = await guidanceAt('RICE', 0);

      for (const entry of result.recommendations[0].schedule) {
        assert.equal(entry.timing, null);
        assert.equal(entry.timingUnknown, true);
        assert.equal(entry.isCurrent, false);
      }
    });

    it('still serves the schedule when the crop yields no stage verdict', async () => {
      const result = await fertilizerGuidance(
        { cropCode: 'COTTON', sowingDate: SOWN, status: 'planned' },
        { asOf: onDay(42) },
      );

      assert.equal(result.stage, null);
      assert.equal(result.disclaimerKey, DISCLAIMER_KEY);
      assert.equal(result.covered, true);
      for (const entry of result.recommendations[0].schedule) {
        assert.equal(entry.isCurrent, false);
      }
    });
  });
});
