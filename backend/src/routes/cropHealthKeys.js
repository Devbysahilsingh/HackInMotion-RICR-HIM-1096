/**
 * The crop-health i18n key registry.
 *
 * Every key is written here as a **single-quoted literal**, deliberately, and
 * looked up through these maps rather than composed at the call site. The
 * reason is mechanical: `tests/i18n/message-keys.test.js` scans the source for
 * quoted `namespace.name` strings and asserts each one resolves in both `en`
 * and `hi`. A template literal like `` `health.title${source}` `` is invisible
 * to that scanner, so the existing `irrigation.title${verdict}` pattern buys
 * brevity at the cost of the guard — a missing translation there would reach a
 * farmer as a raw identifier and no test would fail.
 *
 * Collecting them in one module keeps the guard real while still letting the
 * conductor select a key by tier.
 */
import { HEALTH_SOURCES, MATCH_BANDS, SEVERITY_LEVELS } from '../config/constants.js';

/** Result headline, by the tier that answered. */
export const HEALTH_TITLE_KEYS = Object.freeze({
  [HEALTH_SOURCES.ML]: 'health.titleMl',
  [HEALTH_SOURCES.GEMINI]: 'health.titleGemini',
  [HEALTH_SOURCES.RULES]: 'health.titleRules',
  UNKNOWN: 'health.titleUnknown',
});

/**
 * The honesty labels (docs/ai/ai-safety.md rule 6: "UI shows which tier
 * answered — Local AI / AI-assisted / Guided assessment — never blended into
 * one anonymous 'AI'"). The engines emit no prose and no key of their own, so
 * the mapping from tier to label lives here, at the API boundary.
 */
export const HEALTH_SOURCE_LABEL_KEYS = Object.freeze({
  [HEALTH_SOURCES.ML]: 'health.sourceLocalAi',
  [HEALTH_SOURCES.GEMINI]: 'health.sourceAiAssisted',
  [HEALTH_SOURCES.RULES]: 'health.sourceGuided',
});

/** Match-score bands. "Possible/Likely — never 'Diagnosed'". */
export const MATCH_BAND_KEYS = Object.freeze({
  [MATCH_BANDS.LIKELY]: 'health.bandLikely',
  [MATCH_BANDS.POSSIBLE]: 'health.bandPossible',
});

/** Engine-derived severity. Labelled "assessed", never "measured". */
export const SEVERITY_KEYS = Object.freeze({
  MILD: 'health.severityMild',
  MODERATE: 'health.severityModerate',
  SEVERE: 'health.severitySevere',
  NOT_ASSESSED: 'health.severityNotAssessed',
});

/**
 * The honest coverage notice.
 *
 * docs/api/crop-health.md routes LIMITED and UNSUPPORTED crops to the rule
 * engine "+ honest notice", and the support matrix is explicit that an
 * UNSUPPORTED crop gets an "explicit 'no disease intelligence' notice; never
 * fabricate". A SPECIALIZED or GENERAL crop needs no notice, so this returns
 * null rather than an empty string — the client renders nothing at all.
 */
export function coverageNoticeKey(supportLevel) {
  if (supportLevel === 'LIMITED') return 'health.coverageLimited';
  if (supportLevel === 'UNSUPPORTED' || !supportLevel) return 'health.coverageUnsupported';
  return null;
}

/** Referral CTA — "contact KVK/Kisan Call Centre" (fallback-strategy.md §3). */
export const EXPERT_REFERRAL_KEY = 'health.expertReferral';

/** Shown when no tier could name a condition. Uncertainty is a real outcome. */
export const UNCERTAIN_RETAKE_KEY = 'health.uncertainRetake';

/** Exported so a test can assert the maps cover every enum member. */
export { SEVERITY_LEVELS };
