/**
 * Farm deletion cascades to the remote image assets.
 *
 * The sibling suite `cropCascade.test.js` guards the same property for a single
 * crop. The farm path had no coverage at all, and was therefore still doing the
 * exact thing that suite exists to prevent: `deleteFarmCascade` removed the
 * `cropHealthLogs` rows directly, so every photograph on every crop of the farm
 * stayed in the Cloudinary account with nothing left in the database to find it
 * by. Found by a live end-to-end run — deleting a farm returned 204 while all
 * four uploaded assets remained fetchable at their delivery URLs.
 *
 * Two rules make this a defect rather than untidiness: rule 10 (free-tier quota
 * must be guarded) and rule 12 (images are private per account — a farmer who
 * deletes a field is entitled to have the photographs actually go away).
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { deleteFarmCascade } from '../../src/services/farmService.js';
import { Crop, CropHealthLog, Farm } from '../../src/models/index.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const location = {
  lat: 19.9975,
  lon: 73.7898,
  state: 'Maharashtra',
  district: 'Nashik',
  source: 'manual',
};

async function seedLog({ userId, farmId, cropId, publicId }) {
  return CropHealthLog.create({
    userId,
    cropId,
    farmId,
    imageUrl: `https://res.cloudinary.test/${publicId}.jpg`,
    imagePublicId: publicId,
    analysis: { source: 'ml', diseaseCode: 'COTTON_BACTERIAL_BLIGHT' },
    sharedToCommunity: false,
    status: 'analyzed',
  });
}

describe('farm cascade · remote image cleanup', () => {
  let userId;
  let farm;
  let cropA;
  let cropB;

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
      name: 'North field',
      location,
      locationKey: '19.99,73.79',
      sizeValue: 2.5,
      sizeUnit: 'acre',
      soilType: 'black',
      irrigationMethod: 'drip',
    });

    const make = (cropCode) =>
      Crop.create({
        userId,
        farmId: farm._id,
        cropCode,
        sowingDate: new Date('2026-06-14'),
        areaValue: 1,
        areaUnit: 'acre',
        status: 'active',
      });

    cropA = await make('COTTON');
    cropB = await make('MAIZE');
  });

  it('destroys every image on every crop of the farm', async () => {
    await seedLog({ userId, farmId: farm._id, cropId: cropA._id, publicId: 'him1096/test/a1' });
    await seedLog({ userId, farmId: farm._id, cropId: cropA._id, publicId: 'him1096/test/a2' });
    await seedLog({ userId, farmId: farm._id, cropId: cropB._id, publicId: 'him1096/test/b1' });

    const destroyed = [];
    await deleteFarmCascade(farm, {
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { ok: true };
      },
    });

    assert.deepEqual(destroyed.sort(), ['him1096/test/a1', 'him1096/test/a2', 'him1096/test/b1']);
    assert.equal(await CropHealthLog.countDocuments({ userId }), 0);
    assert.equal(await Crop.countDocuments({ farmId: farm._id }), 0);
    assert.equal(await Farm.countDocuments({ _id: farm._id }), 0);
  });

  it('reads the publicId even though it is select:false', async () => {
    // The precise bug an unwary implementation hits: `find()` silently omits
    // the field, `destroy(undefined)` does nothing, and the delete "succeeds".
    await seedLog({ userId, farmId: farm._id, cropId: cropA._id, publicId: 'him1096/test/hidden' });

    const destroyed = [];
    await deleteFarmCascade(farm, {
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { ok: true };
      },
    });

    assert.deepEqual(destroyed, ['him1096/test/hidden']);
  });

  it('covers a log reachable only by its denormalized farmId', async () => {
    // Health logs carry both `farmId` and `cropId`; a log whose crop row is
    // already gone is still the farmer's photograph and must still be removed.
    await seedLog({
      userId,
      farmId: farm._id,
      cropId: new mongoose.Types.ObjectId(),
      publicId: 'him1096/test/orphan',
    });

    const destroyed = [];
    await deleteFarmCascade(farm, {
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { ok: true };
      },
    });

    assert.deepEqual(destroyed, ['him1096/test/orphan']);
    assert.equal(await CropHealthLog.countDocuments({ userId }), 0);
  });

  it('still deletes the farm when the image host is down', async () => {
    // A farmer removing a field must succeed even when remote cleanup cannot.
    // An unremovable asset is a quota problem to reconcile later; a farm that
    // refuses to delete is a correctness problem the farmer sees immediately.
    await seedLog({ userId, farmId: farm._id, cropId: cropA._id, publicId: 'him1096/test/down' });

    await deleteFarmCascade(farm, {
      destroy: async () => {
        throw new Error('cloudinary unreachable');
      },
    });

    assert.equal(await Farm.countDocuments({ _id: farm._id }), 0);
    assert.equal(await CropHealthLog.countDocuments({ userId }), 0);
    assert.equal(await Crop.countDocuments({ farmId: farm._id }), 0);
  });

  it('never touches another account, even with a colliding farmId', async () => {
    const otherUser = new mongoose.Types.ObjectId();
    await seedLog({
      userId: otherUser,
      farmId: farm._id,
      cropId: cropA._id,
      publicId: 'him1096/test/other-account',
    });

    const destroyed = [];
    await deleteFarmCascade(farm, {
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { ok: true };
      },
    });

    assert.deepEqual(destroyed, []);
    assert.equal(await CropHealthLog.countDocuments({ userId: otherUser }), 1);
  });
});
