/**
 * i18next initialisation.
 *
 * ## Why `keySeparator` is off
 *
 * The canonical resource files are **flat**, with dots inside the key itself
 * (`"schedule.basal.full"`, `"soil.alluvial"`). With i18next's default
 * separator, `t('schedule.basal.full')` would look for a nested object that
 * does not exist. Turning the separator off makes the lookup literal, so the
 * key a backend route emits is the key this client resolves — byte for byte.
 *
 * ## Why there is no language *detector* plugin
 *
 * The browser plugin reads `localStorage`, which does not exist here, and
 * AsyncStorage is asynchronous — a detector would have to resolve before the
 * first render or the app would flash English at a Hindi speaker. Instead the
 * stored choice is read once during boot (`loadStoredLanguage`) and passed to
 * `init` as a plain value, which is synchronous by the time it matters.
 */
import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';

import type { Language } from '@shared/types/api';

import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources';

export const SUPPORTED_LANGUAGES: Language[] = ['en', 'hi'];

/**
 * Same storage key the web uses in `localStorage`. Identical spelling is not
 * required by anything — the two never share a device — but it keeps one name
 * for one concept across the repo.
 */
export const LANGUAGE_STORAGE_KEY = 'him1096.language';

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (SUPPORTED_LANGUAGES as string[]).includes(value);

/**
 * The device's own preference, used only on first run.
 *
 * `getLocales()` returns e.g. `hi-IN`, so the region is trimmed off. Anything
 * that is not a language we ship falls to English — this is a default, not a
 * claim of support.
 */
export function deviceLanguage(): Language {
  const tag = getLocales()[0]?.languageCode ?? 'en';
  return isLanguage(tag) ? tag : 'en';
}

/** Reads the farmer's stored choice; `null` when they have never chosen. */
export async function loadStoredLanguage(): Promise<Language | null> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function storeLanguage(language: Language): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A device whose storage is full still gets a working language for this
    // session; it just will not be remembered. Failing the switch would be
    // worse than forgetting it.
  }
}

export function initI18n(language: Language): I18nInstance {
  if (i18next.isInitialized) {
    if (i18next.language !== language) void i18next.changeLanguage(language);
    return i18next;
  }

  void i18next.use(initReactI18next).init({
    resources,
    lng: language,
    ns: NAMESPACES as unknown as string[],
    defaultNS: DEFAULT_NAMESPACE,
    supportedLngs: SUPPORTED_LANGUAGES,
    /**
     * A safety net, not a strategy (docs/i18n/architecture.md rule 3). The
     * parity script keeps it from being load-bearing; the one place it is
     * knowingly relied on is the Hindi disease namespace.
     */
    fallbackLng: 'en',
    // Flat keys with literal dots — see the module comment.
    keySeparator: false,
    nsSeparator: ':',
    interpolation: {
      // React Native does not interpret markup, so HTML escaping would only
      // mangle ₹ and Devanagari.
      escapeValue: false,
    },
    returnNull: false,
    react: { useSuspense: false },
    compatibilityJSON: 'v4',
  });

  return i18next;
}

export { i18next };
