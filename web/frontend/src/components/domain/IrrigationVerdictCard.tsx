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
 * estimate is rough; `soilUncertaintyWide` means the soil's available-water
 * figure is the unspecified-soil placeholder and the error bar is wider; and the
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
        {/*
          The design sets the watering verdict as the largest thing on its
          surface — the whole screen is built to deliver one word ("Wait"). At
          card scale that becomes a display-weight heading rather than the
          body-sized label it used to be: a farmer scanning the page should be
          able to read the answer without reading the card.
        */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="kicker flex items-center gap-1.5">
            <IconDroplet size={14} aria-hidden="true" />
            {t('irrigation:pageTitle')}
          </span>
          <SpeakButton text={`${title}. ${body}`} />
        </div>

        <h3 className="max-w-[20ch] text-[1.5rem] leading-tight sm:text-[1.75rem]">{title}</h3>

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
        {/*
          The engine returns no soil object at the top level — the soil inputs
          are only in the `SOIL` trace step below. `soilUncertaintyWide` is the
          flag it does return, and it is set by exactly one AWC entry: the
          `unknown` placeholder (shared/constants/agronomy.js). So this reads
          the flag rather than a soil figure the response does not carry.
        */}
        {advice.soilUncertaintyWide && (
          <Notice tone="info" data-testid="irrigation-soil-uncertain">
            {t('irrigation:soilUnknown')}
          </Notice>
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
