/**
 * Every messageKey the API can emit must exist in both languages.
 *
 * The API deliberately returns keys rather than prose, which means a key with
 * no translation surfaces to the farmer as a raw identifier — or, with a
 * fallback configured, as English text on a Hindi screen. Both are product
 * failures that no other test would catch, so the check is mechanical: scan
 * the source for keys, then look each one up.
 *
 * Canonical resources: shared/i18n/{en,hi}/{namespace}.json (ADR-018).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  irrigationCandidate,
  marketCandidate,
  resolveContradictions,
  weatherRiskCandidate,
} from '../../src/engines/feedComposer/feedComposer.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const I18N = fileURLToPath(new URL('../../../shared/i18n/', import.meta.url));

/**
 * Namespaces the backend emits keys into (docs/i18n/architecture.md).
 * Extended as each subsystem lands; a namespace listed here must exist in both
 * `en` and `hi` with identical key sets.
 */
const NAMESPACES = [
  'errors',
  'auth',
  'farm',
  'crop',
  'weather',
  'irrigation',
  'market',
  'fertilizer',
  'cropRec',
  'health',
  'community',
];

/** Matches the quoted dotted keys passed to AppError/messageKey helpers. */
const KEY_PATTERN = new RegExp(`'((?:${NAMESPACES.join('|')})\\.[a-zA-Z0-9]+)'`, 'g');

/**
 * Near-miss namespaces. A key written `farms.limitReached` would simply not be
 * seen by the scanner above, so the guard would pass while the farmer got a
 * raw identifier — the exact failure this file exists to prevent. These are
 * matched explicitly and rejected.
 */
const WRONG_NAMESPACES = ['farms', 'crops', 'error', 'auths'];
const WRONG_KEY_PATTERN = new RegExp(`'((?:${WRONG_NAMESPACES.join('|')})\\.[a-zA-Z0-9]+)'`, 'g');

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function emittedKeys() {
  const keys = new Set();
  for (const file of sourceFiles(SRC)) {
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(KEY_PATTERN)) keys.add(match[1]);
  }
  return [...keys].sort();
}

const loadNamespace = (language, namespace) => {
  const file = path.join(I18N, language, `${namespace}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

describe('i18n · message keys', () => {
  const keys = emittedKeys();

  it('finds the keys the API emits', () => {
    assert.ok(keys.length > 0, 'no message keys were discovered — the scanner is broken');
  });

  it('uses no near-miss namespace that the scanner would silently skip', () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      for (const match of readFileSync(file, 'utf8').matchAll(WRONG_KEY_PATTERN)) {
        offenders.push(`${path.relative(SRC, file)}: ${match[1]}`);
      }
    }
    assert.deepEqual(offenders, [], `keys use a non-canonical namespace: ${offenders.join(', ')}`);
  });

  for (const language of ['en', 'hi']) {
    it(`resolves every emitted key in ${language}`, () => {
      const missing = [];

      for (const key of keys) {
        const [namespace, name] = key.split('.');
        const resources = loadNamespace(language, namespace);
        if (!resources || resources[name] === undefined) missing.push(key);
      }

      assert.deepEqual(missing, [], `missing ${language} translations: ${missing.join(', ')}`);
    });
  }

  it('keeps en and hi at full key parity', () => {
    // Parity in both directions: an orphaned Hindi key is dead weight, and an
    // English-only key is a farmer seeing the wrong language.
    for (const namespace of NAMESPACES) {
      const en = loadNamespace('en', namespace);
      const hi = loadNamespace('hi', namespace);
      if (!en && !hi) continue;

      assert.ok(en, `${namespace}: en resources missing`);
      assert.ok(hi, `${namespace}: hi resources missing`);
      assert.deepEqual(
        Object.keys(en).sort(),
        Object.keys(hi).sort(),
        `${namespace}: en/hi key sets differ`,
      );
    }
  });

  it('never ships an empty string as a translation', () => {
    for (const language of ['en', 'hi']) {
      for (const namespace of NAMESPACES) {
        const resources = loadNamespace(language, namespace);
        if (!resources) continue;
        for (const [name, value] of Object.entries(resources)) {
          assert.ok(
            typeof value === 'string' && value.trim().length > 0,
            `${language}/${namespace}.${name} is empty`,
          );
        }
      }
    }
  });
});

/**
 * Regression coverage for a real production bug: a feed item's `titleKey`/
 * `bodyKey` can resolve to an existing, non-empty translation (so every check
 * above passes) while the template's own `{{placeholder}}`s still render
 * literally, because the composer that builds `data` nested the values one
 * level deeper than the template expects. The checks above catch a missing
 * *key*; this catches a missing *param* — the one class of failure that let
 * `{{humidityThresholdPct}}`/`{{consecutiveDays}}` reach a farmer's screen.
 *
 * Each case builds a real feed item through the real composer functions
 * (fixture engine output in, composed item out — same contract
 * `feedComposer.test.js` exercises) and asserts every `{{…}}` placeholder in
 * both languages' actual template string has a corresponding, non-null value
 * in that item's `data` — the exact object `translateMessageKey` interpolates
 * against on the frontend.
 */
describe('i18n · interpolation params match what the feed composer actually supplies', () => {
  const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;
  const ASOF = new Date('2026-08-13T06:30:00.000Z');

  const placeholdersIn = (template) =>
    [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);

  function assertParamsSatisfy(namespace, key, data) {
    for (const language of ['en', 'hi']) {
      const resources = loadNamespace(language, namespace);
      const template = resources?.[key];
      assert.ok(typeof template === 'string', `${language}/${namespace}.${key} is missing`);

      for (const placeholder of placeholdersIn(template)) {
        assert.ok(
          data &&
            Object.prototype.hasOwnProperty.call(data, placeholder) &&
            data[placeholder] != null,
          `${language}/${namespace}.${key} needs {{${placeholder}}}, but the composed ` +
            `feed item's data has no usable value for it — this is exactly how a farmer ` +
            `ends up seeing raw "{{${placeholder}}}" text`,
        );
      }
    }
  }

  it("weatherRiskCandidate supplies every param each risk type's title/body needs", () => {
    // One fixture per risk type, shaped like the real engine's own output
    // (weatherRisk.js), so this exercises the composer's actual mapping —
    // not a shape invented for the test.
    const risks = [
      {
        type: 'HUMIDITY_DISEASE',
        level: 'HIGH',
        daysAhead: 1,
        date: '2026-08-14',
        thresholdSource: 'REGISTRY',
        data: {
          consecutiveDays: 3,
          humidityThresholdPct: 85,
          tempBandC: [25, 32],
          days: [],
          stage: 'MID',
        },
      },
      {
        type: 'DRY_SPELL',
        level: 'MEDIUM',
        daysAhead: 0,
        date: '2026-08-13',
        thresholdSource: 'ENGINE_DEFAULT',
        data: { totalMm: 2, thresholdMm: 5, windowDays: 7, stage: 'MID' },
      },
      {
        type: 'FROST',
        level: 'HIGH',
        daysAhead: 1,
        date: '2026-08-14',
        thresholdSource: 'REGISTRY',
        data: {
          tMinC: 1,
          thresholdC: 4,
          degreesUnder: 3,
          degreesPerBand: 2,
          baseBand: 1,
          stage: 'MID',
        },
      },
      {
        type: 'HEAT',
        level: 'HIGH',
        daysAhead: 1,
        date: '2026-08-14',
        thresholdSource: 'REGISTRY',
        data: { tMaxC: 43, thresholdC: 38, degreesOver: 5, degreesPerBand: 2, stage: 'MID' },
      },
      {
        type: 'HEAVY_RAIN',
        level: 'HIGH',
        daysAhead: 0,
        date: '2026-08-13',
        thresholdSource: 'REGISTRY',
        data: { rainMm: 60, rainProbPct: 80, thresholdMm: 50, probThresholdPct: 60, stage: 'MID' },
      },
      {
        type: 'WIND',
        level: 'MEDIUM',
        daysAhead: 0,
        date: '2026-08-13',
        thresholdSource: 'REGISTRY',
        data: { windKmh: 45, thresholdKmh: 40, stage: 'MID' },
      },
    ];

    for (const risk of risks) {
      const item = weatherRiskCandidate({
        userId: 'user-1',
        farmId: 'farm-1',
        cropId: 'crop-1',
        cropCode: 'WHEAT',
        risk,
        asOf: ASOF,
      });
      assert.ok(item, `${risk.type} fixture did not produce a feed item`);
      assertParamsSatisfy('weather', `title${risk.type}`, item.data);
      assertParamsSatisfy('weather', `body${risk.type}`, item.data);
    }
  });

  it('the RAIN_VS_IRRIGATE hybrid item supplies every param bodyHoldForRain needs', () => {
    const irrigation = irrigationCandidate({
      userId: 'user-1',
      farmId: 'farm-1',
      cropId: 'crop-1',
      cropCode: 'WHEAT',
      result: {
        hasVerdict: true,
        verdict: 'IRRIGATE_TODAY',
        amountMm: 30,
        amountLitersPerAcre: 121_406,
        mode: 'FULL',
        stage: 'MID',
        trace: [{ step: 'VERDICT', verdict: 'IRRIGATE_TODAY' }],
      },
      asOf: ASOF,
    });

    const rain = weatherRiskCandidate({
      userId: 'user-1',
      farmId: 'farm-1',
      cropId: 'crop-1',
      cropCode: 'WHEAT',
      risk: {
        type: 'HEAVY_RAIN',
        level: 'CRITICAL',
        daysAhead: 0,
        date: '2026-08-13',
        thresholdSource: 'REGISTRY',
        data: { rainMm: 120, rainProbPct: 90, thresholdMm: 50, probThresholdPct: 60 },
      },
      asOf: ASOF,
    });

    const [hybrid] = resolveContradictions([irrigation, rain]);
    assert.equal(hybrid.bodyKey, 'irrigation.bodyHoldForRain');
    assertParamsSatisfy('irrigation', 'bodyHoldForRain', hybrid.data);
  });

  it('marketCandidate supplies every param the RISING/FALLING guidance needs', () => {
    const rising = marketCandidate({
      userId: 'user-1',
      cropCode: 'ONION',
      signal: {
        trend: 'RISING',
        guidanceKey: 'market.guidanceRising',
        changePct7d: 12.34,
        trace: [{ step: 'WINDOWS' }],
      },
      previousTrend: 'FALLING',
      district: 'Bhopal',
      asOf: ASOF,
    });
    assert.ok(rising);
    assertParamsSatisfy('market', 'guidanceRising', rising.data);

    const falling = marketCandidate({
      userId: 'user-1',
      cropCode: 'ONION',
      signal: {
        trend: 'FALLING',
        guidanceKey: 'market.guidanceFalling',
        changePct7d: -8,
        trace: [{ step: 'WINDOWS' }],
      },
      previousTrend: 'RISING',
      district: 'Bhopal',
      asOf: ASOF,
    });
    assert.ok(falling);
    assertParamsSatisfy('market', 'guidanceFalling', falling.data);
  });
});
