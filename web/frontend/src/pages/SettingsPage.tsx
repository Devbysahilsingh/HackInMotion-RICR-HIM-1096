import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usersApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import { LAND_UNITS, type LandUnit, type Language, type User } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { PreferenceToggle } from '@/components/domain/PreferenceToggle';
import { VoicePanel } from '@/components/domain/VoicePanel';
import { PageHeader } from '@/components/layout/AppLayout';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { ConfirmDialog } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { useApiErrorMessage } from '@/hooks/useApiError';

/**
 * Account settings.
 *
 * Everything on this page except the language toggle writes to
 * `PATCH /users/me`. That endpoint has existed since the Phase 7 pass but was
 * never wired up here — the page showed consent as a read-only badge and
 * carried no land-unit control at all, so two account preferences the API
 * accepts were unreachable from the web client.
 *
 * There is no Save button: each control owns one field and writes it on
 * change. That suits a page of four independent switches better than a form,
 * and it means a farmer never leaves a change unsaved. Failures roll the
 * control back and say so.
 */
export default function SettingsPage() {
  const { t } = useTranslation(['common', 'auth', 'community', 'voice', 'farm']);
  const { user, applyUser, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  /**
   * One mutation for every preference, keyed by the field being written so two
   * toggles in flight cannot show each other's spinner.
   */
  const [pendingField, setPendingField] = useState<string | null>(null);

  const savePreference = useMutation({
    mutationFn: (payload: Parameters<typeof usersApi.updateMe>[0]) => usersApi.updateMe(payload),

    onSuccess: ({ user: updated }: { user: User }) => {
      // The server's projection is the truth — adopting the response rather
      // than the optimistic guess keeps this page honest if the API ever
      // normalises a value on the way in.
      applyUser(updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.session() });
      // Community counting depends on the consent flag, so its read is stale
      // the moment consent changes.
      void queryClient.invalidateQueries({ queryKey: queryKeys.community.all() });
      toast.push(t('common:state.saved'), 'success');
    },

    onError: (error) => toast.push(toMessage(error), 'error'),
    onSettled: () => setPendingField(null),
  });

  const save = (field: string, payload: Parameters<typeof usersApi.updateMe>[0]) => {
    setPendingField(field);
    savePreference.mutate(payload);
  };

  return (
    <>
      <PageHeader title={t('common:nav.settings')} kicker={user?.name} />

      <div className="max-w-2xl space-y-8">
        {user && (
          <Section title={t('auth:accountHeading')} as="h2">
            <Card>
              <dl className="space-y-2 p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t('auth:nameLabel')}</dt>
                  <dd className="truncate font-medium">{user.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t('auth:emailLabel')}</dt>
                  <dd className="truncate font-medium">{user.email}</dd>
                </div>
              </dl>
            </Card>
          </Section>
        )}

        <Section
          title={t('common:language.label')}
          as="h2"
          action={
            /*
              Through to the full language screen, which shows each language in
              its own script with a sample of crop names and the standing note
              about what has been verified. The inline toggle stays for a quick
              change; the page is where the choice is actually explained.
            */
            <ButtonLink to="/settings/language" variant="ghost" size="md">
              {t('common:action.viewAll')}
            </ButtonLink>
          }
        >
          {/*
            The toggle switches the interface immediately (localStorage +
            `<html lang>`); this persists the same choice to the account so a
            farmer signing in on another device gets their language back.
          */}
          <LanguageToggle
            onChange={(language: Language) => {
              if (user && language !== user.language) save('language', { language });
            }}
          />
        </Section>

        {user && (
          <>
            <Section title={t('farm:sizeUnitLabel')} as="h2">
              <LandUnitChoice
                value={user.units.land}
                isPending={pendingField === 'units'}
                onChange={(land) => save('units', { units: { land } })}
              />
            </Section>

            <Section title={t('voice:title')} as="h2">
              <div className="space-y-3">
                <PreferenceToggle
                  label={t('voice:enableLabel')}
                  description={t('voice:enableHint')}
                  checked={user.voiceEnabled}
                  isPending={pendingField === 'voiceEnabled'}
                  testId="voice-toggle"
                  onChange={(voiceEnabled) => save('voiceEnabled', { voiceEnabled })}
                />
                {/* Browser support, voice picker and a test phrase. */}
                <VoicePanel />
              </div>
            </Section>

            <Section title={t('community:pageTitle')} as="h2">
              <PreferenceToggle
                label={t('community:consentLabel')}
                description={t('community:consentHint')}
                checked={user.communityConsent}
                isPending={pendingField === 'communityConsent'}
                testId="consent-toggle"
                onChange={(communityConsent) => save('communityConsent', { communityConsent })}
              />
            </Section>
          </>
        )}

        <Section title={t('auth:logout')} as="h2">
          <Button variant="danger" onClick={() => setConfirmOpen(true)} data-testid="logout-button">
            {t('auth:logout')}
          </Button>
        </Section>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setIsLoggingOut(true);
          await logout();
          setIsLoggingOut(false);
          setConfirmOpen(false);
          navigate('/login', { replace: true });
        }}
        title={t('auth:logoutConfirmTitle')}
        body={t('auth:logoutConfirmBody')}
        confirmLabel={t('auth:logout')}
        isPending={isLoggingOut}
      />
    </>
  );
}

/**
 * Acre or hectare.
 *
 * This was a hand-rolled radio group until the design pass; it is now the shared
 * `SegmentedControl`, which is the same control the design uses everywhere a
 * small exclusive choice appears. One implementation means the selected chip,
 * its shadow and its disabled behaviour cannot drift between here and the
 * market and weather screens.
 */
function LandUnitChoice({
  value,
  onChange,
  isPending,
}: {
  value: LandUnit;
  onChange: (unit: LandUnit) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation('common');

  return (
    <SegmentedControl
      label={t('unit.landLabel')}
      value={value}
      disabled={isPending}
      testId="land-unit"
      onChange={onChange}
      options={LAND_UNITS.map((unit) => ({ value: unit, label: t(`unit.${unit}`) }))}
    />
  );
}
