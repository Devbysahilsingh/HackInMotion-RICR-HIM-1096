/**
 * Whether a write may be attempted right now, and why not.
 *
 * docs/offline/offline-strategy.md draws a hard line: reads degrade to a
 * labelled cache, but writes (auth, settings, analysis) genuinely require
 * connectivity and the app must say so "in-app, not hidden". Letting a farmer
 * flip a consent switch on a dead radio would show a success they did not get,
 * or an error that reads like a server fault — both are dishonest about a fact
 * the device already knows.
 *
 * `known` matters: before the first NetInfo event there is no honest claim to
 * make, so nothing is blocked. The failure mode of guessing wrong here is a
 * disabled control on a working connection, which is worse than a write that
 * fails and reports it.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useNetworkStatus } from './useOnlineManager';

export interface OfflineWriteGuard {
  /** Mirrors `useNetworkStatus().online`, so a caller needs one hook, not two. */
  online: boolean;
  /** True only once the device has actually told us it is offline. */
  blocked: boolean;
  /**
   * The sentence to show beside the disabled control, already translated.
   * Null while writing is allowed, so a screen can render it unconditionally.
   */
  reason: string | null;
}

export function useOfflineWriteGuard(): OfflineWriteGuard {
  const { t } = useTranslation('mobile');
  const { online, known } = useNetworkStatus();

  return useMemo(() => {
    const blocked = known && !online;
    return { online, blocked, reason: blocked ? t('offline.writeBlocked') : null };
  }, [known, online, t]);
}
