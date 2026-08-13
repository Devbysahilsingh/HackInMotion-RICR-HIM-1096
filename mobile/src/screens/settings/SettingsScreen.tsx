/**
 * Settings — the P0 rows from docs/mobile/screen-map.md: "language, community
 * consent, voice toggle, logout, about+disclaimers", plus the land unit,
 * because `PATCH /users/me` accepts it and it changes how every area on the
 * app reads.
 *
 * ## Why the switches are optimistic
 *
 * A toggle that waits for a round-trip on a rural connection appears broken:
 * the farmer taps, nothing moves for four seconds, they tap again, and the
 * second tap undoes the first. So the control moves immediately and rolls back
 * — visibly, with the server's own message — if the write is refused. What is
 * *not* optimistic is the offline case: `useOfflineWriteGuard` disables the
 * control outright and says why, because a write that cannot leave the device
 * is not a slow write, it is a lie.
 *
 * ## Why the consent copy is worded the way it is
 *
 * `settings.consentBody` states exactly what leaves the device — district,
 * crop, result — and exactly what does not: name, photo, exact location. That
 * matches what `communityService` actually aggregates (CLAUDE.md rule 12:
 * district-aggregated, consent-gated, structurally PII-free). Overstating it
 * would frighten a farmer off a useful feature; understating it would be
 * consent obtained under a false description.
 *
 * ## Why the server URL is dev-only
 *
 * It is not a secret — the APK contains it either way (ST-60) — but a release
 * build has no reason to put infrastructure on a farmer's screen, and a
 * screenshot of this page should not carry it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import type { Language, LandUnit, User } from '@shared/types/api';
import { LAND_UNITS, LANGUAGES } from '@shared/types/api';

import { usersApi, type UserSettingsPatch } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Select } from '../../components/ui/Select';
import { Notice } from '../../components/ui/states';
import { Switch } from '../../components/ui/Switch';
import { Text } from '../../components/ui/Text';
import { API_BASE_URL, IS_DEV } from '../../config/env';
import { useApiErrorMessage } from '../../hooks/useApiError';
import { useOfflineWriteGuard } from '../../hooks/useOfflineWriteGuard';
import { isLanguageAvailable } from '../../services/voice';
import { useAuth } from '../../store/AuthContext';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';

export function SettingsScreen() {
  const { t } = useTranslation(['common', 'mobile', 'auth', 'community', 'voice']);
  const { user, sessionUnverified, logout, setUser } = useAuth();
  const { language, setLanguage } = useLanguage();
  const guard = useOfflineWriteGuard();
  const describeError = useApiErrorMessage();

  const [failure, setFailure] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [canSpeak, setCanSpeak] = useState(true);

  // A handset with no Hindi voice pack can offer the toggle and then say
  // nothing at all (docs/voice R2). Asking the engine is the only way to know.
  useEffect(() => {
    let cancelled = false;
    void isLanguageAvailable(language).then((available) => {
      if (!cancelled) setCanSpeak(available);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  /**
   * One mutation for every preference on this screen.
   *
   * `onMutate` applies the change locally and hands back the document it
   * replaced; `onError` puts that document back. There is no cache
   * invalidation to do — `PATCH /users/me` answers with the same projection
   * `GET /auth/me` does, so the response *is* the new state.
   */
  const savePreference = useMutation<{ user: User }, unknown, UserSettingsPatch, User | null>({
    mutationFn: (patch) => usersApi.updateMe(patch),
    onMutate: (patch) => {
      setFailure(null);
      const previous = user;
      if (user) setUser(applyPatch(user, patch));
      return previous;
    },
    onError: (error, _patch, previous) => {
      if (previous) setUser(previous);
      setFailure(describeError(error));
    },
    onSuccess: (data) => setUser(data.user),
  });

  const writeDisabled = guard.blocked || savePreference.isPending;

  const onLanguageChange = useCallback(
    (next: Language) => {
      setFailure(null);
      // Device-first: the switch happens whether or not the mirror lands, so
      // this is deliberately not routed through the mutation above.
      void setLanguage(next, { sync: !guard.blocked });
    },
    [guard.blocked, setLanguage],
  );

  const appVersion =
    Constants.expoConfig?.version ?? (Constants as { nativeAppVersion?: string }).nativeAppVersion;

  return (
    <Screen edges={['left', 'right', 'bottom']} testID="settings-screen">
      {sessionUnverified ? (
        <Notice tone="warning" testID="session-unverified-notice">
          <Text variant="small" color="ink700">
            {t('mobile:offline.sessionUnverified')}
          </Text>
        </Notice>
      ) : null}

      {guard.reason ? (
        <Notice tone="info" testID="settings-offline-notice">
          <Text variant="small" color="ink700">
            {guard.reason}
          </Text>
        </Notice>
      ) : null}

      {failure ? (
        <Notice tone="danger" testID="settings-error">
          <Text variant="small" color="ink700">
            {failure}
          </Text>
        </Notice>
      ) : null}

      {user ? (
        <View style={styles.section}>
          <SectionHeader title={t('mobile:settings.accountTitle')} />
          <Card>
            <View style={styles.rows}>
              <Text variant="bodyStrong">{user.name}</Text>
              <Row label={t('auth:emailLabel')} value={user.email} />
            </View>
          </Card>
        </View>
      ) : null}

      <View style={styles.section}>
        <Card>
          <View style={styles.rows}>
            <Select<Language>
              label={t('common:language.label')}
              options={LANGUAGES.map((code) => ({
                value: code,
                label: t(`common:language.${code}`),
              }))}
              value={language}
              onChange={onLanguageChange}
              testID="language-select"
            />

            <Select<LandUnit>
              label={t('mobile:settings.unitsTitle')}
              hint={t('mobile:settings.unitsBody')}
              options={LAND_UNITS.map((unit) => ({
                value: unit,
                label: t(`common:unit.${unit}`),
              }))}
              value={user?.units.land}
              onChange={(land) => savePreference.mutate({ units: { land } })}
              disabled={writeDisabled || !user}
              testID="land-unit-select"
            />
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title={t('community:pageTitle')} />
        <Card>
          <View style={styles.rows}>
            <Switch
              label={t('mobile:settings.consentTitle')}
              hint={t('mobile:settings.consentBody')}
              value={user?.communityConsent ?? false}
              onValueChange={(communityConsent) => savePreference.mutate({ communityConsent })}
              disabled={writeDisabled || !user}
              testID="community-consent-switch"
            />
            <Notice tone="info">
              <Text variant="caption" color="ink700">
                {t('community:privacyNote')}
              </Text>
            </Notice>
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title={t('voice:title')} />
        <Card>
          <View style={styles.rows}>
            <Switch
              label={t('mobile:settings.voiceTitle')}
              hint={t('mobile:settings.voiceBody')}
              value={user?.voiceEnabled ?? false}
              onValueChange={(voiceEnabled) => savePreference.mutate({ voiceEnabled })}
              disabled={writeDisabled || !user || !canSpeak}
              testID="voice-switch"
            />
            {canSpeak ? null : (
              <Text variant="caption" color="ink500">
                {t('mobile:tts.unavailable')}
              </Text>
            )}
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title={t('mobile:settings.aboutTitle')} />
        <Card>
          <View style={styles.rows}>
            {appVersion ? <Row label={t('mobile:settings.version')} value={appVersion} /> : null}
            {/* Dev builds only — never infrastructure on a farmer's screen. */}
            {IS_DEV ? <Row label={t('mobile:settings.apiUrl')} value={API_BASE_URL} /> : null}
            <Text variant="small" color="ink700">
              {t('mobile:settings.disclaimer')}
            </Text>
          </View>
        </Card>
      </View>

      <Button
        variant="danger"
        fullWidth
        onPress={() => setConfirmingLogout(true)}
        testID="logout-button"
      >
        {t('auth:logout')}
      </Button>

      <Modal
        visible={confirmingLogout}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmingLogout(false)}
      >
        <View style={styles.backdrop}>
          <Card style={styles.dialog}>
            <View style={styles.rows}>
              <Text variant="subheading" accessibilityRole="header">
                {t('auth:logoutConfirmTitle')}
              </Text>
              <Text variant="small" color="ink700">
                {t('auth:logoutConfirmBody')}
              </Text>
              <View style={styles.dialogActions}>
                <Button
                  variant="secondary"
                  onPress={() => setConfirmingLogout(false)}
                  disabled={loggingOut}
                >
                  {t('common:action.cancel')}
                </Button>
                <Button
                  variant="danger"
                  loading={loggingOut}
                  onPress={() => {
                    setLoggingOut(true);
                    void logout().finally(() => {
                      // The root navigator swaps stacks off `status`, so this
                      // screen is unmounted by the state change rather than by
                      // a navigation call from here.
                      setLoggingOut(false);
                      setConfirmingLogout(false);
                    });
                  }}
                  testID="logout-confirm"
                >
                  {t('auth:logout')}
                </Button>
              </View>
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="small" color="ink500">
        {label}
      </Text>
      <Text variant="small" style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** The optimistic projection of a patch onto the current user document. */
function applyPatch(user: User, patch: UserSettingsPatch): User {
  return {
    ...user,
    ...(patch.language !== undefined ? { language: patch.language } : {}),
    ...(patch.units !== undefined ? { units: { land: patch.units.land } } : {}),
    ...(patch.voiceEnabled !== undefined ? { voiceEnabled: patch.voiceEnabled } : {}),
    ...(patch.communityConsent !== undefined ? { communityConsent: patch.communityConsent } : {}),
  };
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  rows: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowValue: { flexShrink: 1, textAlign: 'right' },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.overlay,
  },
  dialog: { padding: spacing.lg },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
});
