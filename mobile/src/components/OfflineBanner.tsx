/**
 * The connectivity strip.
 *
 * Sits above the navigator so it is present on every screen, because the fact
 * it reports is true on every screen. It says two things and no more: that
 * there is no internet, and that what is on screen is saved rather than
 * current (docs/offline: "cached last-known-good, always age-labeled"). The
 * per-card age labels are the FreshnessDot's job — this is the global signal.
 *
 * It also announces the recovery, briefly, so a farmer who has been staring at
 * stale numbers knows the screen is now telling the truth again (RES-12).
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './ui/Text';
import { IconCloud, IconCheck, IconInfo } from './ui/icons';
import { useNetworkStatus } from '../hooks/useOnlineManager';
import { useAuth } from '../store/AuthContext';
import { colors, spacing } from '../theme';

const RECONNECT_NOTICE_MS = 3000;

export function OfflineBanner() {
  const { t } = useTranslation('mobile');
  const { online, known } = useNetworkStatus();
  const { sessionUnverified } = useAuth();
  const insets = useSafeAreaInsets();

  const [showReconnected, setShowReconnected] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!known) return;

    if (!online) {
      wasOffline.current = true;
      setShowReconnected(false);
      return;
    }

    if (wasOffline.current) {
      wasOffline.current = false;
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), RECONNECT_NOTICE_MS);
      return () => clearTimeout(timer);
    }
  }, [online, known]);

  // Before the first NetInfo event there is no honest claim to make.
  if (!known) return null;

  if (!online) {
    return (
      <View
        style={[styles.bar, styles.offline, { paddingTop: insets.top + spacing.sm }]}
        accessibilityLiveRegion="polite"
      >
        <IconCloud size={18} color={colors.surface} />
        <View style={styles.copy}>
          <Text variant="bodyStrong" color="inverse">
            {t('offline.banner')}
          </Text>
          <Text variant="caption" color="inverse">
            {t('offline.bannerBody')}
          </Text>
        </View>
      </View>
    );
  }

  if (showReconnected) {
    return (
      <View
        style={[styles.bar, styles.online, { paddingTop: insets.top + spacing.sm }]}
        accessibilityLiveRegion="polite"
      >
        <IconCheck size={18} color={colors.surface} />
        <Text variant="bodyStrong" color="inverse">
          {t('offline.reconnected')}
        </Text>
      </View>
    );
  }

  /**
   * Online, but running on a session nobody has been able to check with the
   * server yet — the app came up offline on a stored token and the reconnect
   * refresh has not settled. Worth saying globally rather than only in
   * Settings: every screen behind this banner is showing cached data whose
   * account has not been re-confirmed.
   */
  if (sessionUnverified) {
    return (
      <View
        style={[styles.bar, styles.unverified, { paddingTop: insets.top + spacing.sm }]}
        accessibilityLiveRegion="polite"
      >
        <IconInfo size={18} color={colors.ink900} />
        <Text variant="caption" style={styles.unverifiedText}>
          {t('offline.sessionUnverified')}
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  offline: { backgroundColor: colors.ink700 },
  online: { backgroundColor: colors.brand600 },
  // Softer than the outage strip: this is a caveat, not a failure.
  unverified: { backgroundColor: colors.earth100 },
  unverifiedText: { flex: 1 },
  copy: { flex: 1 },
});
