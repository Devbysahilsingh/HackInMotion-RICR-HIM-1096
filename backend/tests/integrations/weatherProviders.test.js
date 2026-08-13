/**
 * Weather providers — request shape and payload normalisation.
 *
 * Both integrations are driven through the `fetchImpl` seam with recorded-shape
 * payloads, so nothing here touches the network or spends free-tier quota. The
 * fixtures reproduce the *structure* of each provider's response (columnar for
 * Open-Meteo, a 3-hourly `list` for OpenWeatherMap); the numbers are chosen so
 * the aggregation arithmetic is checkable by hand and are not agronomic claims.
 *
 * The contract being asserted is that two very different upstream shapes come
 * out as the *same* canonical row — otherwise a fallback day would be quietly
 * incomparable to a primary day and the irrigation engine would never know.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_TIMEZONE,
  WEATHER_FORECAST_DAYS,
  WEATHER_PAST_DAYS,
} from '../../src/config/constants.js';
import * as openMeteo from '../../src/integrations/openMeteo.js';
import * as owm from '../../src/integrations/openWeatherMap.js';
import { safeUrl } from '../../src/utils/httpClient.js';

// ── Shared stub ─────────────────────────────────────────────────────────────

/** Returns a fetch stub that answers `body`, recording every call. */
function stubFetch(body, { status = 200 } = {}) {
  const calls = [];
  const impl = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  };
  impl.calls = calls;
  return impl;
}

const NAGPUR = { lat: 21.1, lon: 79.1 };

// ════════════════════════════════════════════════════════════════════════════
// Open-Meteo (primary)
// ════════════════════════════════════════════════════════════════════════════

/** The seven daily variables the request asks for, in request order. */
const OPEN_METEO_VARIABLES = [
  'temperature_2m_min',
  'temperature_2m_max',
  'relative_humidity_2m_mean',
  'wind_speed_10m_max',
  'precipitation_sum',
  'precipitation_probability_max',
  'et0_fao_evapotranspiration',
];

const OPEN_METEO_TIME = ['2026-08-11', '2026-08-12', '2026-08-13'];

/** A columnar body with one column per requested variable. */
const columnarBody = (columns = {}) => ({
  daily: {
    time: OPEN_METEO_TIME,
    temperature_2m_min: [24.1, 23.4, 25.0],
    temperature_2m_max: [33.2, 31.8, 34.6],
    relative_humidity_2m_mean: [71, 78, 66],
    wind_speed_10m_max: [12.5, 9.4, 15.1],
    precipitation_sum: [0, 12.4, 3.1],
    precipitation_probability_max: [10, 85, 40],
    et0_fao_evapotranspiration: [4.2, 3.1, 4.8],
    ...columns,
  },
  daily_units: { temperature_2m_max: '°C', precipitation_sum: 'mm' },
  timezone: APP_TIMEZONE,
});

describe('Open-Meteo · buildUrl pins every unit and window', () => {
  const url = openMeteo.buildUrl(NAGPUR);
  const parsed = new URL(url);
  const query = parsed.searchParams;

  it('targets the documented forecast endpoint', () => {
    assert.equal(parsed.origin + parsed.pathname, 'https://api.open-meteo.com/v1/forecast');
    assert.equal(query.get('latitude'), '21.1');
    assert.equal(query.get('longitude'), '79.1');
  });

  it('asks for all seven daily variables', () => {
    assert.deepEqual(query.get('daily').split(','), OPEN_METEO_VARIABLES);
  });

  it('fixes the day boundary to IST rather than letting the provider infer one', () => {
    assert.equal(query.get('timezone'), APP_TIMEZONE);
    // Asserted on the raw string too: the encoded form is what goes on the wire.
    assert.ok(url.includes('timezone=Asia%2FKolkata'), url);
    assert.ok(!url.includes('timezone=auto'));
  });

  it('requests 7 past and 7 forecast days', () => {
    assert.equal(query.get('past_days'), String(WEATHER_PAST_DAYS));
    assert.equal(query.get('forecast_days'), String(WEATHER_FORECAST_DAYS));
    assert.equal(query.get('past_days'), '7');
    assert.equal(query.get('forecast_days'), '7');
  });

  it('pins the units, so an upstream default change cannot alter the numbers', () => {
    assert.equal(query.get('wind_speed_unit'), 'kmh');
    assert.equal(query.get('temperature_unit'), 'celsius');
    assert.equal(query.get('precipitation_unit'), 'mm');
  });

  it('carries no key — ADR-007 chose a keyless provider', () => {
    for (const [name] of query) {
      assert.ok(!/key|token|appid/i.test(name), `unexpected credential parameter ${name}`);
    }
  });
});

describe('Open-Meteo · the columnar response is transposed to one row per day', () => {
  it('produces exactly one row per `time` entry, mapped onto canonical fields', async () => {
    const impl = stubFetch(columnarBody());

    const result = await openMeteo.fetchDaily({ ...NAGPUR, fetchImpl: impl });

    assert.equal(result.source, 'open-meteo');
    assert.equal(result.daily.length, OPEN_METEO_TIME.length);
    assert.equal(impl.calls.length, 1);

    assert.deepEqual(result.daily[0], {
      date: '2026-08-11',
      tMinC: 24.1,
      tMaxC: 33.2,
      humidityPct: 71,
      windKmh: 12.5,
      rainMm: 0,
      rainProbPct: 10,
      et0Mm: 4.2,
    });
    assert.deepEqual(result.daily[1], {
      date: '2026-08-12',
      tMinC: 23.4,
      tMaxC: 31.8,
      humidityPct: 78,
      windKmh: 9.4,
      rainMm: 12.4,
      rainProbPct: 85,
      et0Mm: 3.1,
    });
  });

  it('keeps the provider order rather than re-sorting', async () => {
    const result = await openMeteo.fetchDaily({
      ...NAGPUR,
      fetchImpl: stubFetch(columnarBody()),
    });

    assert.deepEqual(
      result.daily.map((row) => row.date),
      OPEN_METEO_TIME,
    );
  });

  it('carries a provider null through as null — never as a zero it did not measure', async () => {
    const result = await openMeteo.fetchDaily({
      ...NAGPUR,
      fetchImpl: stubFetch(columnarBody({ et0_fao_evapotranspiration: [4.2, null, 4.8] })),
    });

    assert.equal(result.daily[1].et0Mm, null);
    assert.notEqual(result.daily[1].et0Mm, 0);
    assert.equal(result.daily[0].et0Mm, 4.2);
  });

  it('yields null, not undefined, where a column is shorter than `time`', async () => {
    const result = await openMeteo.fetchDaily({
      ...NAGPUR,
      fetchImpl: stubFetch(columnarBody({ precipitation_sum: [0] })),
    });

    assert.equal(result.daily[1].rainMm, null);
    assert.ok('rainMm' in result.daily[1]);
  });

  it('keeps only the units block and timezone as `raw`', async () => {
    const result = await openMeteo.fetchDaily({
      ...NAGPUR,
      fetchImpl: stubFetch(columnarBody()),
    });

    assert.deepEqual(result.raw, {
      daily_units: { temperature_2m_max: '°C', precipitation_sum: 'mm' },
      timezone: APP_TIMEZONE,
    });
  });
});

describe('Open-Meteo · a payload missing a requested variable is refused', () => {
  /** Every variable except the named one. */
  const withoutVariable = (missing) => {
    const body = columnarBody();
    delete body.daily[missing];
    return body;
  };

  it('reports {daily: null, invalid: "schema"} rather than throwing', async () => {
    const result = await openMeteo.fetchDaily({
      ...NAGPUR,
      fetchImpl: stubFetch(withoutVariable('et0_fao_evapotranspiration')),
    });

    assert.deepEqual(result, { source: 'open-meteo', daily: null, invalid: 'schema' });
  });

  it('does so for any of the seven variables, not just ET₀', async () => {
    for (const variable of OPEN_METEO_VARIABLES) {
      const result = await openMeteo.fetchDaily({
        ...NAGPUR,
        fetchImpl: stubFetch(withoutVariable(variable)),
      });

      assert.equal(result.daily, null, `a payload without ${variable} was accepted`);
      assert.equal(result.invalid, 'schema');
    }
  });

  it('refuses a body with no `daily` block at all', async () => {
    const result = await openMeteo.fetchDaily({
      ...NAGPUR,
      fetchImpl: stubFetch({ error: true, reason: 'Latitude must be in range' }),
    });

    assert.equal(result.daily, null);
    assert.equal(result.invalid, 'schema');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OpenWeatherMap (fallback)
// ════════════════════════════════════════════════════════════════════════════

/** Fabricated key; it exists only so redaction can be asserted. */
const OWM_KEY = 'ffffffff00000000ffffffff00000000'; // pragma: allowlist-secret

const epochOf = (isoUtc) => Math.floor(Date.parse(isoUtc) / 1000);

/** One 3-hourly step, with the fields the schema requires. */
const step = (isoUtc, overrides = {}) => ({
  dt: epochOf(isoUtc),
  main: { temp_min: 24, temp_max: 33, humidity: 70 },
  wind: { speed: 5 },
  pop: 0.4,
  ...overrides,
});

describe('OpenWeatherMap · istDateKey buckets by IST calendar date', () => {
  it('puts a 19:00 UTC reading on the *next* IST day', () => {
    // 19:00Z + 5h30m = 00:30 IST the following morning.
    assert.equal(owm.istDateKey(epochOf('2026-08-13T19:00:00Z')), '2026-08-14');
  });

  it('places the boundary exactly at 18:30 UTC', () => {
    assert.equal(owm.istDateKey(epochOf('2026-08-13T18:29:59Z')), '2026-08-13');
    assert.equal(owm.istDateKey(epochOf('2026-08-13T18:30:00Z')), '2026-08-14');
  });

  it('keeps an Indian afternoon on its own day', () => {
    assert.equal(owm.istDateKey(epochOf('2026-08-13T09:00:00Z')), '2026-08-13'); // 14:30 IST
    assert.equal(owm.istDateKey(epochOf('2026-08-13T00:00:00Z')), '2026-08-13'); // 05:30 IST
  });

  it('rolls a month and a year boundary correctly', () => {
    assert.equal(owm.istDateKey(epochOf('2026-08-31T19:00:00Z')), '2026-09-01');
    assert.equal(owm.istDateKey(epochOf('2026-12-31T19:00:00Z')), '2027-01-01');
  });
});

describe('OpenWeatherMap · aggregateToDaily folds 3-hourly steps into daily rows', () => {
  const list = [
    step('2026-08-13T03:00:00Z', {
      main: { temp_min: 22, temp_max: 30, humidity: 70 },
      wind: { speed: 5 },
      pop: 0.4,
      rain: { '3h': 1.2 },
    }),
    step('2026-08-13T09:00:00Z', {
      main: { temp_min: 26, temp_max: 35, humidity: 80 },
      wind: { speed: 10 },
      pop: 0.9,
      rain: { '3h': 2.3 },
    }),
    step('2026-08-14T03:00:00Z', {
      main: { temp_min: 21, temp_max: 29, humidity: 60 },
      wind: { speed: 2 },
      pop: 0.1,
    }),
  ];

  const rows = owm.aggregateToDaily(list);

  it('emits one row per IST day, in ascending date order', () => {
    assert.deepEqual(
      rows.map((row) => row.date),
      ['2026-08-13', '2026-08-14'],
    );
  });

  it('takes the min of temp_min and the max of temp_max', () => {
    assert.equal(rows[0].tMinC, 22);
    assert.equal(rows[0].tMaxC, 35);
  });

  it('sums rain["3h"] across the day and treats an absent block as zero', () => {
    assert.equal(rows[0].rainMm, 3.5); // 1.2 + 2.3
    assert.equal(rows[1].rainMm, 0);
  });

  it('converts wind from m/s to km/h (×3.6) and keeps the daily maximum', () => {
    assert.equal(rows[0].windKmh, 36); // max(5, 10) m/s → 36 km/h
    assert.equal(rows[1].windKmh, 2 * 3.6);
  });

  it('means the humidity and takes the maximum probability, as a percentage', () => {
    assert.equal(rows[0].humidityPct, 75); // mean(70, 80)
    assert.equal(rows[0].rainProbPct, 90); // max(0.4, 0.9) × 100
    assert.equal(rows[1].rainProbPct, 10);
  });

  it('sets et0Mm to null on EVERY row — the free tier publishes no ET₀', () => {
    for (const row of rows) {
      assert.equal(row.et0Mm, null, `${row.date} carried a fabricated ET₀`);
    }
  });

  it('reports null rather than a number when a field was never present', () => {
    const sparse = owm.aggregateToDaily([
      { dt: epochOf('2026-08-13T03:00:00Z'), main: { temp_min: 22, temp_max: 30 } },
    ]);

    assert.equal(sparse[0].humidityPct, null);
    assert.equal(sparse[0].windKmh, null);
    assert.equal(sparse[0].rainProbPct, null);
    assert.equal(sparse[0].rainMm, 0);
  });

  it('does not group by UTC day — a 19:00Z step belongs to tomorrow', () => {
    const crossing = owm.aggregateToDaily([
      step('2026-08-13T15:00:00Z'),
      step('2026-08-13T19:00:00Z'),
    ]);

    assert.deepEqual(
      crossing.map((row) => row.date),
      ['2026-08-13', '2026-08-14'],
    );
  });
});

describe('OpenWeatherMap · fetchDaily', () => {
  const body = {
    list: [
      step('2026-08-13T03:00:00Z', { rain: { '3h': 1.5 } }),
      step('2026-08-13T09:00:00Z'),
      step('2026-08-14T03:00:00Z'),
    ],
  };

  it('returns canonical rows and a raw block that excludes the request url', async () => {
    const impl = stubFetch(body);

    const result = await owm.fetchDaily({ ...NAGPUR, apiKey: OWM_KEY, fetchImpl: impl });

    assert.equal(result.source, 'openweathermap');
    assert.equal(result.daily.length, 2);
    assert.deepEqual(result.raw, {
      provider: 'openweathermap',
      timezone: APP_TIMEZONE,
      steps: 3,
    });
    assert.ok(!JSON.stringify(result.raw).includes(OWM_KEY), 'the api key reached `raw`');
  });

  it('returns {daily: null, invalid: "no_api_key"} WITHOUT calling fetch', async () => {
    const impl = stubFetch(body);

    for (const apiKey of [undefined, null, '']) {
      const result = await owm.fetchDaily({ ...NAGPUR, apiKey, fetchImpl: impl });

      assert.deepEqual(result, {
        source: 'openweathermap',
        daily: null,
        invalid: 'no_api_key',
      });
    }

    assert.equal(impl.calls.length, 0, 'a keyless call still hit the provider');
  });

  it('reports {invalid: "schema"} for a payload it cannot read', async () => {
    for (const malformed of [{ list: [] }, { cod: '401', message: 'Invalid API key' }, {}]) {
      const result = await owm.fetchDaily({
        ...NAGPUR,
        apiKey: OWM_KEY,
        fetchImpl: stubFetch(malformed),
      });

      assert.equal(result.daily, null);
      assert.equal(result.invalid, 'schema');
    }
  });

  it('puts the key in the query string, where safeUrl strips it from every log', () => {
    const url = owm.buildUrl({ ...NAGPUR, apiKey: OWM_KEY });

    assert.equal(new URL(url).searchParams.get('appid'), OWM_KEY);
    assert.equal(new URL(url).searchParams.get('units'), 'metric');
    assert.equal(safeUrl(url), 'api.openweathermap.org/data/2.5/forecast');
    assert.ok(!safeUrl(url).includes(OWM_KEY));
  });
});
