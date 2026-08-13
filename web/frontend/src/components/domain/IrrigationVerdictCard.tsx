import { useTranslation } from 'react-i18next';

import type { IrrigationAdvice } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SpeakButton } from '@/components/ui/SpeakButton';
import { Notice } from '@/components/ui/states';
import { IconDroplet } from '@/components/ui/icons';
import { WhyTrace } from './WhyTrace';

/**
 * Today's watering verdict.
 *
 * Verdict-first: the answer is the heading, the amount is the number under it,
 * and the reasoning is one tap away. The engine's own i18n keys carry both the
 * headline and the body, so this component chooses no words.
 *
 * The three honesty labels are all mandatory rather than decorative:
 * `mode: 'simplified'` means the forecast had no evapotranspiration and the
 * estimate is rough; an `unknown` soil type widens the error bar; and the
 * freshness dot says how old the weather behind the whole calculation is. Any
 * of them missing would present a guess as a measurement.
 */
const VERDICT_TONE: Record<string, string> = {
  IRRIGATE_TODAY: 'border-priority-high/40 bg-priority-high-soft',
  IRRIGATE_IN_N_DAYS: 'border-priority-medium/40 bg-priority-medium-soft',
  WAIT_RAIN_EXPECTED: 'border-brand-200 bg-brand-50',
  NO_IRRIGATION_NEEDED: 'border-brand-200 bg-brand-50',
  MAINTAIN_WATER_LEVEL: 'border-brand-200 bg-brand-50',
  UNAVAILABLE: 'border-line bg-canvas',
};

export function IrrigationVerdictCard({
  advice,
  action,
}: {
  advice: IrrigationAdvice;
  action?: React.ReactNode;
}) {
  const { t } = useTranslation(['irrigation', 'common', 'agri']);
  const { language } = useLanguage();

  const params = {
    ...advice,
    days: advice.days ?? 0,
    amountMm: advice.amountMm ?? 0,
    amountLitersPerAcre: advice.amountLitersPerAcre ?? 0,
    rainMm: advice.rain?.mm ?? 0,
    date: advice.rain?.date ? formatDayMonth(advice.rain.date, language) : '',
  };

  /*
   * The engine returns `verdict: null` when it declined to reach one at all —
   * a crop that has not been sown yet is the everyday case. Composing a key
   * from that null would ask i18next for `irrigation.titlenull` and print a
   * raw identifier at the farmer, so it collapses to the UNAVAILABLE copy and
   * the reason code carries the actual explanation below.
   */
  const verdict = advice.verdict ?? 'UNAVAILABLE';

  const title = translateMessageKey(t, `irrigation.title${verdict}`, params);
  const body = translateMessageKey(t, `irrigation.body${verdict}`, params);

  return (
    <Card
      data-testid="irrigation-verdict"
      data-verdict={verdict}
      className={cn('border', VERDICT_TONE[verdict] ?? VERDICT_TONE.UNAVAILABLE)}
    >
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <IconDroplet size={20} aria-hidden="true" />
            {title}
          </h3>
          <SpeakButton text={`${title}. ${body}`} />
        </div>

        <p className="text-sm text-ink-700">{body}</p>

        {/* Why there is no verdict — the reason code is the whole answer here. */}
        {!advice.hasVerdict && advice.reasonCode && (
          <p className="text-sm text-ink-500" data-testid="irrigation-reason">
            {t(`irrigation:reason${advice.reasonCode}`, { defaultValue: '' })}
          </p>
        )}

        {advice.amountMm != null && (
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface/70 px-3 py-2 text-sm">
            <div>
              <dt className="text-xs text-ink-500">{t('irrigation:amountHeading')}</dt>
              <dd className="font-semibold">
                {formatNumber(advice.amountMm, language)} {t('common:unit.mm')}
              </dd>
            </div>
            {advice.amountLitersPerAcre != null && (
              <div>
                <dt className="text-xs text-ink-500">{t('common:unit.litresPerAcre')}</dt>
                <dd className="font-semibold">
                  {formatNumber(advice.amountLitersPerAcre, language)}
                </dd>
              </div>
            )}
          </dl>
        )}

        {advice.splitAdvised && <Notice tone="warning">{t('irrigation:splitAdvised')}</Notice>}
        {advice.mode === 'simplified' && (
          <Notice tone="warning" data-testid="irrigation-simplified">
            {t('irrigation:modeSimplified')}
          </Notice>
        )}
        {advice.soil?.soilType === 'unknown' && (
          <Notice tone="info">{t('irrigation:soilUnknown')}</Notice>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <FreshnessDot freshness={advice.freshness} />
          {action}
        </div>

        <WhyTrace trace={advice.trace} />
      </div>
    </Card>
  );
}
