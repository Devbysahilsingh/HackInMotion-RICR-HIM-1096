/**
 * i18next initialisation.
 *
 * ## Why `keySeparator` is off
 *
 * The canonical resource files are **flat**, with dots inside the key itself
 * (`"schedule.basal.full"`, `"soil.alluvial"`) — the convention
 * `shared/i18n/en/fertilizer.json` already established, and the one the
 * backend's own parity test depends on (it asserts every value in a namespace
 * is a string, which a nested object would break). With i18next's default
 * separator, `t('schedule.basal.full')` would look for a nested object that
 * does not exist. Turning the separator off makes the lookup literal, so the
 * key a backend route emits is the key this client resolves — byte for byte.
 */
import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources';
import type { Language } from '@/api/types';

export const SUPPORTED_LANGUAGES: Language[] = ['en', 'hi'];

/** Where the chosen language survives a reload before a session exists. */
export const LANGUAGE_STORAGE_KEY = 'him1096.language';

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (SUPPORTED_LANGUAGES as string[]).includes(value);

export function initI18n(): I18nInstance {
  if (i18next.isInitialized) return i18next;

  void i18next
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      ns: NAMESPACES as unknown as string[],
      defaultNS: DEFAULT_NAMESPACE,
      supportedLngs: SUPPORTED_LANGUAGES,
      /**
       * A safety net, not a strategy (docs/i18n/architecture.md rule 3). The
       * parity script is what keeps it from being load-bearing; the one place
       * it is knowingly relied on is the Hindi disease namespace.
       */
      fallbackLng: 'en',
      // Flat keys with literal dots — see the module comment.
      keySeparator: false,
      nsSeparator: ':',
      interpolation: {
        // React escapes for us; double-escaping mangles ₹ and Devanagari.
        escapeValue: false,
      },
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: LANGUAGE_STORAGE_KEY,
        caches: ['localStorage'],
      },
      returnNull: false,
      react: { useSuspense: false },
    });

  applyDocumentLanguage(i18next.language);
  i18next.on('languageChanged', applyDocumentLanguage);

  return i18next;
}

/**
 * Keeps `<html lang>` in step with the active locale so Hindi screen readers
 * pronounce Devanagari correctly (accessibility.md: "`lang` attribute switches
 * with locale"). `dir` stays LTR for both languages — Devanagari is a
 * left-to-right script, and there is no right-to-left locale in scope.
 */
export function applyDocumentLanguage(language: string): void {
  if (typeof document === 'undefined') return;
  const resolved = isLanguage(language) ? language : 'en';
  document.documentElement.lang = resolved;
  document.documentElement.dir = 'ltr';
}

export { i18next };
