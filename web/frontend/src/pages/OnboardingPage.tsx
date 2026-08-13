import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button, ButtonLink } from '@/components/ui/Button';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { IconLeaf, IconPlus } from '@/components/ui/icons';

/**
 * First run: confirm the language, then add a field.
 *
 * Skippable (routes.md), because a farmer who lands here from a shared link
 * should not be trapped — the dashboard's own empty state carries the same
 * call to action.
 */
export default function OnboardingPage() {
  const { t } = useTranslation(['common', 'farm', 'auth']);
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-2 text-center">
        <span className="inline-flex text-brand-600" aria-hidden="true">
          <IconLeaf size={40} />
        </span>
        <h1 className="text-2xl">
          {user?.name ? `${t('common:app.name')} · ${user.name}` : t('common:app.name')}
        </h1>
        <p className="text-sm text-ink-500">{t('common:app.tagline')}</p>
      </div>

      <div className="space-y-2 text-center">
        <p className="text-sm font-medium text-ink-700">{t('auth:languagePrompt')}</p>
        <div className="flex justify-center">
          <LanguageToggle />
        </div>
      </div>

      <div className="space-y-3">
        <ButtonLink to="/farms/new" size="lg" fullWidth leadingIcon={<IconPlus size={18} />}>
          {t('farm:listEmptyCta')}
        </ButtonLink>
        <Button
          variant="ghost"
          fullWidth
          onClick={() => navigate('/dashboard', { replace: true })}
          data-testid="onboarding-skip"
        >
          {t('common:action.skip')}
        </Button>
      </div>
    </main>
  );
}
