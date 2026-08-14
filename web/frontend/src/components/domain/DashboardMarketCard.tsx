import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { marketApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { NearbyCommodity } from '@/api/types';
import { useCropNames } from '@/hooks/useCropNames';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { IconTrendUp } from '@/components/ui/icons';
import { PriceMove } from './PriceMove';

const MARKET_DAYS = 30;

/** Rows on the card before it defers to the market screen. */
const MAX_ROWS = 3;

/**
 * The dashboard's market slot, for the field selected in the sidebar.
 *
 * ## Why this reads the mandis rather than the crops
 *
 * It used to call `/market/my-crops` and print one row per crop the farmer
 * grows. On an account whose only crop had no recent report that produced a
 * card saying "No price movement to report" — beside four mandis that were
 * publishing six commodities. The card was empty for the one reason a market
 * card must never be empty: the market had prices, they just were not this
 * crop's.
 *
 * `/market/nearby` answers the farm's question instead: what is trading around
 * this field, newest observation per commodity, with the signal engine's
 * movement attached. The farmer's own crops come first — that ordering is the
 * only thing this component decides.
 *
 * The summary line is data-gated. It names a rising and a falling commodity
 * only when the engine actually returned both; otherwise it states how many
 * prices are on hand, which is a fact rather than a characterisation.
 */
export function DashboardMarketCard({
  farmId,
  cropCodes,
}: {
  farmId: string;
  cropCodes: string[];
}) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  const query = useQuery({
    queryKey: queryKeys.market.nearby(farmId, undefined, MARKET_DAYS),
    queryFn: () => marketApi.nearby({ farmId, days: MARKET_DAYS }),
    enabled: Boolean(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (query.isPending) return <SkeletonCard />;

  const commodities = query.data?.commodities ?? [];

  if (query.isError || commodities.length === 0) {
    return (
      <Card className="flex h-full flex-col p-5" data-testid="dashboard-market-empty">
        <div className="flex items-center justify-between gap-2">
          <span className="kicker">{t('common:dashboard.marketTitle')}</span>
          <IconTrendUp size={18} className="text-leaf-700" aria-hidden="true" />
        </div>
        <p className="mt-3 text-sm font-semibold text-ink-900">{t('market:noMarketTitle')}</p>
        <p className="mt-1 text-sm text-ink-500">{t('market:noMarketBody')}</p>
        <ButtonLink to="/market" variant="secondary" size="md" className="mt-auto pt-3">
          {t('market:viewNearbyCta')}
        </ButtonLink>
      </Card>
    );
  }

  // The farmer's own crops first; everything else keeps the API's own order.
  const mine = new Set(cropCodes);
  const ranked = [...commodities].sort(
    (a, b) => Number(mine.has(b.commodityCode)) - Number(mine.has(a.commodityCode)),
  );
  const rows = ranked.slice(0, MAX_ROWS);

  return (
    <Card className="flex h-full flex-col p-5" data-testid="dashboard-market">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{t('common:dashboard.marketTitle')}</span>
        <IconTrendUp size={18} className="text-leaf-700" aria-hidden="true" />
      </div>

      <ul className="mt-2">
        {rows.map((entry) => (
          <li
            key={entry.commodityCode}
            className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
          >
            <span className="min-w-0 truncate text-sm">{cropName(entry.commodityCode)}</span>
            <span className="flex shrink-0 items-center gap-2">
              <PriceMove trend={entry.trend} changePct={entry.changePct7d} />
              <span className="text-sm font-semibold tabular-nums">
                {t('common:unit.rupeesPerQuintal', {
                  value: formatNumber(entry.latest.modalPrice, language, {
                    maximumFractionDigits: 0,
                  }),
                })}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm leading-relaxed text-ink-500" data-testid="market-summary">
        {summaryOf(commodities, cropName, t)}
      </p>

      {query.data?.freshness.latestDate && (
        <p className="mt-1.5 text-xs text-ink-500">
          {t('market:latestArrivals', {
            date: formatDayMonth(query.data.freshness.latestDate, language),
          })}
        </p>
      )}

      <ButtonLink to="/market" variant="secondary" size="md" className="mt-auto pt-3">
        {t('market:viewNearbyCta')}
      </ButtonLink>
    </Card>
  );
}

/**
 * One sentence about the nearby market, or none at all.
 *
 * Only two forms exist. If the engine described both a rising and a falling
 * commodity, they are named — that is a comparison the data supports. Otherwise
 * the line counts what is on hand, which asserts nothing about direction. There
 * is deliberately no third form summarising a single direction: "everything is
 * up" from one rising commodity would be a characterisation the payload does
 * not carry (NFR-7).
 */
function summaryOf(
  commodities: NearbyCommodity[],
  cropName: (code: string) => string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const rising = commodities.find((entry) => entry.trend === 'RISING');
  const falling = commodities.find((entry) => entry.trend === 'FALLING');

  if (rising && falling) {
    return t('market:summaryMovement', {
      rising: cropName(rising.commodityCode),
      falling: cropName(falling.commodityCode),
    });
  }

  return t('market:summaryCommodities', { count: commodities.length });
}
