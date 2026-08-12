/**
 * Crop registry seed + API.
 *
 * The seed's contract is that it is deterministic and safe to re-run — the
 * deploy checklist depends on it ("Registry + KB seeds applied (versioned
 * seedMeta)"), and a seed that duplicates or drifts on a second run would
 * corrupt every farmer's crop references.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CropRegistry, SeedMeta } from '../../src/models/index.js';
import { applyRegistrySeed } from '../../src/services/registrySeedRunner.js';
import {
  composeCrop,
  composeRegistry,
  loadKnowledge,
  otherCropDocument,
  registryVersion,
} from '../../src/services/registrySeedService.js';
import { startTestServer } from '../helpers/app.js';
import { clearCollections, startTestDatabase, stopTestDatabase } from '../helpers/db.js';

const seed = (options = {}) => {
  const documents = options.documents ?? composeRegistry().documents;
  return applyRegistrySeed({
    CropRegistry,
    SeedMeta,
    documents,
    version: options.version ?? registryVersion(documents),
    force: options.force,
  });
};

describe('Crop registry · composition', () => {
  it('composes a document for every crop in the knowledge files', () => {
    const { documents } = composeRegistry();

    assert.ok(documents.length > 1, 'no registry documents were composed');
    const codes = documents.map((document) => document.cropCode);
    assert.ok(codes.includes('OTHER'), 'the unsupported-crop placeholder is missing');
    assert.equal(new Set(codes).size, codes.length, 'duplicate crop codes composed');
  });

  it('is deterministic — the same inputs produce the same version', () => {
    assert.equal(
      registryVersion(composeRegistry().documents),
      registryVersion(composeRegistry().documents),
    );
  });

  it('changes version when the knowledge changes', () => {
    const base = composeRegistry().documents;
    const altered = [...base, { cropCode: 'ZZTEST', names: { en: 'x', hi: 'x' } }];
    assert.notEqual(registryVersion(base), registryVersion(altered));
  });

  it('takes ML class codes from the dataset manifest, not the stale mapping doc', () => {
    const knowledge = loadKnowledge();
    if (!knowledge.manifest) return; // manifest absent in this checkout

    const { documents } = composeRegistry(knowledge);
    const tomato = documents.find((document) => document.cropCode === 'TOMATO');
    if (!tomato) return;

    for (const classCode of tomato.mlClassCodes) {
      assert.ok(
        Object.keys(knowledge.manifest.classes).includes(classCode),
        `${classCode} is not a class with real data`,
      );
    }
    // The rejected Paddy Doctor classes must never reappear.
    const rice = documents.find((document) => document.cropCode === 'RICE');
    assert.ok(!rice?.mlClassCodes.includes('RICE_HISPA'));
  });

  it('honours the ADR-021 support-tier decisions over the older matrix', () => {
    const knowledge = loadKnowledge();
    const tiers = knowledge.manifest?.support_tiers;
    if (!tiers) return;

    const { documents } = composeRegistry(knowledge);
    for (const [cropCode, decision] of Object.entries(tiers)) {
      const document = documents.find((entry) => entry.cropCode === cropCode);
      if (document) assert.equal(document.supportLevel, decision.tier, `${cropCode} tier`);
    }
  });

  it('never claims ML support without trained classes', () => {
    for (const document of composeRegistry().documents) {
      if (document.mlSupported) {
        assert.ok(
          document.mlClassCodes.length > 0,
          `${document.cropCode} claims ML support with no classes`,
        );
      }
    }
  });

  it('records a gap rather than inventing a missing agronomic value', () => {
    const composed = composeCrop({
      cropCode: 'BAJRA',
      agronomy: undefined,
      base: { names: { en: 'Pearl millet', hi: 'बाजरा' }, seasons: ['kharif'] },
      fertilizer: undefined,
      manifest: null,
      mlClasses: [],
    });

    assert.equal(composed.supportLevel, 'LIMITED');
    assert.deepEqual(composed.kcStages, []);
    assert.equal(composed.rootDepthM, undefined);
    assert.ok(composed.dataGaps.some((gap) => gap.includes('Kc stages')));
    assert.ok(composed.dataGaps.some((gap) => gap.includes('rooting depth')));
  });

  it('gives the OTHER placeholder no agronomic knowledge at all', () => {
    const other = otherCropDocument();
    assert.equal(other.supportLevel, 'UNSUPPORTED');
    assert.equal(other.mlSupported, false);
    assert.deepEqual(other.diseases, []);
    assert.deepEqual(other.kcStages, []);
  });
});

describe('Crop registry · seed application', () => {
  before(async () => {
    await startTestDatabase();
  });

  after(async () => {
    await stopTestDatabase();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('applies the seed and records a versioned seedMeta row', async () => {
    const result = await seed();

    assert.equal(result.skipped, false);
    assert.ok(result.upserted > 0);

    const meta = await SeedMeta.findOne({ seedName: 'registry' });
    assert.equal(meta.version, result.version);
    assert.ok(meta.appliedAt instanceof Date);
    assert.equal(meta.summary.documents, result.upserted);
  });

  it('is a no-op on an unchanged re-run', async () => {
    await seed();
    const before = await CropRegistry.countDocuments();

    const second = await seed();

    assert.equal(second.skipped, true, 'the seed re-applied unchanged content');
    assert.equal(await CropRegistry.countDocuments(), before, 'document count drifted');
  });

  it('re-runs without duplicating when forced', async () => {
    await seed();
    const before = await CropRegistry.countDocuments();

    const forced = await seed({ force: true });

    assert.equal(forced.skipped, false);
    assert.equal(await CropRegistry.countDocuments(), before, 'forcing duplicated documents');
  });

  it('applies a new version when the knowledge changes, keeping cropCode identity', async () => {
    await seed();
    const original = await CropRegistry.findOne({ cropCode: 'OTHER' });

    const changed = composeRegistry().documents.map((document) =>
      document.cropCode === 'OTHER' ? { ...document, altNames: ['misc'] } : document,
    );
    await seed({ documents: changed });

    const updated = await CropRegistry.findOne({ cropCode: 'OTHER' });
    // Same document, updated in place — crops reference registry by cropCode,
    // so a new _id here would orphan every farmer's crop.
    assert.equal(String(updated._id), String(original._id));
    assert.deepEqual(updated.altNames, ['misc']);

    const meta = await SeedMeta.findOne({ seedName: 'registry' });
    assert.equal(meta.version, registryVersion(changed));
  });

  it('writes nothing at all when any document is invalid', async () => {
    await seed();
    const before = await CropRegistry.countDocuments();
    const meta = await SeedMeta.findOne({ seedName: 'registry' });

    const broken = [
      ...composeRegistry().documents,
      // supportLevel is required and enum-constrained; this document cannot
      // be persisted.
      { cropCode: 'BROKEN', names: { en: 'Broken', hi: 'टूटा' }, supportLevel: 'NONSENSE' },
    ];

    await assert.rejects(
      () => seed({ documents: broken, force: true }),
      /Registry seed rejected/,
      'an invalid document was not caught before writing',
    );

    // Without transactions, validating up front is the only thing standing
    // between a bad document and a half-applied registry.
    assert.equal(await CropRegistry.countDocuments(), before, 'the collection was mutated');
    assert.equal(await CropRegistry.countDocuments({ cropCode: 'BROKEN' }), 0);
    const metaAfter = await SeedMeta.findOne({ seedName: 'registry' });
    assert.equal(metaAfter.version, meta.version, 'seedMeta advanced despite a failed seed');
  });

  it('leaves exactly one seedMeta row for the registry', async () => {
    await seed();
    await seed({ force: true });
    assert.equal(await SeedMeta.countDocuments({ seedName: 'registry' }), 1);
  });
});

describe('Crop registry · API', () => {
  let server;

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
    await seed();
  });

  it('serves summaries without a token', async () => {
    const res = await server.request('/api/v1/registry/crops');

    assert.equal(res.status, 200);
    assert.ok(res.body.data.crops.length > 0);
    assert.equal(res.body.meta.total, res.body.data.crops.length);

    const [first] = res.body.data.crops;
    assert.deepEqual(Object.keys(first).sort(), [
      'cropCode',
      'mlSupported',
      'names',
      'seasons',
      'supportLevel',
    ]);
  });

  it('serves a full document by code', async () => {
    const res = await server.request('/api/v1/registry/crops?code=OTHER');

    assert.equal(res.status, 200);
    assert.equal(res.body.data.crop.cropCode, 'OTHER');
    assert.equal(res.body.data.crop.supportLevel, 'UNSUPPORTED');
  });

  it('never exposes internal seeding fields', async () => {
    const res = await server.request('/api/v1/registry/crops?code=OTHER');

    assert.ok(!res.text.includes('seedVersion'));
    assert.ok(!res.text.includes('__v'));
  });

  it('answers 404 for an unknown code', async () => {
    const res = await server.request('/api/v1/registry/crops?code=NOSUCHCROP');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('supports conditional requests so offline clients can revalidate cheaply', async () => {
    const first = await server.request('/api/v1/registry/crops');
    const etag = first.headers.get('etag');

    assert.ok(etag, 'no ETag was issued');
    assert.match(first.headers.get('cache-control'), /max-age=3600/);

    const second = await server.request('/api/v1/registry/crops', {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(second.status, 304);
  });
});
