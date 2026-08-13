/**
 * Composes crop registry documents from the sourced knowledge files.
 *
 * The registry is assembled from four inputs, each of which is authoritative
 * for a different slice, so that no value in the database is without a source:
 *
 *   knowledge/crops.agronomy.json   FAO-56 Kc stages, root depth, depletion p
 *   knowledge/crops.base.json       names, seasons, water need, temp, market
 *   knowledge/crops.fertilizer.json the published NPK tables, units preserved
 *   datasets/manifest.json          the ML classes that actually have data,
 *                                   plus the ADR-021 support-tier decisions
 *
 * The manifest matters here: docs/ml/crop-class-mapping.md is stale — it still
 * lists Paddy Doctor rice classes that were rejected on licence grounds. The
 * manifest is generated from the verified corpus, so it wins.
 *
 * Fields that no source provides are LEFT OUT and recorded in `dataGaps`. An
 * absent field is honest; a plausible-looking default is a fabricated
 * agronomic claim (CLAUDE.md rule 7).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

const KNOWLEDGE_DIR = new URL('../knowledge/', import.meta.url);
const MANIFEST = new URL('../../../datasets/manifest.json', import.meta.url);

/** Optional inputs are tolerated so the seed runs before every file is authored. */
function readOptional(url) {
  try {
    return readJson(url);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * The LIMITED crop roster is a product decision, not a derivation: which ~20
 * crops the platform lists is someone's call to make. The proposal file
 * therefore only enters the seed once its `status` says so, which keeps an
 * un-reviewed list from reaching farmers just because the file exists.
 */
export function isApproved(section) {
  return typeof section?.status === 'string' && /^approved\b/i.test(section.status.trim());
}

/**
 * The disease KB arrives in two research parts (rice/tomato/potato and
 * chilli/cotton/maize) because it was sourced in two passes against different
 * institutions. They are concatenated rather than merged field-by-field: the
 * parts are disjoint by crop, so a code appearing in both would be a genuine
 * authoring conflict and is reported rather than silently resolved.
 */
export function loadDiseases() {
  const parts = ['crops.diseases.part-rtp.json', 'crops.diseases.part-ccm.json']
    .map((file) => readOptional(new URL(file, KNOWLEDGE_DIR)))
    .filter(Boolean);

  const byCode = new Map();
  const duplicates = [];

  for (const part of parts) {
    for (const disease of part.diseases ?? []) {
      if (byCode.has(disease.code)) {
        duplicates.push(disease.code);
        continue;
      }
      byCode.set(disease.code, disease);
    }
  }

  return { entries: [...byCode.values()], duplicates };
}

export function loadKnowledge() {
  const limited = readOptional(new URL('crops.limited.proposal.json', KNOWLEDGE_DIR));

  return {
    agronomy: readOptional(new URL('crops.agronomy.json', KNOWLEDGE_DIR)),
    base: readOptional(new URL('crops.base.json', KNOWLEDGE_DIR)),
    fertilizer: readOptional(new URL('crops.fertilizer.json', KNOWLEDGE_DIR)),
    diseases: loadDiseases(),
    limited: isApproved(limited) ? limited : null,
    limitedProposal: limited,
    manifest: readOptional(MANIFEST),
  };
}

/**
 * Research entry → registry sub-document.
 *
 * The knowledge files carry auditing fields the database has no use for —
 * `publishedSymptoms` (the verbatim source text the tags were derived from),
 * `tagDerivation`, `classCodeCaveat`. They stay in the repository, where a
 * reviewer can check the mapping, and are deliberately not copied into Mongo:
 * the registry serves farmers, and none of that is farmer-facing.
 */
export function composeDisease(entry) {
  return {
    code: entry.code,
    names: {
      en: entry.names?.en,
      // Null until a Hindi-literate reviewer signs it off (rule 8).
      hi: entry.names?.hi ?? null,
      hiVerified: entry.names?.hiVerified === true,
    },
    symptoms: entry.symptoms ?? [],
    inspect: entry.inspect ?? [],
    nextSteps: entry.nextSteps ?? [],
    prevention: entry.prevention ?? [],
    symptomTags: entry.symptomTags ?? [],
    expertThreshold: entry.expertThreshold ?? 0.4,
    sourceRefs: normalizeSourceRefs(entry.sourceRefs),
  };
}

/** `crops` may be an array or a code-keyed object; normalise to a Map. */
function toMap(section) {
  const crops = section?.crops ?? section;
  if (!crops) return new Map();
  if (Array.isArray(crops)) return new Map(crops.map((entry) => [entry.cropCode, entry]));
  return new Map(
    Object.entries(crops).map(([code, entry]) => [code, { cropCode: code, ...entry }]),
  );
}

/** Groups the manifest's flat class list by crop prefix. */
function mlClassesByCrop(manifest) {
  const byCrop = new Map();
  for (const classCode of Object.keys(manifest?.classes ?? {})) {
    const crop = classCode.split('_')[0];
    if (!byCrop.has(crop)) byCrop.set(crop, []);
    byCrop.get(crop).push(classCode);
  }
  for (const list of byCrop.values()) list.sort();
  return byCrop;
}

/**
 * Support level, in precedence order:
 *   1. the manifest's ADR-021 tier decisions (post-audit, approved)
 *   2. SPECIALIZED if the crop has trained-model classes
 *   3. whatever the base knowledge file states
 *   4. LIMITED
 */
function resolveSupportLevel({ cropCode, manifest, mlClasses, base }) {
  const decided = manifest?.support_tiers?.[cropCode];
  if (decided?.tier) return { level: decided.tier, reason: decided.decision ?? 'manifest' };
  if (mlClasses.length > 0) return { level: 'SPECIALIZED', reason: 'has trained ML classes' };
  if (base?.supportLevel) return { level: base.supportLevel, reason: 'knowledge file' };
  return { level: 'LIMITED', reason: 'default' };
}

/**
 * Provenance is authored two ways: a flat list on the document, or one
 * reference per field keyed by field name. Both collapse to a flat array here,
 * with the field name preserved so a reviewer can still tell which value a
 * reference justifies.
 */
function normalizeSourceRefs(refs) {
  if (!refs) return [];
  if (Array.isArray(refs)) return refs.filter(Boolean);

  return Object.entries(refs).flatMap(([field, value]) => {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.filter(Boolean).map((ref) => ({ field, ...ref }));
  });
}

/** Records, rather than silently drops, anything no source supplied. */
function collectGaps(document) {
  const gaps = [];
  const required = {
    kcStages: 'FAO-56 Kc stages not sourced',
    rootDepthM: 'FAO-56 maximum rooting depth not sourced',
    depletionFraction: 'FAO-56 depletion fraction p not sourced',
    waterNeedMm: 'seasonal water need not sourced',
    soilSuitability: 'soil suitability scores not sourced across the soil enum',
    tempOpt: 'optimum temperature range not sourced',
  };

  for (const [field, message] of Object.entries(required)) {
    const value = document[field];
    const missing =
      value == null ||
      (Array.isArray(value) && value.length === 0) ||
      (value instanceof Map && value.size === 0);
    if (missing) gaps.push(message);
  }

  // Rule 8: agronomic Hindi needs human sign-off before it reaches a farmer.
  // Carrying that forward as a gap keeps an unverified term visible instead of
  // letting it pass as settled just because it is present.
  if (document.names && document.names.hiVerified === false) {
    gaps.push('Hindi name not human-verified — requires sign-off before demo');
  }

  if (!document.diseases?.length && document.mlSupported) {
    // Enforced by docs/ml/crop-class-mapping.md: no diagnosis may ship without
    // farmer-facing guidance behind it.
    gaps.push('disease KB entries absent for trained ML classes — blocks model ship');
  }

  // The English KB may ship; the Hindi half may not, until a Hindi-literate
  // reviewer signs it off (rule 8). ADR-021 gates cotton's ship on bilingual KB
  // entries specifically, so this gap is what that gate reads.
  const unverifiedHindi = (document.diseases ?? []).filter(
    (disease) => !disease.names?.hi || disease.names?.hiVerified !== true,
  );
  if (unverifiedHindi.length) {
    gaps.push(
      `${unverifiedHindi.length} disease name(s) lack human-verified Hindi — blocks bilingual ship`,
    );
  }

  return gaps;
}

/**
 * Builds one registry document. Pure: same inputs produce the same output,
 * which is what makes the seed re-runnable and its hash meaningful.
 */
export function composeCrop({
  cropCode,
  agronomy,
  base,
  fertilizer,
  diseases,
  manifest,
  mlClasses,
}) {
  const supportLevel = resolveSupportLevel({ cropCode, manifest, mlClasses, base });

  const document = {
    cropCode,
    names: base?.names ?? agronomy?.names,
    altNames: base?.altNames ?? [],
    supportLevel: supportLevel.level,
    seasons: base?.seasons?.map((season) => season.toUpperCase()) ?? [],

    waterNeedMm: base?.waterNeedMm,
    soilSuitability: base?.soilSuitability,
    tempOpt: base?.tempOpt,
    durationDays: base?.durationDays,
    droughtSensitivity: base?.droughtSensitivity,

    kcStages: (agronomy?.kcStages ?? []).map((stage) => ({
      stage: stage.stage,
      days: stage.days,
      kc: stage.kc ?? null,
      sourceRefs: normalizeSourceRefs(stage.sourceRefs ?? stage.sourceRef),
    })),
    rootDepthM: agronomy?.rootDepthM?.value ?? agronomy?.rootDepthM,
    depletionFraction: agronomy?.depletionFraction?.value ?? agronomy?.depletionFraction,
    paddyFlooding: cropCode === 'RICE' ? true : undefined,
    simplifiedIntervals: agronomy?.simplifiedIntervals ?? [],

    sensitivity: base?.sensitivity,

    // Only a crop with a trained model may claim ML support, whatever a
    // knowledge file says.
    mlSupported: supportLevel.level === 'SPECIALIZED' && mlClasses.length > 0,
    mlClassCodes: mlClasses,

    diseases: diseases ?? [],
    fertilizer: fertilizer ?? undefined,
    market: base?.market,
    yield: base?.yield,

    sourceRefs: [
      ...normalizeSourceRefs(base?.sourceRefs),
      ...normalizeSourceRefs(agronomy?.sourceRefs),
    ],
  };

  // `paddyFlooding` is only meaningful where standing water is the practice;
  // undefined elsewhere keeps the false default out of unrelated documents.
  if (document.paddyFlooding === undefined) delete document.paddyFlooding;

  document.dataGaps = collectGaps(document);
  return document;
}

/**
 * A crop cannot be seeded without a bilingual name: every farmer-facing
 * surface renders from it, and an English-only entry would silently degrade
 * the Hindi UI. Missing names are a knowledge-authoring gap, not something to
 * paper over with a generated label.
 */
const isSeedable = (document) =>
  Boolean(document.cropCode && document.names?.en && document.names?.hi);

/**
 * The full set of documents the seed will apply.
 *
 * @returns {{ documents: object[], incomplete: {cropCode: string, missing: string}[],
 *             awaitingApproval: string[] }}
 *   `incomplete` and `awaitingApproval` are reported by the seed script and
 *   asserted by tests — a crop dropped for want of data, or for want of a
 *   sign-off, must never disappear quietly.
 */
export function composeRegistry(knowledge = loadKnowledge()) {
  const agronomy = toMap(knowledge.agronomy);
  const base = toMap(knowledge.base);
  const fertilizer = toMap(knowledge.fertilizer);
  const limited = toMap(knowledge.limited);
  const mlClasses = mlClassesByCrop(knowledge.manifest);

  // Disease entries carry their own `cropCode`, so they are grouped here rather
  // than being looked up per crop. Sorted by code so the composed document —
  // and therefore the seed version hash — does not depend on the order the two
  // research parts happened to be concatenated in.
  const diseasesByCrop = new Map();
  for (const entry of knowledge.diseases?.entries ?? []) {
    const bucket = diseasesByCrop.get(entry.cropCode) ?? [];
    bucket.push(composeDisease(entry));
    diseasesByCrop.set(entry.cropCode, bucket);
  }
  for (const bucket of diseasesByCrop.values()) {
    bucket.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }

  const codes = new Set([...agronomy.keys(), ...base.keys(), ...limited.keys()]);
  const documents = [];
  const incomplete = [];
  // Reported so an unapproved roster is visible rather than just absent.
  const awaitingApproval = knowledge.limited ? [] : [...toMap(knowledge.limitedProposal).keys()];

  for (const cropCode of [...codes].sort()) {
    const composed = composeCrop({
      cropCode,
      agronomy: agronomy.get(cropCode),
      base: base.get(cropCode) ?? limited.get(cropCode),
      fertilizer: fertilizer.get(cropCode),
      diseases: diseasesByCrop.get(cropCode) ?? [],
      manifest: knowledge.manifest,
      mlClasses: mlClasses.get(cropCode) ?? [],
    });

    if (isSeedable(composed)) {
      documents.push(composed);
    } else {
      incomplete.push({
        cropCode,
        missing: !composed.names ? 'names' : 'names.en or names.hi',
      });
    }
  }

  documents.push(otherCropDocument());
  return { documents, incomplete, awaitingApproval };
}

/**
 * The escape hatch for a crop the platform does not know.
 *
 * It exists as a real document so crop instances always resolve to something,
 * and it is deliberately empty of knowledge: UNSUPPORTED means the app says
 * "no disease intelligence for this crop" rather than showing a blank template
 * that reads like knowledge (docs/product/crop-support-matrix.md).
 */
export function otherCropDocument() {
  return {
    cropCode: 'OTHER',
    names: { en: 'Other crop', hi: 'अन्य फसल' },
    supportLevel: 'UNSUPPORTED',
    seasons: [],
    mlSupported: false,
    mlClassCodes: [],
    diseases: [],
    kcStages: [],
    dataGaps: ['unsupported crop placeholder — carries no agronomic knowledge by design'],
  };
}

/**
 * Content hash of the composed registry. The seed version changes whenever the
 * knowledge files change, so "already applied" can never mean "applied from
 * different data".
 */
export function registryVersion(documents) {
  const digest = createHash('sha256').update(JSON.stringify(documents)).digest('hex');
  return `registry-${digest.slice(0, 12)}`;
}
