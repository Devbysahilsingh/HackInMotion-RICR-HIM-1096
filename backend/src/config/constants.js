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
