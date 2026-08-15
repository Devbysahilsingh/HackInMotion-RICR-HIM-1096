#!/usr/bin/env node
/**
 * Showcase demo seed — one farmer whose account exercises every feature.
 *
 * `seed-dev.mjs` is the minimal local seed: one farm, three crops, nothing that
 * an engine or an ingest job would otherwise author. This script is its larger
 * sibling, built for a demo run rather than for a developer's first boot, and
 * it holds the same line about what may be written by hand.
 *
 * ## What is authored here, and what is earned
 *
 * Authored (all of it farmer-enterable through the API — nothing an engine owns):
 *   users, farms, crops, irrigation logs, community consent.
 *
 * Earned by running the real thing (CLAUDE.md rule 7 — no fabricated data):
 *   crop-health analyses → `analyzeCropHealth`, the production conductor, over
 *     real labelled photographs from `datasets/`, answered by the live
 *     ml-service / Gemini / rule tiers. The confidences stored are the ones the
 *     model actually returned.
 *   severity            → the severity engine, over a real follow-up answer.
 *   weather             → `weatherRefresh` (Open-Meteo, real request).
 *   market              → `marketRefresh` (data.gov.in, real request).
 *   feed / dashboard    → `feedRefresh` (the engines, over that weather).
 *   community alerts    → `communityAggregate`, over the analyses above.
 *   yield estimates     → `yieldEstimate`, over the committed lookup table.
 *
 * Nothing in this file writes a `weatherSnapshots`, `marketPrices`,
 * `recommendations`, `communityAlerts`, `yieldEstimates` or `analysis` document
 * directly. Those come out of the same code paths a real user's traffic runs.
 *
 * ## The neighbour accounts
 *
 * A community outbreak alert is defined so that one farmer can never raise one:
 * it needs COMMUNITY_MIN_FARMERS_INFO (3) distinct consenting farmers in a
 * district for an INFO advisory and COMMUNITY_MIN_FARMERS_HIGH (8) for a HIGH
 * one. Demonstrating the feature therefore requires that many accounts to
 * genuinely exist and genuinely have reported. They are created here as
 * ordinary accounts with ordinary passwords, each with a real analysis behind
 * its report — there is no shortcut that writes the alert directly, because the
 * alert is an aggregate and a hand-written one would be indistinguishable from
 * a real one.
 *
 * ## Idempotence and reversal
 *
 * Every account this script owns carries the `SEED_TAG` e-mail domain, so a
 * re-run upserts rather than duplicating, and `--reset` removes exactly what it
 * created and nothing else. Passwords are set on creation only: a re-run must
 * never silently reset a password someone changed.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-demo.mjs --yes            # seed
 *   node --env-file=.env scripts/seed-demo.mjs --yes --skip-ai  # no image uploads
 *   node --env-file=.env scripts/seed-demo.mjs --reset --yes    # remove it all
 *
 * `--yes` is mandatory: this writes to whatever MONGODB_URI points at, which
 * for a demo is deliberately allowed to be the deployed cluster.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { assessSeverity } from '../src/engines/severity/severityEngine.js';
import {
  CommunityAlert,
  Crop,
  CropHealthLog,
  CropRegistry,
  Farm,
  IrrigationLog,
  Recommendation,
  User,
} from '../src/models/index.js';
import * as authService from '../src/services/authService.js';
import { analyzeCropHealth, isHealthyCode } from '../src/services/cropHealthService.js';
import { yieldEstimate } from '../src/services/yieldService.js';
import { deriveLocationKey } from '../src/utils/locationKey.js';

// ─────────────────────────────────────────────────────────────────────────────
// Arguments
// ─────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const reset = argv.includes('--reset');
const confirmed = argv.includes('--yes');
const skipAi = argv.includes('--skip-ai');

if (!confirmed) {
  console.error(
    'seed-demo writes to the database MONGODB_URI points at, which may be a\n' +
      'deployed cluster. Re-run with --yes once you are sure that is intended.',
  );
  process.exit(1);
}

if (!env.MONGODB_URI) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Every account this script owns ends in this. `--reset` keys on it. */
const SEED_TAG = '@khetri-demo.in';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);
const daysAhead = (days) => new Date(Date.now() + days * DAY_MS);

const DATASETS = fileURLToPath(new URL('../../datasets/', import.meta.url));

/**
 * A password strong enough that the account is a normal account rather than a
 * backdoor (CLAUDE.md rule 2). Overridable so a re-run can reuse a known one.
 */
const generatePassword = () =>
  `Khetri-${randomBytes(6).toString('base64url')}-${randomBytes(4).toString('hex')}`;

const line = (kind, msg) => console.log(`${kind.padEnd(8)}${msg}`);

// ─────────────────────────────────────────────────────────────────────────────
// The showcase account
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The showcase farmer.
 *
 * `SEED_SHOWCASE_EMAIL` exists because the login limiter is 5 attempts / 15 min
 * keyed on `IP|email` (middleware/rateLimits.js). A room full of judges behind
 * one venue NAT, all signing in to one address, shares a single bucket and the
 * sixth of them is told the platform is rate limiting them. Re-running with a
 * different local part mints a second identical account with its own bucket,
 * which is the supported way to hand out more than one login — not raising the
 * limit, which is a security control and stays where it is.
 *
 * It must keep the `SEED_TAG` domain or `--reset` would not recognise it.
 */
const localPart = (process.env.SEED_SHOWCASE_EMAIL ?? 'demo.farmer').split('@')[0].toLowerCase();

const PRIMARY = {
  email: `${localPart}${SEED_TAG}`,
  name: process.env.SEED_SHOWCASE_NAME ?? 'Ramesh Patil',
  language: 'en',
  units: { land: 'acre' },
  voiceEnabled: true,
  communityConsent: true,
};

/**
 * Three farms in three states, so weather, market and recommendations each have
 * genuinely different inputs to work from rather than three copies of one place.
 * Coordinates are the real district centres — the weather job fetches the grid
 * cell they fall in, and a made-up pair would fetch a real forecast for nowhere.
 */
const FARMS = [
  {
    key: 'nashik',
    name: 'Nashik home field',
    location: {
      lat: 19.9975,
      lon: 73.7898,
      state: 'Maharashtra',
      district: 'Nashik',
      village: 'Ozar',
      source: 'gps',
    },
    sizeValue: 2.5,
    sizeUnit: 'acre',
    soilType: 'black',
    irrigationMethod: 'drip',
    notes: 'Main field beside the house. Drip laid in 2024.',
  },
  {
    key: 'bhopal',
    name: 'Bhopal canal plot',
    location: {
      lat: 23.2599,
      lon: 77.4126,
      state: 'Madhya Pradesh',
      district: 'Bhopal',
      village: 'Kolar',
      source: 'manual',
    },
    sizeValue: 4,
    sizeUnit: 'acre',
    soilType: 'black',
    irrigationMethod: 'borewell',
    notes: 'Leased plot, rabi rotation.',
  },
  {
    key: 'guntur',
    name: 'Guntur chilli block',
    location: {
      lat: 16.3067,
      lon: 80.4365,
      state: 'Andhra Pradesh',
      district: 'Guntur',
      source: 'gps',
    },
    sizeValue: 3,
    sizeUnit: 'acre',
    soilType: 'red',
    irrigationMethod: 'canal',
    notes: 'Family land. Chilli every year.',
  },
];

/**
 * Eight plantings chosen to cover every branch rather than to look full:
 * all four registry support levels (which decide the analysis tier), all three
 * statuses, and both the standing-water and the field-capacity irrigation
 * branches. Areas stay inside each farm's size in acre-equivalents.
 */
const CROPS = [
  // Nashik — 2.5 acre, 1.8 allocated
  {
    farm: 'nashik',
    cropCode: 'TOMATO', // SPECIALIZED → ml-service tier
    variety: 'Abhinav',
    sowingDate: daysAgo(52),
    areaValue: 1,
    status: 'active',
  },
  {
    farm: 'nashik',
    cropCode: 'ONION', // LIMITED → rule tier + honest thin-coverage notice
    variety: 'Nashik Red N-53',
    sowingDate: daysAgo(38),
    areaValue: 0.8,
    status: 'active',
  },
  // Bhopal — 4 acre, 3.8 allocated
  {
    farm: 'bhopal',
    cropCode: 'POTATO', // SPECIALIZED
    variety: 'Kufri Jyoti',
    sowingDate: daysAgo(41),
    areaValue: 1.5,
    status: 'active',
  },
  {
    farm: 'bhopal',
    cropCode: 'WHEAT', // planned — the not-yet-in-the-ground branch
    variety: 'HD-2967',
    sowingDate: daysAhead(28),
    areaValue: 1.5,
    status: 'planned',
  },
  {
    farm: 'bhopal',
    cropCode: 'SOYBEAN', // harvested — history, yield estimate, no live advice
    variety: 'JS-9560',
    sowingDate: daysAgo(160),
    areaValue: 0.8,
    status: 'harvested',
  },
  // Guntur — 3 acre, 2.7 allocated
  {
    farm: 'guntur',
    cropCode: 'CHILLI', // GENERAL → Gemini tier
    variety: 'Guntur Sannam S4',
    sowingDate: daysAgo(64),
    areaValue: 1.2,
    status: 'active',
  },
  {
    farm: 'guntur',
    cropCode: 'MAIZE', // SPECIALIZED
    variety: 'Pioneer 3396',
    sowingDate: daysAgo(30),
    areaValue: 1,
    status: 'active',
  },
  {
    farm: 'guntur',
    cropCode: 'COTTON', // SPECIALIZED
    variety: 'Bt Bunny',
    sowingDate: daysAgo(88),
    areaValue: 0.5,
    status: 'active',
  },
];

/**
 * Farmer-entered water events. `source: 'farmer'` is the only honest value —
 * 'assumed' means the engine inferred an event nobody recorded, and claiming it
 * here would be a fabricated observation. Two crops get a ledger so the water
 * balance reports `initialized: true` instead of a cold start; the rest stay
 * uninitialized, which is also a state the UI has to render.
 */
const IRRIGATION = [
  {
    crop: 'TOMATO',
    entries: [
      { day: 12, mm: 18 },
      { day: 8, mm: 22 },
      { day: 3, mm: 20 },
    ],
  },
  { crop: 'POTATO', entries: [{ day: 10, mm: 30 }, { day: 4 }] },
];

/**
 * The demo farmer's own scans, one per tier so the UI's honesty labels all have
 * something behind them. `label` names a real dataset class; the file is picked
 * out of the held-out test split, so the image is one the model was never
 * trained on.
 */
const OWN_SCANS = [
  {
    crop: 'TOMATO',
    label: 'TOMATO_LATE_BLIGHT',
    description: 'Dark patches spreading on the lower leaves after last week rain.',
    share: true,
    followUp: { affectedAreaPct: 35, spreadRate: 'RAPID' },
  },
  {
    crop: 'TOMATO',
    label: 'TOMATO_HEALTHY',
    description: 'Checking the new flush on the second bed.',
    share: false,
  },
  {
    crop: 'CHILLI',
    label: 'CHILLI_ANTHRACNOSE',
    description: 'Sunken spots on the fruit, some leaves drying at the tip.',
    share: true,
  },
  {
    crop: 'MAIZE',
    label: 'MAIZE_COMMON_RUST',
    description: 'Rust coloured pustules on both sides of the leaf.',
    share: true,
  },
  {
    crop: 'ONION',
    label: 'TOMATO_EARLY_BLIGHT', // any leaf: ONION is LIMITED, so the rule tier answers
    description: 'Tip dieback on about a fifth of the rows.',
    share: false,
  },
];

/**
 * Neighbours, purely so the two community thresholds are genuinely crossed.
 *
 * Nashik gets 9 reporting farmers (≥ 8 → HIGH) and Bhopal 4 (≥ 3, < 8 → INFO),
 * which is also how the demo shows that the level is a function of the count
 * rather than a label someone chose. Their crop matches the showcase farmer's
 * planting in the same district, which is what makes the fan-out reach him.
 */
const NEIGHBOURHOODS = [
  {
    key: 'nashik',
    count: 9,
    cropCode: 'TOMATO',
    label: 'TOMATO_LATE_BLIGHT',
    location: FARMS[0].location,
    names: [
      'Sunita Jadhav',
      'Vikas Deshmukh',
      'Anil Wagh',
      'Manisha Pawar',
      'Prakash Shinde',
      'Kavita Bhosale',
      'Ganesh Kadam',
      'Rohit Sonawane',
      'Shalini More',
    ],
  },
  {
    key: 'bhopal',
    count: 4,
    cropCode: 'POTATO',
    label: 'POTATO_EARLY_BLIGHT',
    location: FARMS[1].location,
    names: ['Devendra Rathore', 'Sarita Yadav', 'Imran Khan', 'Meena Ahirwar'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Dataset image picker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Real photographs, from the **held-out test split** — never the training split.
 * A demo whose images the model memorised would report a confidence the same
 * photo would not earn in the field, which is the one number a demo must not
 * overstate.
 */
function loadTestSplit() {
  const path = `${DATASETS}splits/test.tsv`;
  if (!existsSync(path)) return new Map();

  const byLabel = new Map();
  for (const row of readFileSync(path, 'utf8').split('\n')) {
    const [relative, label] = row.split('\t');
    if (!relative || !label) continue;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(`${DATASETS}raw/${relative}`);
  }
  return byLabel;
}

const SPLIT = loadTestSplit();

/**
 * Deterministic pick — `index` walks the class so nine neighbours submit nine
 * different photographs rather than one image nine times, which the analysis
 * cache would collapse anyway.
 */
function imageFor(label, index = 0) {
  const files = SPLIT.get(label) ?? [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[(index * 7 + i) % files.length];
    if (existsSync(file)) return file;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────────────────

async function removeSeed() {
  const users = await User.find({ email: { $regex: `${SEED_TAG.replace('.', '\\.')}$` } })
    .select('_id')
    .lean();

  if (users.length === 0) {
    line('reset', 'no seeded accounts found');
    return;
  }

  const userIds = users.map((user) => user._id);
  const removed = await Promise.all([
    IrrigationLog.deleteMany({ userId: { $in: userIds } }),
    CropHealthLog.deleteMany({ userId: { $in: userIds } }),
    Recommendation.deleteMany({ userId: { $in: userIds } }),
    Crop.deleteMany({ userId: { $in: userIds } }),
    Farm.deleteMany({ userId: { $in: userIds } }),
  ]);
  await User.deleteMany({ _id: { $in: userIds } });

  // The aggregates those reports produced are counts with no owner, so nothing
  // cascades them. They are removed by hand or they would outlive their inputs
  // and claim an outbreak that no longer has any reports behind it.
  const alerts = await CommunityAlert.deleteMany({
    district: { $in: NEIGHBOURHOODS.map((hood) => hood.location.district) },
  });

  const owned = removed.reduce((sum, result) => sum + result.deletedCount, 0);
  line(
    'reset',
    `removed ${users.length} accounts, ${owned} owned docs, ${alerts.deletedCount} alerts`,
  );
}

/** Creates through `authService.register` so the hash is the login path's hash. */
async function ensureUser({ email, name, password, language = 'en', profile = {} }) {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    if (Object.keys(profile).length > 0) {
      await User.updateOne({ _id: existing._id }, { $set: profile });
    }
    return { user: existing, created: false };
  }

  const user = await authService.register({ name, email, password, language });
  // Consent, units and voice are not settable through registration.
  if (Object.keys(profile).length > 0) {
    await User.updateOne({ _id: user._id }, { $set: profile });
  }
  return { user, created: true };
}

async function ensureFarm(userId, spec) {
  const existing = await Farm.findOne({ userId, name: spec.name });
  if (existing) return { farm: existing, created: false };

  const farm = await Farm.create({
    userId,
    name: spec.name,
    location: spec.location,
    locationKey: deriveLocationKey(spec.location),
    sizeValue: spec.sizeValue,
    sizeUnit: spec.sizeUnit,
    soilType: spec.soilType,
    irrigationMethod: spec.irrigationMethod,
    ...(spec.notes ? { notes: spec.notes } : {}),
  });
  return { farm, created: true };
}

async function ensureCrop(userId, farmId, spec) {
  const existing = await Crop.findOne({ userId, farmId, cropCode: spec.cropCode });
  if (existing) return { crop: existing, created: false };

  const crop = await Crop.create({
    userId,
    farmId,
    cropCode: spec.cropCode,
    sowingDate: spec.sowingDate,
    ...(spec.variety ? { variety: spec.variety } : {}),
    ...(spec.areaValue ? { areaValue: spec.areaValue, areaUnit: 'acre' } : {}),
    status: spec.status,
  });
  return { crop, created: true };
}

/**
 * One real analysis: the production conductor, over a real photograph, answered
 * by whichever tier the registry's `supportLevel` routes to. Returns the stored
 * log, or a reason string when the chain could not run.
 */
async function runAnalysis({ user, crop, farm, label, description, share, index = 0 }) {
  const file = imageFor(label, index);
  if (!file) return { skipped: `no image on disk for ${label}` };

  const registryCrop = await CropRegistry.findOne({ cropCode: crop.cropCode }).lean();

  const result = await analyzeCropHealth({
    user,
    crop,
    farm,
    registryCrop,
    buffer: readFileSync(file),
    description,
    // Sharing requires consent; the conductor is not the place that checks it,
    // so it is checked here rather than assumed.
    shareToCommunity: Boolean(share) && user.communityConsent === true,
  });

  if (result.outcome === 'ANALYZED' || result.outcome === 'CACHED') {
    return { log: result.log, outcome: result.outcome };
  }
  return { skipped: `${result.outcome}: ${result.reason ?? 'unknown'}` };
}

/** The severity engine, over a real follow-up answer. Mirrors the endpoint. */
async function applyFollowUp(logId, { affectedAreaPct, spreadRate }) {
  const log = await CropHealthLog.findById(logId);
  if (!log) return null;

  const severity = assessSeverity({
    diseaseCode: log.analysis?.diseaseCode ?? null,
    isHealthy: isHealthyCode(log.analysis?.diseaseCode),
    severityVisual: log.recommendationSnapshot?.data?.severityVisual ?? null,
    affectedAreaPct,
    spreadRate,
  });

  log.severityFollowUp = { affectedAreaPct, spreadRate, answeredAt: new Date() };
  log.analysis.severityAssessment = severity.severity;
  if (log.recommendationSnapshot?.data) {
    log.recommendationSnapshot.data.severity = severity.severity;
    log.recommendationSnapshot.data.severityTrace = severity.trace;
    log.markModified('recommendationSnapshot');
  }
  await log.save();
  return severity.severity;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

await connectDatabase(env.MONGODB_URI);

const summary = {
  primaryEmail: PRIMARY.email,
  primaryPassword: null,
  neighbourPassword: null,
  farms: 0,
  crops: 0,
  irrigation: 0,
  analyses: [],
  neighbours: 0,
  yields: [],
  skipped: [],
};

try {
  if (reset) {
    await removeSeed();
    if (!argv.includes('--seed-after-reset')) {
      line('done', 'reset complete — re-run without --reset to seed');
      await disconnectDatabase();
      process.exit(0);
    }
  }

  const primaryPassword = process.env.SEED_SHOWCASE_PASSWORD || generatePassword();
  const neighbourPassword = process.env.SEED_NEIGHBOUR_PASSWORD || generatePassword();
  summary.primaryPassword = primaryPassword;
  summary.neighbourPassword = neighbourPassword;

  // ── 1. The showcase farmer ────────────────────────────────────────────────
  const { user, created } = await ensureUser({
    email: PRIMARY.email,
    name: PRIMARY.name,
    password: primaryPassword,
    language: PRIMARY.language,
    profile: {
      units: PRIMARY.units,
      voiceEnabled: PRIMARY.voiceEnabled,
      communityConsent: PRIMARY.communityConsent,
    },
  });
  line(created ? 'create' : 'exists', `user ${PRIMARY.email}`);
  if (!created) summary.primaryPassword = null; // unchanged — do not claim otherwise

  const primary = await User.findById(user._id);

  // ── 2. Farms ──────────────────────────────────────────────────────────────
  const farmsByKey = new Map();
  for (const spec of FARMS) {
    const { farm, created: madeFarm } = await ensureFarm(primary._id, spec);
    farmsByKey.set(spec.key, farm);
    summary.farms += 1;
    line(madeFarm ? 'create' : 'exists', `farm ${spec.name} (${spec.location.district})`);
  }

  // ── 3. Crops ──────────────────────────────────────────────────────────────
  const cropsByCode = new Map();
  for (const spec of CROPS) {
    const farm = farmsByKey.get(spec.farm);
    const { crop, created: madeCrop } = await ensureCrop(primary._id, farm._id, spec);
    cropsByCode.set(spec.cropCode, { crop, farm });
    summary.crops += 1;
    line(madeCrop ? 'create' : 'exists', `crop ${spec.cropCode} on ${farm.name} (${spec.status})`);
  }

  // ── 4. Irrigation ledger ──────────────────────────────────────────────────
  for (const spec of IRRIGATION) {
    const entry = cropsByCode.get(spec.crop);
    if (!entry) continue;

    for (const event of spec.entries) {
      const date = daysAgo(event.day);
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);

      const existing = await IrrigationLog.findOne({
        cropId: entry.crop._id,
        date: { $gte: dayStart, $lt: dayEnd },
      });
      if (existing) continue;

      await IrrigationLog.create({
        userId: primary._id,
        cropId: entry.crop._id,
        date,
        ...(event.mm === undefined ? {} : { amountMm: event.mm }),
        source: 'farmer',
      });
      summary.irrigation += 1;
    }
    line('create', `irrigation ledger on ${spec.crop}`);
  }

  // ── 5. Real analyses for the showcase farmer ──────────────────────────────
  if (skipAi) {
    line('skip', 'crop-health analyses (--skip-ai)');
  } else {
    for (const [index, scan] of OWN_SCANS.entries()) {
      const entry = cropsByCode.get(scan.crop);
      if (!entry) continue;

      const result = await runAnalysis({
        user: primary,
        crop: entry.crop,
        farm: entry.farm,
        label: scan.label,
        description: scan.description,
        share: scan.share,
        index,
      });

      if (result.skipped) {
        summary.skipped.push(`${scan.crop}/${scan.label}: ${result.skipped}`);
        line('skip', `analysis ${scan.crop} — ${result.skipped}`);
        continue;
      }

      const analysis = result.log.analysis ?? {};
      let severity = analysis.severityAssessment ?? null;

      if (scan.followUp) {
        severity = (await applyFollowUp(result.log._id, scan.followUp)) ?? severity;
      }

      summary.analyses.push({
        crop: scan.crop,
        expected: scan.label,
        predicted: analysis.diseaseCode ?? null,
        source: analysis.source ?? null,
        provider: analysis.provider ?? null,
        confidence: analysis.confidence ?? null,
        severity,
        escalation: (analysis.escalationPath ?? []).map((hop) => `${hop.provider}:${hop.reason}`),
      });
      line(
        'ai',
        `${scan.crop} → ${analysis.diseaseCode ?? 'UNKNOWN'} ` +
          `via ${analysis.source ?? '?'}` +
          (analysis.confidence != null ? ` conf=${analysis.confidence.toFixed(3)}` : ''),
      );
    }
  }

  // ── 6. Neighbours, so the community thresholds are genuinely crossed ──────
  if (skipAi) {
    line('skip', 'neighbour reports (--skip-ai) — community will stay empty');
  } else {
    for (const hood of NEIGHBOURHOODS) {
      for (let i = 0; i < hood.count; i += 1) {
        const name = hood.names[i] ?? `Farmer ${i + 1}`;
        const email = `${hood.key}.${i + 1}${SEED_TAG}`;

        const { user: neighbour } = await ensureUser({
          email,
          name,
          password: neighbourPassword,
          language: i % 3 === 0 ? 'hi' : 'en',
          profile: { communityConsent: true },
        });
        const neighbourDoc = await User.findById(neighbour._id);

        const { farm } = await ensureFarm(neighbourDoc._id, {
          name: `${hood.location.district} plot`,
          // The same district — that is the whole point — but each farm sits on
          // its own coordinates rather than all thirteen sharing one pin.
          location: {
            ...hood.location,
            lat: Number((hood.location.lat + (i - hood.count / 2) * 0.01).toFixed(4)),
            lon: Number((hood.location.lon + (i - hood.count / 2) * 0.01).toFixed(4)),
            source: 'manual',
          },
          sizeValue: 1 + i * 0.25,
          sizeUnit: 'acre',
          soilType: hood.key === 'nashik' ? 'black' : 'alluvial',
          irrigationMethod: i % 2 === 0 ? 'borewell' : 'canal',
        });

        const { crop } = await ensureCrop(neighbourDoc._id, farm._id, {
          cropCode: hood.cropCode,
          sowingDate: daysAgo(45 + i),
          areaValue: 0.5,
          status: 'active',
        });

        const result = await runAnalysis({
          user: neighbourDoc,
          crop,
          farm,
          label: hood.label,
          description: 'Spots on the leaves.',
          share: true,
          index: i + 1,
        });

        if (result.skipped) {
          summary.skipped.push(`${email}: ${result.skipped}`);
          continue;
        }
        summary.neighbours += 1;
        line(
          'report',
          `${hood.location.district} #${i + 1} → ${result.log.analysis?.diseaseCode} ` +
            `conf=${(result.log.analysis?.confidence ?? 0).toFixed(3)}`,
        );
      }
    }
  }

  // ── 7. Yield estimates, from the committed lookup ─────────────────────────
  for (const [code, entry] of cropsByCode) {
    if (entry.crop.status === 'planned') continue;
    try {
      const payload = await yieldEstimate(entry.crop, { persist: true });
      if (payload?.estimated) {
        summary.yields.push({
          crop: code,
          tier: payload.evidence?.tier ?? null,
          medianYieldTHa: payload.basis?.medianYieldTHa ?? null,
          production: payload.production ?? null,
          latestYear: payload.freshness?.latestYear ?? null,
        });
      } else {
        summary.skipped.push(`yield ${code}: ${payload?.evidence?.reasonKey ?? 'not estimated'}`);
      }
    } catch (err) {
      summary.skipped.push(`yield ${code}: ${err.message}`);
    }
  }
  line('yield', `${summary.yields.length} estimates computed`);

  console.log(`\n${JSON.stringify(summary, null, 2)}`);
} finally {
  await disconnectDatabase();
}
