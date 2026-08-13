/**
 * Domain constants that are contract, not configuration.
 *
 * These are fixed by the approved specification (ADR-009, docs/security/
 * authentication.md, docs/api/error-codes.md) rather than by deployment, so
 * they live in code where a test can assert them — not in env, where a
 * misconfigured host could silently weaken security.
 */

/** Access-token lifetime. ADR-009 / docs/security/authentication.md: 30 minutes. */
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;

/** Refresh-token lifetime. docs/security/authentication.md: 7 days. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** bcrypt work factor. docs/database/schema.md: "passwordHash (bcrypt 12)". */
export const BCRYPT_COST = 12;

/**
 * JWT is pinned to one symmetric algorithm and verified with an explicit
 * allowlist, which is what defeats the `alg: none` / algorithm-confusion
 * class of forgery (threat model: "JWT forgery/alg confusion", ST-05).
 */
export const JWT_ALGORITHM = 'HS256';

/**
 * Issuer/audience are asserted on every verify. The claim set stays free of
 * PII and roles as specified; `iss`/`aud` carry no user data and make the
 * ST-05 audience case a real assertion rather than a documentation note.
 */
export const JWT_ISSUER = 'him-1096-api';
export const JWT_AUDIENCE = 'him-1096-client';

/** Request body ceiling. docs/security/api-security.md: "JSON body limit 100KB". */
export const JSON_BODY_LIMIT = '100kb';

/**
 * Refresh-token cookie. Path-scoped so it is never attached to ordinary API
 * calls (docs/api/authentication.md: `Path=/api/v1/auth`).
 */
export const REFRESH_COOKIE_NAME = 'rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** Pagination contract (docs/api/error-codes.md). */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 50;

/** Per-user resource ceilings (docs/api/farms.md, docs/api/crops.md). */
export const MAX_FARMS_PER_USER = 10;
export const MAX_ACTIVE_CROPS_PER_FARM = 12;

/**
 * Weather locations are deduplicated onto a 0.1° grid so nearby farms share
 * one provider fetch (docs/weather/weather-architecture.md).
 */
export const LOCATION_KEY_PRECISION = 1;

/** India bounding box — rejects junk coordinates before they cost quota. */
export const INDIA_BOUNDS = { minLat: 6, maxLat: 37.5, minLon: 68, maxLon: 97.5 };

/**
 * Client-supplied strings that get persisted are truncated to this length.
 * A User-Agent is attacker-controlled and lands in a refreshTokens row and in
 * an audit row on every failed login; unbounded, it is a cheap way to fill a
 * 512MB shared cluster. Long enough to keep real agent strings intact.
 */
export const MAX_STORED_USER_AGENT = 256;

/** Audit event names. Deliberately an open vocabulary (docs/database/schema.md). */
export const AUDIT_EVENTS = {
  REGISTER: 'register',
  LOGIN: 'login',
  LOGIN_FAILED: 'login_failed',
  TOKEN_REFRESH: 'token_refresh',
  TOKEN_REUSE: 'token_reuse',
  LOGOUT: 'logout',
  RATE_LIMITED: 'rate_limited',
  UPLOAD_REJECTED: 'upload_rejected',
};

/** Enumerations shared by schemas, Zod validators and the seed scripts. */
export const LANGUAGES = ['en', 'hi'];
export const LAND_UNITS = ['acre', 'hectare', 'bigha'];
export const SOIL_TYPES = [
  'alluvial',
  'black',
  'red',
  'laterite',
  'sandy',
  'loamy',
  'clay',
  'unknown',
];
export const IRRIGATION_METHODS = ['canal', 'borewell', 'rainfed', 'drip', 'sprinkler', 'unknown'];
export const LOCATION_SOURCES = ['gps', 'manual'];
export const CROP_STATUSES = ['planned', 'active', 'harvested'];
export const SUPPORT_LEVELS = ['SPECIALIZED', 'GENERAL', 'LIMITED', 'UNSUPPORTED'];
export const SEASONS = ['KHARIF', 'RABI', 'ZAID'];
/**
 * FAO-56 growth stages. `DEVELOPMENT` is the canonical spelling; the
 * irrigation rules doc abbreviates it `DEV` in one constant map, which is a
 * naming slip recorded in the implementation log — the registry and the
 * stage utility both use the full word.
 */
export const GROWTH_STAGES = ['INITIAL', 'DEVELOPMENT', 'MID', 'LATE'];

/** Sowing dates are bounded so a typo cannot produce nonsense stage maths. */
export const SOWING_DATE_MAX_PAST_DAYS = 400;
export const SOWING_DATE_MAX_FUTURE_DAYS = 180;

// ── Phase 2: weather ─────────────────────────────────────────────────────────

/**
 * India is a single civil time zone, so every "day" in this system — a rainfall
 * total, an irrigation ledger entry, a feed dedup key — is an IST day. No
 * repository document states this; it is recorded here because a UTC day
 * boundary would silently split an Indian afternoon's rain across two rows.
 */
export const APP_TIMEZONE = 'Asia/Kolkata';

/** docs/weather/weather-architecture.md: "7-day past + 7-day forecast". */
export const WEATHER_PAST_DAYS = 7;
export const WEATHER_FORECAST_DAYS = 7;
export const WEATHER_EXPECTED_DAYS = WEATHER_PAST_DAYS + WEATHER_FORECAST_DAYS;

/** Snapshot TTL: "upsert weatherSnapshots {… expiresAt:+6h …}". */
export const WEATHER_TTL_MS = 6 * 60 * 60 * 1000;

/** Refresh cadence: "cron q3h". */
export const WEATHER_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * Past this age a cached snapshot still serves, but the client is told to warn
 * (resilience.md: "serve indefinitely, ● Cached + age; >48h adds warning").
 */
export const WEATHER_STALE_WARNING_MS = 48 * 60 * 60 * 1000;

/** resilience.md: "8s (weather/AI) · 15s (market bulk)". */
export const WEATHER_TIMEOUT_MS = 8_000;
export const MARKET_TIMEOUT_MS = 15_000;

/**
 * Freshness vocabulary served to clients (docs/api/error-codes.md).
 * The stored `weatherSnapshots.status` enum is only `ok|stale`; these are the
 * boundary values derived from it, plus `pending` for "never fetched".
 */
export const FRESHNESS = {
  LIVE: 'live',
  CACHED: 'cached',
  HISTORICAL: 'historical',
  PENDING: 'pending',
};

/**
 * Weather risk types.
 *
 * These are the spellings from docs/api/weather.md — the wire contract — which
 * differs from docs/weather/weather-architecture.md's prose
 * (EXTREME_HEAT/FROST_COLD/HIGH_WIND). The wire contract wins because clients
 * are written against it; the prose doc is corrected to match.
 */
export const WEATHER_RISK_TYPES = {
  HEAVY_RAIN: 'HEAVY_RAIN',
  HEAT: 'HEAT',
  FROST: 'FROST',
  WIND: 'WIND',
  HUMIDITY_DISEASE: 'HUMIDITY_DISEASE',
  DRY_SPELL: 'DRY_SPELL',
};

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// ── Phase 2: market ──────────────────────────────────────────────────────────

/** Nightly ingest (docs/backend/architecture.md: "marketRefresh(nightly)"). */
export const MARKET_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** docs/market/data-normalization.md sanity gates. */
export const MARKET_PRICE_MIN_EXCLUSIVE = 0;
export const MARKET_PRICE_MAX_EXCLUSIVE = 100_000;
export const MARKET_MAX_AGE_DAYS = 90;
/** "drop-rate >30% aborts the batch (schema-drift guard)". */
export const MARKET_DROP_RATE_ABORT = 0.3;
/** data-lifecycle.md: "180-day rolling purge (M0 size guard)". */
export const MARKET_RETENTION_DAYS = 180;

/** docs/market/market-insights.md: "RISING if changePct7d ≥ +5% · FALLING ≤ −5%". */
export const MARKET_SIGNAL_THRESHOLD_PCT = 5;
export const MARKET_SIGNAL_WINDOW_OBS = 7;
export const MARKET_TREND_WINDOW_OBS = 30;
export const MARKET_SIGNALS = ['RISING', 'FALLING', 'STABLE'];
/** docs/database/validation.md: "date ranges ≤90d". */
export const MARKET_QUERY_MAX_DAYS = 90;

// ── Phase 2: feed & dashboard ────────────────────────────────────────────────

/** "feed-refresh job (30min)". */
export const FEED_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/** "Cap: max 20 active/user; INFO evicted first (overload prevention)". */
export const FEED_MAX_ACTIVE_PER_USER = 20;

/**
 * Priority rank for sorting.
 *
 * The `feed` index sorts `priority: 1` — i.e. the strings ascending, which is
 * CRITICAL, HIGH, INFO, MEDIUM. That is NOT the documented order, so the feed
 * is ordered in memory over a bounded candidate set using this map rather than
 * by adding a rank field (which would change the schema and the asserted index
 * set). Recorded as a decision in the implementation log.
 */
export const FEED_PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };

/** Retained this long past validUntil before purge (data-lifecycle.md). */
export const FEED_PURGE_GRACE_DAYS = 7;
