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

// ── Phase 3: image upload ────────────────────────────────────────────────────

/**
 * The single multipart field an upload route accepts. Anything else is
 * rejected by multer before a byte is buffered (docs/security/
 * image-upload-security.md: "single file; field allowlist").
 */
export const UPLOAD_FIELD_NAME = 'image';

/** "hard size limit 8MB (multer limits + reverse-proxy limit)". */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Magic-byte allowlist, expressed as `file-type` extension ids.
 *
 * The security doc names `{jpeg, png, webp, heic}`. `avif` is added because it
 * is the *same* ISO-BMFF/HEIF container as HEIC with a different codec inside:
 * a phone that writes `.heic` and a phone that writes `.avif` both hand us a
 * heif box structure, and admitting one while refusing the other would reject
 * a valid photo for a reason the farmer cannot act on. Both still have to
 * survive the decode step, which is the real arbiter.
 *
 * The client's declared Content-Type and filename are never consulted — only
 * the bytes (rule: "ignore client filename/Content-Type entirely").
 */
export const ACCEPTED_IMAGE_EXTENSIONS = Object.freeze(['jpg', 'png', 'webp', 'heic', 'avif']);

/** "header-parsed dimensions ≤6000×6000 AND megapixels ≤36 BEFORE full decode". */
export const MAX_IMAGE_EDGE_PX = 6000;
export const MAX_IMAGE_MEGAPIXELS = 36;

/**
 * Ceiling handed to sharp's own `limitInputPixels`. sharp aborts the decode
 * itself once a source exceeds this, which is what stops a decompression bomb
 * *during* decode rather than after — the header check above cannot catch a
 * file that lies about its dimensions.
 */
export const MAX_DECODE_PIXELS = MAX_IMAGE_MEGAPIXELS * 1_000_000;

/** "re-encode JPEG q85 max 1600px long edge". */
export const REENCODE_MAX_EDGE_PX = 1600;
export const REENCODE_JPEG_QUALITY = 85;

/**
 * Rejection reason classes.
 *
 * The upload doc requires "reason-classed messages (too large / not an image /
 * unclear photo) localized; never a blank failure". These are the classes; the
 * i18n key is derived from the class so a new reason cannot ship without a
 * translation. They are deliberately coarse — a precise parser diagnosis would
 * tell an attacker which guard they tripped.
 */
export const UPLOAD_REJECTION = Object.freeze({
  NO_FILE: 'NO_FILE',
  TOO_LARGE: 'TOO_LARGE',
  UNEXPECTED_FIELD: 'UNEXPECTED_FIELD',
  TOO_MANY_FILES: 'TOO_MANY_FILES',
  NOT_AN_IMAGE: 'NOT_AN_IMAGE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  DIMENSIONS_TOO_LARGE: 'DIMENSIONS_TOO_LARGE',
  ANIMATED: 'ANIMATED',
  UNREADABLE: 'UNREADABLE',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
});

/** Reason class → i18n key. Exhaustiveness is asserted by the upload suite. */
export const UPLOAD_REJECTION_KEYS = Object.freeze({
  [UPLOAD_REJECTION.NO_FILE]: 'errors.uploadNoFile',
  [UPLOAD_REJECTION.TOO_LARGE]: 'errors.uploadTooLarge',
  [UPLOAD_REJECTION.UNEXPECTED_FIELD]: 'errors.uploadUnexpectedField',
  [UPLOAD_REJECTION.TOO_MANY_FILES]: 'errors.uploadTooManyFiles',
  [UPLOAD_REJECTION.NOT_AN_IMAGE]: 'errors.uploadNotAnImage',
  [UPLOAD_REJECTION.UNSUPPORTED_FORMAT]: 'errors.uploadUnsupportedFormat',
  [UPLOAD_REJECTION.DIMENSIONS_TOO_LARGE]: 'errors.uploadDimensionsTooLarge',
  [UPLOAD_REJECTION.ANIMATED]: 'errors.uploadAnimated',
  [UPLOAD_REJECTION.UNREADABLE]: 'errors.uploadUnreadable',
  [UPLOAD_REJECTION.STORAGE_UNAVAILABLE]: 'errors.uploadStorageUnavailable',
});

/**
 * Cloudinary folder, namespaced per environment so a staging upload can never
 * land beside a production asset (upload doc: "folder per env").
 */
export const CLOUDINARY_FOLDER_PREFIX = 'him1096';

/** resilience.md: "8s (weather/AI)". Applied to the storage upload too. */
export const CLOUDINARY_TIMEOUT_MS = 8_000;

// ── Phase 3: crop-health chain ───────────────────────────────────────────────

/**
 * Analysis tiers, in the order the conductor walks them (ADR-006).
 * These are the stored `cropHealthLogs.analysis.source` enum values.
 */
export const HEALTH_SOURCES = Object.freeze({ ML: 'ml', GEMINI: 'gemini', RULES: 'rules' });

/**
 * Provider ids used for kill switches, circuit-breaker keys and log fields.
 * `gemini` and `openrouter` are two providers behind one *tier* — the tier is
 * "AI-assisted" either way, which is why both map to source `gemini`.
 */
export const AI_PROVIDERS = Object.freeze({
  ML: 'ml-service',
  GEMINI: 'gemini',
  OPENROUTER: 'openrouter',
});

/**
 * Per-hop timeout.
 *
 * Three documents that describe *this* chain say 10s (docs/api/crop-health.md,
 * docs/ai/ai-architecture.md, docs/ai/gemini-integration.md,
 * docs/ml/inference-architecture.md); docs/architecture/resilience.md says 8s
 * for "weather/AI" generically. The specific contract wins over the generic
 * one, so a hop may take up to 10s — but see HEALTH_E2E_BUDGET_MS: no hop may
 * spend budget the whole request does not have.
 */
export const AI_HOP_TIMEOUT_MS = 10_000;

/**
 * "Timing budget ≤15s E2E" (docs/api/crop-health.md).
 *
 * 10s + 10s of hops exceeds 15s, so a per-hop ceiling alone cannot honour the
 * budget. The conductor therefore carries a deadline: each hop gets
 * `min(AI_HOP_TIMEOUT_MS, remaining budget)` and a hop with no useful time left
 * is skipped rather than started. The rules tier is local and always runs, so
 * exhausting the budget degrades the answer's tier — never the response.
 */
export const HEALTH_E2E_BUDGET_MS = 15_000;

/** "1 retry, exponential jitter" — one extra attempt per provider, not two. */
export const AI_RETRIES = 1;

/**
 * confidenceBand → numeric band (docs/ai/response-schema.md).
 *
 * These are NOT measured probabilities and must never be presented as one. The
 * band is carried alongside so the UI can say "AI-assisted: medium confidence"
 * rather than "65%".
 */
export const AI_CONFIDENCE_BANDS = Object.freeze({ HIGH: 0.85, MEDIUM: 0.65, LOW: 0.4 });

/** docs/ai/response-schema.md enums, mirrored by the Zod validator. */
export const IMAGE_ASSESSMENTS = Object.freeze([
  'OK',
  'NOT_A_PLANT',
  'WRONG_CROP_SUSPECTED',
  'TOO_UNCLEAR',
]);
export const CONFIDENCE_BANDS = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
export const SEVERITY_VISUAL = Object.freeze(['MILD', 'MODERATE', 'SEVERE', 'NOT_ASSESSABLE']);
export const AFFECTED_PARTS = Object.freeze(['LEAF', 'STEM', 'FRUIT', 'FLOWER', 'WHOLE_PLANT']);
export const MAX_VISUAL_FINDINGS = 5;
export const MAX_VISUAL_FINDING_LENGTH = 140;

/** The honest sentinel. A tier that cannot name a disease says so. */
export const UNKNOWN_DISEASE_CODE = 'UNKNOWN';

/** Farmer-supplied note ceiling (docs/database/validation.md: "≤500 chars"). */
export const MAX_HEALTH_DESCRIPTION = 500;

/**
 * Engine-assessed severity vocabulary.
 *
 * No repository document publishes one — `analysis.severityAssessment` is an
 * untyped String in the schema. These four are chosen to mirror the AI schema's
 * `severityVisual` enum so the engine's output and one of its inputs are read
 * on the same scale, plus `NOT_ASSESSED` for the honest "we were not given
 * enough to say" case. Recorded in ADR-024.
 */
export const SEVERITY_LEVELS = Object.freeze(['MILD', 'MODERATE', 'SEVERE', 'NOT_ASSESSED']);

/** Follow-up answer bounds (docs/api/crop-health.md severity endpoint). */
export const SPREAD_RATES = Object.freeze(['NONE', 'SLOW', 'RAPID']);

/**
 * Rule-engine scoring weights (docs/ai/fallback-strategy.md, verbatim:
 * "weights: pattern 3, part 2, color 2, distribution 1, weather-context 1").
 */
export const SYMPTOM_WEIGHTS = Object.freeze({
  pattern: 3,
  part: 2,
  color: 2,
  distribution: 1,
  weather: 1,
});

/**
 * Match-score bands. "Possible/Likely — never 'Diagnosed'" (fallback-strategy).
 * `LIKELY` is the upper band; anything at or below the registry disease's
 * `expertThreshold` (default 0.4) routes to a human instead.
 */
export const MATCH_BANDS = Object.freeze({ LIKELY: 'LIKELY', POSSIBLE: 'POSSIBLE' });
export const MATCH_BAND_LIKELY_MIN = 0.6;

/** "expert-referral threshold (score <0.4 …)" — the schema default, restated. */
export const DEFAULT_EXPERT_THRESHOLD = 0.4;

/** Candidates returned by the symptom engine. Bounded so a tie cannot flood. */
export const MAX_SYMPTOM_CANDIDATES = 5;

/** docs/api/crop-health.md: "RL 10/day/user + 3/min burst". */
export const HEALTH_ANALYZE_DAILY_LIMIT = 10;
export const HEALTH_ANALYZE_BURST_LIMIT = 3;
export const HEALTH_ANALYZE_BURST_WINDOW_MS = 60 * 1000;
/** "POST /crop-health/symptom-check | Auth · RL 30/day". */
export const SYMPTOM_CHECK_DAILY_LIMIT = 30;

/**
 * Image-hash cache window.
 *
 * No document specifies a key, scope or TTL — only that an "identical photo
 * re-analysis [is] served from cache" so a retry does not burn free-tier quota.
 * The cache is **per user** (a hash is scoped by `userId`, never global):
 * a global cache would let one farmer's analysis answer another's request,
 * which AU-1 forbids and which would leak the fact that someone else uploaded
 * the same photograph. Recorded in ADR-024.
 */
export const IMAGE_CACHE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ── Phase 3: community ───────────────────────────────────────────────────────

/** "Aggregation job (6h)" (docs/community/community-alerts.md). */
export const COMMUNITY_AGGREGATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** "group trailing-7-day window". */
export const COMMUNITY_WINDOW_DAYS = 7;

/** "distinctFarmers ≥3 → INFO advisory; ≥8 → HIGH". */
export const COMMUNITY_MIN_FARMERS_INFO = 3;
export const COMMUNITY_MIN_FARMERS_HIGH = 8;

/** "confidence ≥ τ_community(0.8)". */
export const COMMUNITY_CONFIDENCE_FLOOR = 0.8;

/**
 * "source∈{ml,gemini}" — rules-engine self-reports are excluded as outbreak
 * signal because a farmer answering a questionnaire is not an observation.
 */
export const COMMUNITY_ELIGIBLE_SOURCES = Object.freeze([HEALTH_SOURCES.ML, HEALTH_SOURCES.GEMINI]);

/** "Expiry: window passes → active=false; purge 30d". */
export const COMMUNITY_ALERT_PURGE_DAYS = 30;
