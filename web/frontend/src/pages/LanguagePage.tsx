import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usersApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import type { Language, User } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { Notice } from '@/components/ui/states';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';

/**
 * Language, as a screen rather than a toggle.
 *
 * The compact switch in the top bar is right for changing your mind mid-task;
 * it is the wrong control for *choosing* a language, because it shows neither
 * what will change nor what state the translation is actually in. The design
 * gives the choice a page: each language as a full row with a sample of crop
 * names in that script, and a standing note about what is and is not verified.
 *
 * Both halves of the switch happen here: the interface changes immediately
 * (localStorage + `<html lang>`), and the choice is persisted to the account so
 * signing in on another device brings it along.
 *
 * ## One row from the design is not built
 *
 * The mockup lists a greyed "मराठी — coming after review · Soon" row. This
 * system ships English and Hindi and no Marathi work is planned or resourced,
 * so rendering that row would advertise a roadmap that does not exist (rule 7).
 * The languages listed are the ones `LanguageContext` actually provides.
 */

/** The script sample shown under each language, and the mark's colour. */
const SAMPLE: Record<Language, { sampleKey: string; mark: string; markClass: string }> = {
  en: { sampleKey: 'language.sampleEn', mark: 'En', markClass: 'bg-brand-600 text-white' },
  hi: { sampleKey: 'language.sampleHi', mark: 'अ', markClass: 'bg-harvest-500 text-earth-800' },
};

export default function LanguagePage() {
  const { t } = useTranslation('common');
  const { language, languages, setLanguage } = useLanguage();
  const { user, applyUser } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  /*
   * Persisting is best-effort on top of a switch that has already happened. The
   * interface must not wait on the network to change language — a farmer who
   * cannot read the current screen is exactly the person with a bad connection
   * — so a failed save is reported without reverting what they can now read.
   */
  const persist = useMutation({
    mutationFn: (next: Language) => usersApi.updateMe({ language: next }),
    onSuccess: ({ user: updated }: { user: User }) => {
      applyUser(updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.session() });
    },
    onError: (error) => toast.push(toMessage(error), 'error'),
  });

  const choose = (next: Language) => {
    if (next === language) return;
    setLanguage(next);
    if (user) persist.mutate(next);
  };

  return (
    <>
      <PageHeader title={t('language.label')} description={t('language.pageBody')} />

      <div className="max-w-[41rem] space-y-3">
        {languages.map((option) => {
          const selected = option === language;
          const { sampleKey, mark, markClass } = SAMPLE[option];

          return (
            <Card
              key={option}
              className={cn('overflow-hidden', selected && 'border-2 border-brand-600')}
            >
              <button
                type="button"
                aria-pressed={selected}
                data-testid={`language-choice-${option}`}
                onClick={() => choose(option)}
                className="flex w-full items-center gap-3.5 p-5 text-left hover:bg-canvas/60"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-11 shrink-0 place-items-center rounded-xl font-semibold',
                    markClass,
                  )}
                >
                  {mark}
                </span>

                <span className="min-w-0 flex-1">
                  {/* Each language names itself, so it is legible to the person
                      who wants it regardless of what is currently active. */}
                  <b className="block text-[1.063rem] font-semibold">{t(`language.${option}`)}</b>
                  <span className="block text-[0.844rem] text-ink-500">{t(sampleKey)}</span>
                </span>

                {selected ? (
                  <Badge tone="success">{t('language.selected')}</Badge>
                ) : (
                  <span className="shrink-0 text-[0.844rem] font-semibold text-brand-600">
                    {t('language.switch')} →
                  </span>
                )}
              </button>
            </Card>
          );
        })}

        {/*
          The standing statement about translation state. It belongs on this
          screen specifically: this is where someone decides to read the app in
          Hindi, and the disease guidance they will meet there is machine-
          translated and not yet reviewed by a Hindi-speaking agronomist.
        */}
        <Notice tone="info">{t('language.reviewNote')}</Notice>
      </div>
    </>
  );
}
