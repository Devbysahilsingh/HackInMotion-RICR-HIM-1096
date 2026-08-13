/**
 * Runtime configuration.
 *
 * Exactly one value, and it is not a secret: the API base URL. Everything the
 * app needs beyond this comes from the API itself. `EXPO_PUBLIC_*` variables
 * are compiled into the JS bundle and are readable by anyone holding the APK,
 * so nothing that must stay private is permitted here — the APK strings scan
 * (ST-60) exists to catch a regression on that rule.
 *
 * Resolution order: `Constants.expoConfig.extra.apiUrl` (set by app.config.ts,
 * which reads the build-time env var) → the raw env var, which is what a Jest
 * run sees because there is no Expo manifest there.
 */
import Constants from 'expo-constants';

const fromManifest = (Constants.expoConfig?.extra as { apiUrl?: unknown } | undefined)?.apiUrl;

export const API_BASE_URL: string =
  (typeof fromManifest === 'string' && fromManifest) ||
  process.env.EXPO_PUBLIC_API_URL ||
  'http://10.0.2.2:4000/api/v1';

/**
 * True when the bundle was built with `__DEV__` on. Used to keep developer
 * affordances (the API-URL line on the settings screen) out of a release
 * build, never to change security behaviour — the demo build runs the same
 * rules as production (CLAUDE.md rule 2).
 */
export const IS_DEV: boolean = typeof __DEV__ !== 'undefined' && __DEV__;
