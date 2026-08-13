import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/auth/AuthContext';
import { ButtonLink } from '@/components/ui/Button';
import { IconLeaf } from '@/components/ui/icons';

/**
 * The designed 404 (routes.md: "localized, back-home CTA").
 *
 * The home link points at the dashboard for a signed-in farmer and the login
 * page otherwise, so the way out never lands on another guard bounce.
 */
export default function NotFoundPage() {
  const { t } = useTranslation(['common', 'errors', 'auth']);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    document.title = `${t('errors:notFoundTitle')} · ${t('common:app.name')}`;
  }, [t]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-brand-500" aria-hidden="true">
        <IconLeaf size={40} />
      </span>
      <h1 className="text-xl">{t('errors:notFoundTitle')}</h1>
      <p className="text-sm text-ink-500">{t('errors:notFoundBody')}</p>
      <ButtonLink to={isAuthenticated ? '/dashboard' : '/login'}>
        {isAuthenticated ? t('common:nav.dashboard') : t('auth:goToLogin')}
      </ButtonLink>
    </main>
  );
}
