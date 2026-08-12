/**
 * Applies a composed registry to the database.
 *
 * Separated from the CLI so the same code path is exercised by tests — the
 * idempotency guarantee is worth nothing if the tested path and the operated
 * path differ.
 */

/**
 * @param {object} params
 * @param {import('mongoose').Model} params.CropRegistry
 * @param {import('mongoose').Model} params.SeedMeta
 * @param {object[]} params.documents
 * @param {string} params.version   content hash of `documents`
 * @param {boolean} [params.force]  re-apply even when the version matches
 * @returns {Promise<{skipped: boolean, upserted: number, version: string}>}
 */
export async function applyRegistrySeed({ CropRegistry, SeedMeta, documents, version, force }) {
  const applied = await SeedMeta.findOne({ seedName: 'registry' });

  if (!force && applied?.version === version) {
    return { skipped: true, upserted: 0, version };
  }

  // Validate everything before writing anything. Without transactions
  // (ADR-002) a document that fails validation halfway through would leave a
  // partially applied registry — some crops new, some stale, and a seedMeta
  // row that never got written to tell anyone. Failing before the first write
  // keeps the collection on its last good state.
  const invalid = [];
  for (const document of documents) {
    const error = new CropRegistry({ ...document, seedVersion: version }).validateSync();
    if (error) {
      invalid.push(`${document.cropCode}: ${Object.keys(error.errors).join(', ')}`);
    }
  }
  if (invalid.length > 0) {
    throw new Error(
      `Registry seed rejected — ${invalid.length} invalid documents:\n${invalid.join('\n')}`,
    );
  }

  // Upsert by cropCode, never by _id: farmers' crops reference the registry by
  // that immutable code, so reseeding must not create new identities beneath
  // them (docs/database/relationships.md).
  let upserted = 0;
  for (const document of documents) {
    await CropRegistry.updateOne(
      { cropCode: document.cropCode },
      { $set: { ...document, seedVersion: version } },
      { upsert: true, runValidators: true },
    );
    upserted += 1;
  }

  // seedMeta is written last. If the run dies partway, the version is not
  // recorded, so the next run re-applies rather than believing a partial seed
  // was complete — the safe direction for a non-transactional store (ADR-002).
  await SeedMeta.updateOne(
    { seedName: 'registry' },
    {
      $set: {
        version,
        appliedAt: new Date(),
        summary: {
          documents: documents.length,
          cropCodes: documents.map((document) => document.cropCode),
          withDataGaps: documents.filter((document) => document.dataGaps?.length).length,
        },
      },
    },
    { upsert: true },
  );

  return { skipped: false, upserted, version };
}
