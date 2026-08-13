/**
 * Active language.
 *
 * The choice is device-local and survives logout, because it is a property of
 * the person holding the phone rather than of the account: the first-run
 * language screen appears before any session exists, and a farmer who logs out
 * should not be handed English back.
 *
 * When a session *does* exist, the choice is also mirrored to the server
 * (`PATCH /users/me`) so the same account opens in the same language on
 * another handset. That mirror is best-effort: a failed sync must never
 * prevent the UI from switching, so it is fired and forgotten.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { Language } from '@shared/types/api';

import { usersApi } from '../api/endpoints';
import { i18next, storeLanguage } from '../i18n';

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language, options?: { sync?: boolean }) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: Language;
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback(async (next: Language, options?: { sync?: boolean }) => {
    setLanguageState(next);
    await i18next.changeLanguage(next);
    await storeLanguage(next);

    if (options?.sync) {
      try {
        await usersApi.updateMe({ language: next });
      } catch {
        // The device is the source of truth for this setting; the server
        // copy is a convenience for the farmer's next handset. Surfacing a
        // failure here would be noise about something they did not ask for.
      }
    }
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}
