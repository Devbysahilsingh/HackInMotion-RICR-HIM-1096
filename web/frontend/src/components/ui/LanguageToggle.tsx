import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';

/**
 * Language switch, visible before sign-in too (routes.md: "language switch
 * visible pre-auth") — a farmer who cannot read the login form cannot get far
 * enough to reach a setting.
 *
 * Each option shows its own language's own name, so it is legible to the
 * person who wants it regardless of what is currently active.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const { language, languages, setLanguage } = useLanguage();

  return (
    <div
      className={cn('inline-flex rounded-lg border border-line bg-surface p-0.5', className)}
      role="group"
      aria-label={t('language.label')}
    >
      {languages.map((option) => {
        const active = option === language;
        return (
          <button
            key={option}
            type="button"
            data-testid={`language-${option}`}
            aria-pressed={active}
            onClick={() => setLanguage(option)}
            className={cn(
              'touch-target rounded-md px-3 text-sm font-medium',
              active ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-brand-50',
            )}
          >
            {t(`language.${option}`)}
          </button>
        );
      })}
    </div>
  );
}
