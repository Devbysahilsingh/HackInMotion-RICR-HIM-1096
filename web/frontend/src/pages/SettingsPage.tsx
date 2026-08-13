import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { VoicePanel } from '@/components/domain/VoicePanel';
import { PageHeader } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';

export default function SettingsPage() {
  const { t } = useTranslation(['common', 'auth', 'community', 'voice']);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  return (
    <>
      <PageHeader title={t('common:nav.settings')} />

      <div className="space-y-8">
        {user && (
          <Section title={user.name} as="h2">
            <Card>
              <dl className="space-y-2 p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t('auth:emailLabel')}</dt>
                  <dd className="truncate font-medium">{user.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t('common:language.label')}</dt>
                  <dd className="font-medium">{t(`common:language.${user.language}`)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t('community:pageTitle')}</dt>
                  <dd>
                    {/*
                      Read-only: the API exposes no user-update route, so a
                      toggle here would be a control that does nothing. The
                      consent flag is shown as the account holds it.
                    */}
                    <Badge tone={user.communityConsent ? 'success' : 'neutral'}>
                      {user.communityConsent
                        ? t('community:consentOn')
                        : t('community:consentOff')}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </Card>
          </Section>
        )}

        <Section title={t('common:language.label')} as="h2">
          <LanguageToggle />
        </Section>

        <Section title={t('voice:title')} as="h2">
          <VoicePanel />
        </Section>

        <Section title={t('auth:logout')} as="h2">
          <Button
            variant="danger"
            onClick={() => setConfirmOpen(true)}
            data-testid="logout-button"
          >
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
