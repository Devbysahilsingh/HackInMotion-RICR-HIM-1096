/**
 * Crop deletion cascades to the remote image assets.
 *
 * `imagePublicId` has existed on the model since Phase 1 with the comment
 * "Needed to destroy the Cloudinary asset on cascade delete" — but nothing ever
 * called the destroy. Deleting a crop removed the rows that held the only
 * reference to each photograph and left the assets in the account permanently,
 * with nothing in the database left to find them by. This suite is the
 * regression guard for that.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { deleteCropCascade } from '../../src/services/cropService.js';
import { Crop, CropHealthLog } from '../../src/models/index.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const ids = () => ({
  userId: new mongoose.Types.ObjectId(),
  farmId: new mongoose.Types.ObjectId(),
});

async function seedLog({ userId, farmId, cropId, publicId }) {
  return CropHealthLog.create({
    userId,
    cropId,
    farmId,
    imageUrl: `https://res.cloudinary.test/${publicId}.jpg`,
    imagePublicId: publicId,
    analysis: { source: 'ml', diseaseCode: 'TOMATO_EARLY_BLIGHT' },
    sharedToCommunity: false,
    status: 'analyzed',
  });
}

describe('crop cascade · remote image cleanup', () => {
  let userId;
  let farmId;
  let cropId;

  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
    ({ userId, farmId } = ids());

    const crop = await Crop.create({
      userId,
      farmId,
      cropCode: 'TOMATO',
      sowingDate: new Date('2026-07-01'),
      areaValue: 1,
      areaUnit: 'acre',
      status: 'active',
    });
    cropId = crop._id;
  });

  it('destroys every image the crop owned', async () => {
    await seedLog({ userId, farmId, cropId, publicId: 'him1096/test/a' });
    await seedLog({ userId, farmId, cropId, publicId: 'him1096/test/b' });

    const destroyed = [];
    await deleteCropCascade(cropId, userId, {
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { ok: true };
      },
    });

    assert.deepEqual(destroyed.sort(), ['him1096/test/a', 'him1096/test/b']);
    assert.equal(await CropHealthLog.countDocuments({ cropId }), 0);
    assert.equal(await Crop.countDocuments({ _id: cropId }), 0);
  });

  it('reads the publicId even though it is select:false', async () => {
    // The exact bug an unwary implementation hits: `find()` silently omits the
    // field, `destroy(undefined)` does nothing, and the delete "succeeds".
    await seedLog({ userId, farmId, cropId, publicId: 'him1096/test/hidden' });

    const destroyed = [];
    await deleteCropCascade(cropId, userId, {
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { ok: true };
      },
    });

    assert.deepEqual(destroyed, ['him1096/test/hidden']);
  });

  it('still deletes the crop when the image host is down', async () => {
    // A farmer removing a crop must succeed even when cleanup cannot. An asset
    // we failed to remove is a quota problem for later; a crop that refuses to
    // delete is a problem the farmer sees now.
    await seedLog({ userId, farmId, cropId, publicId: 'him1096/test/stuck' });

    await deleteCropCascade(cropId, userId, {
      destroy: async () => {
        throw new Error('cloudinary unreachable');
      },
    });

    assert.equal(await Crop.countDocuments({ _id: cropId }), 0);
    assert.equal(await CropHealthLog.countDocuments({ cropId }), 0);
  });

  it('never destroys an image belonging to another farmer', async () => {
    const other = ids();
    await seedLog({ userId, farmId, cropId, publicId: 'him1096/test/mine' });
    // Same cropId, different owner — the defence-in-depth userId filter is what
    // stops this being a cross-account asset deletion.
    await seedLog({
      userId: other.userId,
      farmId: other.farmId,
      cropId,
      publicId: 'him1096/test/theirs',
    });

    const destroyed = [];
    await deleteCropCascade(cropId, userId, {
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { ok: true };
      },
    });

    assert.deepEqual(destroyed, ['him1096/test/mine']);
    assert.equal(await CropHealthLog.countDocuments({ imagePublicId: 'him1096/test/theirs' }), 1);
  });

  it('does nothing remote for a crop with no photographs', async () => {
    let called = false;
    await deleteCropCascade(cropId, userId, {
      destroy: async () => {
        called = true;
        return { ok: true };
      },
    });

    assert.equal(called, false);
  });
});
