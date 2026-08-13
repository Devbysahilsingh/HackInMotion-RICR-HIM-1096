/**
 * The land ledger: total crop area on a farm may never exceed the farm's own
 * size, in acre-equivalents, regardless of the units either was recorded in.
 *
 * This rule must hold on the server — a form-only check is one curl away from
 * not existing — so the suite drives the service helpers and the failure
 * details the API contract promises (`{field:'areaValue',
 * rule:'exceeds_farm_area', availableAcres}`), plus the mirror rule that a
 * farm cannot shrink underneath its planted crops.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import {
  allocatedCropAcres,
  assertAreaWithinFarm,
} from '../../src/services/cropService.js';
import { updateFarm } from '../../src/services/farmService.js';
import { Crop, Farm } from '../../src/models/index.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const location = {
  lat: 23.16,
  lon: 77.41,
  state: 'Madhya Pradesh',
  district: 'Bhopal',
  source: 'manual',
};

describe('crop area · the land ledger', () => {
  let userId;
  let farm;

  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    userId = new mongoose.Types.ObjectId();

    farm = await Farm.create({
      userId,
      name: 'Kolar field',
      location,
      locationKey: '23.16,77.41',
      sizeValue: 50,
      sizeUnit: 'acre',
      soilType: 'black',
      irrigationMethod: 'canal',
    });
  });

  const plant = (overrides = {}) =>
    Crop.create({
      userId,
      farmId: farm._id,
      cropCode: 'COTTON',
      sowingDate: new Date('2026-06-14'),
      status: 'active',
      areaValue: 30,
      areaUnit: 'acre',
      ...overrides,
    });

  const rejection = async (promise) => {
    try {
      await promise;
    } catch (err) {
      return err;
    }
    assert.fail('expected the ledger to refuse');
  };

  describe('allocatedCropAcres', () => {
    it('sums planned and active crops, and excludes harvested ones', async () => {
      await plant({ areaValue: 30 });
      await plant({ cropCode: 'ONION', status: 'planned', areaValue: 5 });
      await plant({ cropCode: 'WHEAT', status: 'harvested', areaValue: 100 });

      assert.equal(await allocatedCropAcres(farm._id), 35);
    });

    it('converts units — a hectare crop counts as 2.47105 acres', async () => {
      await plant({ areaValue: 2, areaUnit: 'hectare' });
      assert.ok(Math.abs((await allocatedCropAcres(farm._id)) - 4.9421) < 1e-9);
    });

    it('excludes the crop being edited so it does not count against itself', async () => {
      const crop = await plant({ areaValue: 30 });
      assert.equal(await allocatedCropAcres(farm._id, crop._id), 0);
    });

    it('treats a crop with no recorded area as occupying nothing', async () => {
      await plant({ areaValue: undefined, areaUnit: undefined });
      assert.equal(await allocatedCropAcres(farm._id), 0);
    });
  });

  describe('assertAreaWithinFarm', () => {
    it('accepts a planting that exactly fills the farm', async () => {
      await plant({ areaValue: 30 });
      await assert.doesNotReject(
        assertAreaWithinFarm(farm, { areaValue: 20, areaUnit: 'acre' }),
      );
    });

    it('refuses a single crop larger than the farm', async () => {
      const err = await rejection(
        assertAreaWithinFarm(farm, { areaValue: 60, areaUnit: 'acre' }),
      );

      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.messageKey, 'crop.areaExceedsFarm');
      assert.deepEqual(err.details, [
        { field: 'areaValue', rule: 'exceeds_farm_area', availableAcres: 50 },
      ]);
    });

    it('refuses when the total across crops would exceed the farm', async () => {
      await plant({ areaValue: 30 });
      const err = await rejection(
        assertAreaWithinFarm(farm, { areaValue: 25, areaUnit: 'acre' }),
      );

      assert.equal(err.messageKey, 'crop.areaExceedsFarm');
      assert.deepEqual(err.details, [
        { field: 'areaValue', rule: 'exceeds_farm_area', availableAcres: 20 },
      ]);
    });

    it('refuses an edit that grows a crop past the remaining ground', async () => {
      const cotton = await plant({ areaValue: 20 });
      await plant({ cropCode: 'ONION', areaValue: 15 });
      await plant({ cropCode: 'SOYBEAN', areaValue: 15 });

      // 20 → 30 would take the total to 60 on a 50-acre farm.
      const err = await rejection(
        assertAreaWithinFarm(farm, {
          areaValue: 30,
          areaUnit: 'acre',
          excludeCropId: cotton._id,
        }),
      );
      assert.deepEqual(err.details, [
        { field: 'areaValue', rule: 'exceeds_farm_area', availableAcres: 20 },
      ]);

      // 20 → 20 (unchanged) and 20 → 15 (shrinking) both still fit.
      await assert.doesNotReject(
        assertAreaWithinFarm(farm, {
          areaValue: 20,
          areaUnit: 'acre',
          excludeCropId: cotton._id,
        }),
      );
    });

    it('reconciles mixed units into one ledger', async () => {
      // 8 hectare ≈ 19.77 acres on a 50-acre farm → ~30.23 acres left.
      await plant({ areaValue: 8, areaUnit: 'hectare' });

      await assert.doesNotReject(
        assertAreaWithinFarm(farm, { areaValue: 30, areaUnit: 'acre' }),
      );
      const err = await rejection(
        assertAreaWithinFarm(farm, { areaValue: 49, areaUnit: 'bigha' }), // 30.625 ac
      );
      assert.equal(err.details[0].rule, 'exceeds_farm_area');
    });

    it('ignores harvested crops — finished crops free their ground', async () => {
      await plant({ areaValue: 50, status: 'harvested' });
      await assert.doesNotReject(
        assertAreaWithinFarm(farm, { areaValue: 50, areaUnit: 'acre' }),
      );
    });

    it('never blocks a crop with no recorded area', async () => {
      await plant({ areaValue: 30 });
      await assert.doesNotReject(assertAreaWithinFarm(farm, {}));
    });
  });

  describe('updateFarm · the mirror rule', () => {
    it('refuses to shrink the farm below its allocated crop area', async () => {
      await plant({ areaValue: 30 });
      await plant({ cropCode: 'ONION', areaValue: 15 });

      const err = await rejection(updateFarm(farm, { sizeValue: 40 }));

      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.messageKey, 'farm.sizeBelowCropArea');
      assert.deepEqual(err.details, [
        { field: 'sizeValue', rule: 'below_crop_area', allocatedAcres: 45 },
      ]);

      // Nothing was persisted by the refused update.
      const stored = await Farm.findById(farm._id).lean();
      assert.equal(stored.sizeValue, 50);
    });

    it('allows shrinking down to exactly the allocated area', async () => {
      await plant({ areaValue: 30 });
      const updated = await updateFarm(farm, { sizeValue: 30 });
      assert.equal(updated.sizeValue, 30);
    });

    it('applies the rule to a unit change, not only a value change', async () => {
      await plant({ areaValue: 30 });
      // 50 bigha = 31.25 acres — still covers 30 acres of cotton.
      await assert.doesNotReject(updateFarm(farm, { sizeUnit: 'bigha' }));

      farm = await Farm.findById(farm._id);
      // But 40 bigha = 25 acres does not.
      const err = await rejection(updateFarm(farm, { sizeValue: 40 }));
      assert.equal(err.messageKey, 'farm.sizeBelowCropArea');
    });

    it('leaves non-size updates untouched by the ledger', async () => {
      await plant({ areaValue: 50 });
      const updated = await updateFarm(farm, { name: 'Renamed field' });
      assert.equal(updated.name, 'Renamed field');
    });
  });
});
