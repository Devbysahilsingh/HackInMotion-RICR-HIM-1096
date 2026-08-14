import { useTranslation } from 'react-i18next';

import type { MarketSignal, MyCropSignal } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatDayMonth, formatNumber, formatPercent, localizedName } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SpeakButton } from '@/components/ui/SpeakButton';
import { Notice } from '@/components/ui/states';
import { IconTrendDown, IconTrendFlat, IconTrendUp } from '@/components/ui/icons';
import { WhyTrace } from './WhyTrace';

const TREND_ICON = {
  RISING: IconTrendUp,
  FALLING: IconTrendDown,
  STABLE: IconTrendFlat,
} as const;

/**
 * The market verdict, above any chart (ux-flows.md: "signal sentence ABOVE
 * chart (verdict-first)").
 *
 * This describes what prices **have already done**. It is not a forecast, and
 * the API has no endpoint that would make one — NFR-7 rules out predictions
 * entirely ("Never: predictions, guarantees, 'will rise'"). The guidance
 * sentence comes from the engine's own `guidanceKey`, which is written in that
 * register, so this component cannot accidentally promise anything.
 */
export function MarketSignalCard({
  signal,
  title,
}: {
  signal:
    | MyCropSignal
    | {
        signal: MarketSignal;
        freshness: MyCropSignal['freshness'];
        names?: MyCropSignal['names'];
        district?: string | null;
      };
  title?: string;
}) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  const inner = signal.signal;
  const name = 'names' in signal ? localizedName(signal.names ?? null, language) : null;

  /*
   * `trend` is null when there were no observations at all. There is no
   * `market.titlenull` key and there should not be one: "we cannot describe a
   * trend" is a different statement from "prices are steady", and the engine
   * is careful to distinguish them. The guidance key it sends in that case is
   * already `market.guidanceUnavailable`.
   */
  const Icon = inner.trend ? (TREND_ICON[inner.trend] ?? IconTrendFlat) : IconTrendFlat;
  const headline = inner.trend ? t(`market:title${inner.trend}`) : t('market:noSignal');

  const guidance = translateMessageKey(t, inner.guidanceKey, {
    pct: Math.abs(inner.changePct7d ?? 0).toFixed(1),
    district: ('district' in signal ? signal.district : null) ?? '',
    modal: '',
  });

  return (
    <Card data-testid="market-signal" data-trend={inner.trend}>
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Icon size={20} aria-hidden="true" />
            {title ?? name?.text ?? headline}
          </h3>
          <SpeakButton text={`${headline}. ${guidance}`} />
        </div>

        {/*
          The price leads, whether or not a trend exists.

          This card used to open with the trend badge, so a commodity with one
          real observation and no describable movement rendered "Not enough
          recent reports to describe a trend" and nothing else — hiding a price
          the API had returned. "No trend" and "no price" are different facts
          and only the second one has nothing to show.
        */}
        {'latestPrice' in signal && signal.latestPrice && (
          <div data-testid="market-latest-price">
            <p className="font-display text-[1.75rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums">
              {t('common:unit.rupeesPerQuintal', {
                value: formatNumber(signal.latestPrice.modalPrice, language, {
                  maximumFractionDigits: 0,
                }),
              })}
            </p>
            <p className="mt-1.5 text-sm text-ink-500">
              {signal.latestPrice.market} · {formatDayMonth(signal.latestPrice.date, language)}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={inner.trend && inner.trend !== 'STABLE' ? 'brand' : 'neutral'}>
            {headline}
          </Badge>
          {inner.changePct7d != null && (
            <Badge>
              {t('market:change7d')}: {formatPercent(inner.changePct7d, language)}
            </Badge>
          )}
          {inner.changePct30d != null && (
            <Badge>
              {t('market:change30d')}: {formatPercent(inner.changePct30d, language)}
            </Badge>
          )}
        </div>

        <p className="text-sm text-ink-700">{guidance}</p>

        {/*
          A 7-day move that contradicts the 30-day trend is exactly the case
          where acting on the short window is most likely to be wrong.
        */}
        {inner.momentumDiverges && (
          <Notice tone="warning" data-testid="market-momentum">
            {t('market:momentumNote')}
          </Notice>
        )}

        <FreshnessDot freshness={signal.freshness} />

        <WhyTrace trace={inner.trace} />
      </div>
    </Card>
  );
}
