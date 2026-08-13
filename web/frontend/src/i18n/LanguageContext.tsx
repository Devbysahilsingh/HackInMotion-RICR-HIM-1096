/**
 * Language state.
 *
 * The second of ADR-014's two contexts. It owns three things that have to stay
 * in step: i18next's active locale, `localStorage`, and `<html lang>`.
 *
 * ## Why the server is not told
 *
 * `users.language` is persisted at registration (the register endpoint accepts
 * it) and read back on `/auth/me`, but the API exposes **no** `PATCH
 * /users/me` — `backend/src/app.js` mounts no users router at all. So a later
 * switch is a local preference only, and this file does not pretend otherwise
 * by firing a request that would 404. When a session restores, the stored
 * account language is adopted unless the farmer has since chosen differently
 * on this device.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Language } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, isLanguage } from './index';

export interface LanguageContextValue {
  language: Language;
  languages: Language[];
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const readStoredLanguage = (): Language | null => {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    // Private-mode Safari throws on localStorage access. A missing preference
    // is recoverable; a crashed provider is not.
    return null;
  }
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const [chosenOnThisDevice, setChosenOnThisDevice] = useState<boolean>(
    () => readStoredLanguage() !== null,
  );

  const language: Language = isLanguage(i18n.language) ? i18n.language : 'en';

  const setLanguage = useCallback(
    (next: Language) => {
      setChosenOnThisDevice(true);
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      } catch {
        // Preference simply will not survive the tab. Switching still works.
      }
      void i18n.changeLanguage(next);
    },
    [i18n],
  );

  // Adopt the account's language on first sign-in, but never override a
  // deliberate switch made on this device.
  useEffect(() => {
    if (!user || chosenOnThisDevice) return;
    if (isLanguage(user.language) && user.language !== i18n.language) {
      void i18n.changeLanguage(user.language);
    }
  }, [user, chosenOnThisDevice, i18n]);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, languages: SUPPORTED_LANGUAGES, setLanguage }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return context;
}
