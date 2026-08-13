/**
 * Failure-injection flags.
 *
 * The canonical registry is docs/testing/resilience-testing.md:
 *   "Flags (non-prod env only, routing-layer only): FORCE_FAIL_OPENMETEO/
 *    OPENWEATHER/DATAGOVIN/GEMINI/OPENROUTER/ML/CLOUDINARY, FORCE_SLOW_<SVC>=ms."
 *
 * They exist so the RES matrix can be demonstrated on a live system without
 * unplugging a real provider. Two properties make them safe:
 *
 *   1. **Routing only.** A flag may make a provider call fail or stall. No flag
 *      weakens authentication, ownership, validation or rate limiting — the
 *      demo runs production security config (CLAUDE.md rule 2).
 *   2. **Absent in production.** `isProd` short-circuits every read, so a host
 *      that somehow carried `FORCE_FAIL_OPENMETEO=true` still behaves normally.
 *      The guard is here, once, rather than at each call site where a single
 *      missed check would be invisible.
 *
 * `docs/architecture/resilience.md` names a `FORCE_FAIL_WEATHER` in its demo
 * script that appears in no other document. It is honoured as an alias meaning
 * "both weather providers", because a demo that toggles one switch to prove
 * RES-02 is the more useful reading — and the resilience doc is updated to say
 * so rather than left contradicting the registry.
 */
import { isProd } from './env.js';

/** Per-provider kill switches. Keys are the provider ids used in errors. */
export const FAIL_FLAGS = {
  'open-meteo': 'FORCE_FAIL_OPENMETEO',
  openweathermap: 'FORCE_FAIL_OPENWEATHER',
  datagovin: 'FORCE_FAIL_DATAGOVIN',
  // Phase 3 (RES-04..06): the crop-health tiers and the image store.
  'ml-service': 'FORCE_FAIL_ML',
  gemini: 'FORCE_FAIL_GEMINI',
  openrouter: 'FORCE_FAIL_OPENROUTER',
  cloudinary: 'FORCE_FAIL_CLOUDINARY',
};

export const SLOW_FLAGS = {
  'open-meteo': 'FORCE_SLOW_OPENMETEO',
  openweathermap: 'FORCE_SLOW_OPENWEATHER',
  datagovin: 'FORCE_SLOW_DATAGOVIN',
  'ml-service': 'FORCE_SLOW_ML',
  gemini: 'FORCE_SLOW_GEMINI',
  openrouter: 'FORCE_SLOW_OPENROUTER',
  cloudinary: 'FORCE_SLOW_CLOUDINARY',
};

/** Covers both weather providers at once (resilience.md demo script). */
const WEATHER_ALIAS = 'FORCE_FAIL_WEATHER';
const WEATHER_PROVIDERS = new Set(['open-meteo', 'openweathermap']);

/**
 * @param {string} provider provider id, e.g. 'open-meteo'
 * @param {NodeJS.ProcessEnv} [source] injectable so a test can assert the
 *   production guard without mutating the real environment
 */
export function failureInjected(provider, source = process.env) {
  if (isProd) return false;
  if (WEATHER_PROVIDERS.has(provider) && source[WEATHER_ALIAS] === 'true') return true;
  const flag = FAIL_FLAGS[provider];
  return Boolean(flag) && source[flag] === 'true';
}

/**
 * Milliseconds of artificial latency, or 0. Used to prove the 8s timeout fires
 * (RES-08), not to simulate a slow network in any faithful way.
 */
export function injectedDelayMs(provider, source = process.env) {
  if (isProd) return 0;
  const flag = SLOW_FLAGS[provider];
  if (!flag) return 0;
  const value = Number(source[flag]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Names the production checklist asserts are absent (production-checklist.md). */
export const ALL_INJECTION_FLAGS = [
  ...Object.values(FAIL_FLAGS),
  ...Object.values(SLOW_FLAGS),
  WEATHER_ALIAS,
];

/**
 * Operational kill switches — a different mechanism from the flags above.
 *
 * `DISABLE_*` is deliberately NOT short-circuited by `isProd`, because its
 * whole purpose is production: shedding a tier whose free-tier quota is spent
 * or whose provider is misbehaving, without a redeploy
 * (docs/security/ai-security.md). Being honoured in production is exactly what
 * separates it from the FORCE_FAIL_* demo flags, which are not.
 *
 * The safety property is unchanged and is what makes this acceptable: a
 * disabled tier is *skipped by the router*. Nothing here is consulted by
 * authentication, ownership, validation or rate limiting, so no value of any
 * of these variables can widen access to anything.
 */
export const DISABLE_FLAGS = {
  'ml-service': 'DISABLE_ML',
  gemini: 'DISABLE_GEMINI',
  openrouter: 'DISABLE_OPENROUTER',
};

/**
 * @param {string} provider provider id, e.g. 'gemini'
 * @param {NodeJS.ProcessEnv} [source] injectable for tests
 */
export function tierDisabled(provider, source = process.env) {
  const flag = DISABLE_FLAGS[provider];
  return Boolean(flag) && source[flag] === 'true';
}
