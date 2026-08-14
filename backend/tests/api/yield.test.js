/**
 * Yield estimate API (docs/api/intelligence.md · docs/yield/yield-estimation.md).
 *
 * These run against the **real committed lookup**, not a fixture: the farms
 * below are placed in districts whose government yield history actually exists,
 * so an assertion that Ludhiana wheat comes back near 5 t/ha is an assertion
 * about Punjab's published statistics. A fixture would prove the plumbing and
 * nothing about the feature.
 *
 * Covered here, per the test matrix for this surface:
 *   · district × season exact match          · district annual fallback
 *   · state × season fallback                · state fallback
 *   · insufficient evidence                  · unsupported crop (cotton, tomato)
 *   · auth, ownership, IDOR                  · unit conversion and range
 *   · response contract                      · summary aggregation
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CropRegistry, SeedMeta, YieldEstimate } from '../../src/models/index.js';
import { applyRegistrySeed } from '../../src/services/registrySeedRunner.js';
import { composeRegistry, registryVersion } from '../../src/services/registrySeedService.js';
import { farmInput, registerUser } from '../factories/index.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

/** Sowing dates that land in each season, so the resolver picks the right rows. */
const sownInMonth = (month) => {
  const now = new Date();
  const year = now.getMonth() + 1 >= month ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(Date.UTC(year, month - 1, 15)).toISOString().slice(0, 10);
};
const KHARIF_SOWING = sownInMonth(7);
const RABI_SOWING = sownInMonth(11);

describe('GET /crops/:id/yield-estimate', () => {
  let server;
  let alice;
  let bob;

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

    const { documents } = composeRegistry();
    await applyRegistrySeed({
      CropRegistry,
      SeedMeta,
      documents,
      version: registryVersion(documents),
    });

    alice = await registerUser(server);
    bob = await registerUser(server);
  });

  /** Creates a farm in a real place and plants a real crop on it. */
  async function plant({
    token = alice.accessToken,
    state = 'Punjab',
    district = 'Ludhiana',
    cropCode = 'WHEAT',
    sowingDate = RABI_SOWING,
    areaValue = 2,
    areaUnit = 'acre',
    irrigationMethod = 'canal',
  } = {}) {
    const farm = await server.request('/api/v1/farms', {
      method: 'POST',
      token,
      body: farmInput({
        location: { state, district, source: 'manual' },
        irrigationMethod,
      }),
    });
    assert.equal(farm.status, 201, farm.text);

    const body = { cropCode, sowingDate };
    if (areaValue !== null) {
      body.areaValue = areaValue;
      body.areaUnit = areaUnit;
    }

    const crop = await server.request(`/api/v1/farms/${farm.body.data.farm.id}/crops`, {
      method: 'POST',
      token,
      body,
    });
    assert.equal(crop.status, 201, crop.text);
    return { farmId: farm.body.data.farm.id, cropId: crop.body.data.crop.id };
  }

  const estimate = (cropId, token = alice.accessToken) =>
    server.request(`/api/v1/crops/${cropId}/yield-estimate`, { token });

  // ── Access control ────────────────────────────────────────────────────────

  describe('access control', () => {
    it('requires a token', async () => {
      const { cropId } = await plant();
      // Called directly rather than through `estimate`, whose default parameter
      // would substitute Alice's token for an omitted one.
      const res = await server.request(`/api/v1/crops/${cropId}/yield-estimate`);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'AUTHENTICATION_ERROR');
    });

    it('404s another farmer’s crop without disclosing that it exists (IDOR)', async () => {
      const { cropId } = await plant();

      const res = await estimate(cropId, bob.accessToken);
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      // The same code a genuinely absent id returns — no enumeration.
      const absent = await estimate('6890000000000000000000aa', bob.accessToken);
      assert.equal(absent.status, 404);
      assert.equal(absent.body.error.code, res.body.error.code);
    });

    it('404s a malformed id before it reaches a query', async () => {
      for (const malformed of ['not-an-id', '../../etc/passwd', '{"$ne":null}', '1']) {
        const res = await estimate(encodeURIComponent(malformed));
        assert.equal(res.status, 404, `${malformed} did not 404`);
      }
    });

    it('does not leak another farmer’s crop through the summary', async () => {
      await plant();
      const res = await server.request('/api/v1/yield/summary', { token: bob.accessToken });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body.data.items, []);
      assert.equal(res.body.data.totals, null);
    });
  });

  // ── The evidence ladder, against real government data ─────────────────────

  describe('evidence ladder', () => {
    it('answers an exact district × season match from the district’s own history', async () => {
      const { cropId } = await plant({ state: 'Punjab', district: 'Ludhiana', cropCode: 'WHEAT' });
      const res = await estimate(cropId);

      assert.equal(res.status, 200, res.text);
      const data = res.body.data;
      assert.equal(data.estimated, true);
      assert.equal(data.evidence.tier, 'DISTRICT_SEASON');
      assert.equal(data.evidence.specificity, 'EXACT');
      assert.equal(data.location.districtMatched, true);
      assert.equal(data.location.matchedDistrict, 'Ludhiana');
      // Punjab wheat really is about 5 t/ha.
      assert.ok(
        data.basis.medianYieldTHa > 4 && data.basis.medianYieldTHa < 6,
        `got ${data.basis.medianYieldTHa}`,
      );
      assert.equal(data.basis.latestYear, 2022);
    });

    it('falls through to the state when the district name does not match', async () => {
      // "Anantapur" is the pre-rename spelling; the government publishes
      // "Ananthapuramu". No fuzzy match, so the district rungs are skipped.
      const { cropId } = await plant({
        state: 'Andhra Pradesh',
        district: 'Anantapur',
        cropCode: 'RICE',
        sowingDate: KHARIF_SOWING,
      });
      const res = await estimate(cropId);

      assert.equal(res.status, 200, res.text);
      const data = res.body.data;
      assert.equal(data.estimated, true);
      assert.equal(data.location.districtMatched, false);
      assert.ok(['STATE_SEASON', 'STATE'].includes(data.evidence.tier), data.evidence.tier);

      const skipped = data.evidence.attempts.filter((a) => a.outcome === 'SKIPPED');
      assert.ok(skipped.length >= 2, 'the district rungs should be recorded as skipped');
    });

    it('records every rung it walked, so the fallback is auditable', async () => {
      const { cropId } = await plant({ state: 'Punjab', district: 'Ludhiana', cropCode: 'WHEAT' });
      const { body } = await estimate(cropId);

      const attempts = body.data.evidence.attempts;
      assert.ok(attempts.length >= 1);
      assert.equal(attempts.at(-1).outcome, 'HIT');
      for (const attempt of attempts) {
        assert.ok(['HIT', 'MISS', 'SKIPPED'].includes(attempt.outcome));
      }
    });
  });

  // ── Insufficient evidence ─────────────────────────────────────────────────

  describe('insufficient evidence', () => {
    it('returns 200 with a reason rather than an error', async () => {
      // Punjab's APY returns cover maize, rice and wheat only — a Punjab onion
      // has no history at any tier, which is an answer, not a fault.
      const { cropId } = await plant({ state: 'Punjab', district: 'Ludhiana', cropCode: 'ONION' });
      const res = await estimate(cropId);

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.estimated, false);
      assert.equal(res.body.data.evidence.resolution, 'INSUFFICIENT_EVIDENCE');
      assert.match(res.body.data.reasonKey, /^yield\./);
      assert.equal(res.body.data.production, null);
    });

    it('refuses cotton, which is excluded until the bale unit is cited', async () => {
      const { cropId } = await plant({
        state: 'Gujarat',
        district: 'Amreli',
        cropCode: 'COTTON',
        sowingDate: KHARIF_SOWING,
      });
      const res = await estimate(cropId);

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.estimated, false);
      assert.equal(res.body.data.evidence.reasonKey, 'yield.evidenceCropNotSupported');
    });

    it('refuses tomato, whose evidence is insufficient at every tier', async () => {
      const { cropId } = await plant({
        state: 'Karnataka',
        district: 'Kolar',
        cropCode: 'TOMATO',
        sowingDate: RABI_SOWING,
      });
      const res = await estimate(cropId);

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.data.estimated, false);
      assert.equal(res.body.data.evidence.reasonKey, 'yield.evidenceCropNotSupported');
    });

    it('says so when the state itself is unknown to the lookup', async () => {
      const { cropId } = await plant({
        state: 'Nowhereland',
        district: 'Nowhere',
        cropCode: 'WHEAT',
      });
      const res = await estimate(cropId);

      assert.equal(res.body.data.estimated, false);
      assert.equal(res.body.data.evidence.reasonKey, 'yield.evidenceStateUnresolved');
    });

    it('never persists an estimate it did not make', async () => {
      const { cropId } = await plant({ state: 'Punjab', district: 'Ludhiana', cropCode: 'ONION' });
      await estimate(cropId);
      assert.equal(await YieldEstimate.countDocuments(), 0);
    });
  });

  // ── The response contract ─────────────────────────────────────────────────

  describe('response contract', () => {
    it('is a range, never a single number', async () => {
      const { cropId } = await plant();
      const { body } = await estimate(cropId);
      const production = body.data.production;

      assert.equal(body.data.isRange, true);
      assert.ok(production.lowQuintals < production.midQuintals);
      assert.ok(production.highQuintals > production.midQuintals);
      assert.equal(production.unit, 'quintal');
      assert.equal(body.data.rangeMeaningKey, 'yield.rangeTypicalYearToYear');
    });

    it('converts acres to hectares consistently with the land ledger', async () => {
      const { cropId } = await plant({ areaValue: 2, areaUnit: 'acre' });
      const { body } = await estimate(cropId);
      // 2 acres = 2 / 2.47105 hectares.
      assert.ok(Math.abs(body.data.production.areaHectares - 2 / 2.47105) < 1e-3);
    });

    it('multiplies the published median by the area and nothing else', async () => {
      const { cropId } = await plant({ areaValue: 1, areaUnit: 'hectare' });
      const { body } = await estimate(cropId);
      const expected = body.data.basis.medianYieldTHa * body.data.production.areaHectares;
      assert.ok(Math.abs(body.data.production.midTonnes - expected) < 0.01);
    });

    it('reports both spec factors as considered and not applied, with citations', async () => {
      const { cropId } = await plant({ irrigationMethod: 'rainfed' });
      const { body } = await estimate(cropId);

      assert.equal(body.data.factors.length, 2);
      for (const factor of body.data.factors) {
        assert.equal(factor.applied, false);
        assert.equal(factor.multiplier, null);
        assert.ok(factor.sourceRef.title);
      }
      // The qualitative caveat replaces the missing multiplier.
      assert.ok(body.data.limitations.some((l) => l.key === 'yield.limitRainfed'));
    });

    it('labels the data historical and states its vintage', async () => {
      const { cropId } = await plant();
      const { body } = await estimate(cropId);

      assert.equal(body.data.freshness.status, 'historical');
      assert.equal(body.data.freshness.latestYear, 2022);
      assert.ok(body.data.freshness.dataVintageYears >= 0);
    });

    it('attaches the government attribution the licence requires', async () => {
      const { cropId } = await plant();
      const { body } = await estimate(cropId);
      assert.match(body.data.source.attribution, /Directorate of Economics & Statistics/);
      assert.ok(body.data.source.sha256);
    });

    it('carries a disclaimer and a why-trace', async () => {
      const { cropId } = await plant();
      const { body } = await estimate(cropId);

      assert.equal(body.data.disclaimerKey, 'yield.disclaimer');
      assert.ok(Array.isArray(body.data.trace));
      assert.ok(body.data.trace.some((s) => s.step === 'PRODUCTION'));
      assert.ok(body.data.trace.some((s) => s.step === 'LADDER'));
    });

    it('returns i18n keys, never display prose', async () => {
      const { cropId } = await plant({ irrigationMethod: 'rainfed' });
      const { body } = await estimate(cropId);

      for (const limitation of body.data.limitations) assert.match(limitation.key, /^yield\./);
      for (const factor of body.data.factors) assert.match(factor.reasonKey, /^yield\./);
      assert.match(body.data.basisKey, /^yield\./);
    });

    it('serves the yield basis but withholds the total for a bigha area', async () => {
      const { cropId } = await plant({ areaValue: 4, areaUnit: 'bigha' });
      const { body } = await estimate(cropId);

      assert.equal(body.data.estimated, true);
      assert.ok(body.data.basis.medianYieldTHa > 0);
      assert.equal(body.data.production, null);
      assert.equal(body.data.productionUnavailableReasonKey, 'yield.productionAreaUnitAmbiguous');
    });

    it('withholds the total when the crop has no recorded area', async () => {
      const { cropId } = await plant({ areaValue: null });
      const { body } = await estimate(cropId);
      assert.equal(body.data.production, null);
      assert.equal(body.data.productionUnavailableReasonKey, 'yield.productionAreaMissing');
    });

    it('records what the farmer was shown, with the disclaimer version', async () => {
      const { cropId } = await plant();
      await estimate(cropId);

      const stored = await YieldEstimate.findOne({ cropId }).lean();
      assert.ok(stored, 'estimate was not persisted');
      assert.ok(stored.districtAvgYield > 0);
      assert.equal(stored.estimateRange.unit, 'quintal');
      assert.match(stored.disclaimerVersion, /^yield-v1/);
      // The exact lookup the number came from, so an old record stays checkable.
      assert.ok(stored.inputsSnapshot.lookupSha256);
    });
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  describe('GET /yield/summary', () => {
    it('requires a token', async () => {
      const res = await server.request('/api/v1/yield/summary');
      assert.equal(res.status, 401);
    });

    it('totals only the crops it could actually estimate, and counts the rest', async () => {
      await plant({ cropCode: 'WHEAT' });
      await plant({ cropCode: 'ONION' }); // Punjab has no onion history.

      const res = await server.request('/api/v1/yield/summary', { token: alice.accessToken });
      assert.equal(res.status, 200, res.text);

      const data = res.body.data;
      assert.equal(data.items.length, 2);
      assert.equal(data.unavailableCount, 1);
      assert.equal(data.totals.crops, 1);
      assert.ok(data.totals.midQuintals > 0);
      assert.equal(data.totals.unit, 'quintal');
    });

    it('agrees with the detail endpoint it links to', async () => {
      const { cropId } = await plant({ cropCode: 'WHEAT' });

      const [summary, detail] = await Promise.all([
        server.request('/api/v1/yield/summary', { token: alice.accessToken }),
        estimate(cropId),
      ]);

      const item = summary.body.data.items.find((i) => i.cropId === cropId);
      assert.equal(item.medianYieldTHa, detail.body.data.basis.medianYieldTHa);
      assert.equal(item.production.midQuintals, detail.body.data.production.midQuintals);
      assert.equal(item.tier, detail.body.data.evidence.tier);
    });

    it('reports totals as null when nothing could be estimated', async () => {
      await plant({ cropCode: 'ONION' });
      const res = await server.request('/api/v1/yield/summary', { token: alice.accessToken });
      assert.equal(res.body.data.totals, null);
      assert.equal(res.body.data.unavailableCount, 1);
    });
  });
});
