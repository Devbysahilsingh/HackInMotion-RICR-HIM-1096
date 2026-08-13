#!/usr/bin/env node
/**
 * Local development seed.
 *
 * Creates one demo farmer with a farm, three crops and an irrigation ledger,
 * so every Phase 5 screen has something real to render the moment the stack
 * comes up.
 *
 * ## What this script does NOT create
 *
 * It writes **only** the rows a farmer could have created themselves through
 * the API. It does not fabricate weather snapshots, mandi prices, disease
 * analyses or feed items, because those are outputs of engines and ingest jobs
 * and a hand-written one would be indistinguishable from a real one once it is
 * in the database (CLAUDE.md rule 7). Those arrive the honest way:
 *
 *   weather → `npm run jobs -- weatherRefresh`  (Open-Meteo, keyless)
 *   feed    → `npm run jobs -- feedRefresh`     (engines over that weather)
 *   market  → `npm run seed:market`             (a real CEDA export on disk)
 *   health  → upload a photo through the app
 *
 * ## Idempotence
 *
 * Every write is an upsert keyed on something stable — the demo email, the
 * farm name under that user, the (crop, sowing date) pair — so re-running is a
 * no-op rather than a second farm. The password is only ever set on creation:
 * a re-run must not silently reset a password someone changed.
 *
 * Usage:
 *   node scripts/seed-dev.mjs [--reset]
 *
 * `--reset` deletes the demo account and everything cascading from it first.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import {
  Crop,
  CropHealthLog,
  Farm,
  IrrigationLog,
  Recommendation,
  User,
} from '../src/models/index.js';
import * as authService from '../src/services/authService.js';
import { deriveLocationKey } from '../src/utils/locationKey.js';

const reset = process.argv.includes('--reset');

/**
 * The seed refuses to touch a production database. It creates a known account
 * with a known password, which is exactly the thing that must never exist on a
 * deployed host.
 */
if (env.NODE_ENV === 'production') {
  console.error('seed-dev refuses to run with NODE_ENV=production');
  process.exit(1);
}

if (!env.MONGODB_URI) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

const email = (process.env.SEED_DEMO_EMAIL ?? 'demo@example.com').toLowerCase();
const password = process.env.SEED_DEMO_PASSWORD;

if (!password || password.length < 8) {
  console.error(
    'SEED_DEMO_PASSWORD must be set to at least 8 characters (see .env.example).',
  );
  process.exit(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

await connectDatabase(env.MONGODB_URI);

try {
  if (reset) {
    const existing = await User.findOne({ email }).select('_id').lean();
    if (existing) {
      const userId = existing._id;
      const removed = await Promise.all([
        IrrigationLog.deleteMany({ userId }),
        CropHealthLog.deleteMany({ userId }),
        Recommendation.deleteMany({ userId }),
        Crop.deleteMany({ userId }),
        Farm.deleteMany({ userId }),
      ]);
      await User.deleteOne({ _id: userId });
      console.log(
        `reset   removed demo account and ${removed.reduce((sum, r) => sum + r.deletedCount, 0)} owned documents`,
      );
    } else {
      console.log('reset   nothing to remove');
    }
  }

  // ── User ─────────────────────────────────────────────────────────────────
  //
  // Created through `authService.register`, not `User.create`, so the stored
  // credential is a real bcrypt-12 hash produced by the same code the live
  // registration endpoint runs. A seed that hashed passwords its own way could
  // drift from the login path and produce an account that cannot sign in.
  let user = await User.findOne({ email });
  let userCreated = false;

  if (!user) {
    user = await authService.register({
      name: 'Demo Farmer',
      email,
      password,
      language: 'en',
    });
    // Consent is off by default and cannot be set through registration; the
    // demo account opts in so the community screen has something to show.
    await User.updateOne({ _id: user._id }, { $set: { communityConsent: true } });
    userCreated = true;
  }

  console.log(`${userCreated ? 'create' : 'exists'}  user ${email}`);

  // ── Farm ─────────────────────────────────────────────────────────────────
  //
  // Nashik, Maharashtra: a real district with real coordinates, so the weather
  // job fetches a real grid cell rather than a made-up one.
  const location = {
    lat: 19.9975,
    lon: 73.7898,
    state: 'Maharashtra',
    district: 'Nashik',
    source: 'gps',
  };

  let farm = await Farm.findOne({ userId: user._id, name: 'North field' });
  if (!farm) {
    farm = await Farm.create({
      userId: user._id,
      name: 'North field',
      location,
      locationKey: deriveLocationKey(location),
      sizeValue: 2.5,
      sizeUnit: 'acre',
      soilType: 'black',
      irrigationMethod: 'drip',
      notes: 'Seeded for local development.',
    });
    console.log('create  farm North field');
  } else {
    console.log('exists  farm North field');
  }

  // ── Crops ────────────────────────────────────────────────────────────────
  //
  // Three crops chosen to exercise different code paths rather than to look
  // full: a specialized crop mid-season (irrigation + health + fertilizer all
  // have something to say), a paddy crop (the standing-water branch of the
  // irrigation engine), and a planned crop (the not-yet-in-the-ground branch).
  const cropSpecs = [
    { cropCode: 'TOMATO', sowingDate: daysAgo(45), variety: 'Pusa Ruby', areaValue: 1, status: 'active' },
    { cropCode: 'RICE', sowingDate: daysAgo(60), variety: 'IR-64', areaValue: 1, status: 'active' },
    { cropCode: 'WHEAT', sowingDate: new Date(Date.now() + 20 * DAY_MS), areaValue: 0.5, status: 'planned' },
  ];

  for (const spec of cropSpecs) {
    const existing = await Crop.findOne({
      userId: user._id,
      farmId: farm._id,
      cropCode: spec.cropCode,
    });

    if (existing) {
      console.log(`exists  crop ${spec.cropCode}`);
      continue;
    }

    await Crop.create({
      userId: user._id,
      farmId: farm._id,
      cropCode: spec.cropCode,
      sowingDate: spec.sowingDate,
      variety: spec.variety,
      areaValue: spec.areaValue,
      areaUnit: 'acre',
      status: spec.status,
    });
    console.log(`create  crop ${spec.cropCode}`);
  }

  // ── Irrigation ledger ────────────────────────────────────────────────────
  //
  // Two entries on the tomato, so the water-balance replay has a real anchor
  // and the engine reports `initialized: true` rather than a cold start.
  const tomato = await Crop.findOne({ userId: user._id, farmId: farm._id, cropCode: 'TOMATO' });

  if (tomato) {
    const ledger = [
      { date: daysAgo(9), amountMm: undefined },
      { date: daysAgo(4), amountMm: 25 },
    ];

    for (const entry of ledger) {
      const day = new Date(entry.date);
      day.setHours(0, 0, 0, 0);
      const nextDay = new Date(day.getTime() + DAY_MS);

      const existing = await IrrigationLog.findOne({
        cropId: tomato._id,
        date: { $gte: day, $lt: nextDay },
      });

      if (existing) continue;

      await IrrigationLog.create({
        userId: user._id,
        cropId: tomato._id,
        date: entry.date,
        ...(entry.amountMm === undefined ? {} : { amountMm: entry.amountMm }),
        // 'farmer' — the same provenance a hand-entered log carries. The other
        // value, 'assumed', means the engine inferred an event that nobody
        // recorded, and claiming that here would be a fabricated observation.
        source: 'farmer',
      });
      console.log(`create  irrigation log ${entry.date.toISOString().slice(0, 10)}`);
    }
  }

  console.log('\nSeed complete.');
  console.log(`  email    ${email}`);
  console.log('  password from SEED_DEMO_PASSWORD in backend/.env');
  console.log(
    '\nNo weather, market, health or feed rows were written — those are engine' +
      '\nand ingest outputs, not seed data. Populate them honestly with:' +
      '\n  npm run jobs -- weatherRefresh   (Open-Meteo; needs internet, no key)' +
      '\n  npm run jobs -- feedRefresh      (engines over the cached weather)' +
      '\n  npm run seed:market              (needs a real CEDA export on disk)',
  );
} finally {
  await disconnectDatabase();
}
