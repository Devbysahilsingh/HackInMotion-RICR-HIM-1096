import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { marketApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { MarketPricePoint, PriceSeriesResponse } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { PriceTrendChart } from '@/components/charts/PriceTrendChart';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Card, Section } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { KeyValueList, KeyValueRow } from '@/components/ui/KeyValueRow';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatTile } from '@/components/ui/Stat';
import { EmptyState, Notice } from '@/components/ui/states';
import { WhyTrace } from '@/components/domain/WhyTrace';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatCurrency, formatDate } from '@/lib/format';

/**
 * One mandi, one commodity.
 *
 * The design gives a mandi its own screen: the modal price large, the day's low
 * and high beside it, then the recent reporting days and what the movement means
 * for the farmer. Before this, a mandi name in the nearby list was a dead end —
 * the only price detail lived on a crop's market tab, which a farmer browsing
 * mandis has no reason to be in.
 *
 * The market name is a path segment and the commodity a query parameter, because
 * the same mandi trades many things and the pairing is what identifies a series.
 *
 * `/market/prices` is scoped by state and district rather than by market — the
 * API has no per-mandi route — so the series is fetched for the district and
 * filtered to this market here. That keeps the request identical to the one the
 * market page already makes, so the cache is shared rather than doubled.
 *
 * Note what is deliberately absent: any distance to the mandi. `noDistanceNote`
 * states the reason plainly — mandi locations are not published in the source
 * data, so the design's "12 km" has nothing behind it and is not invented here.
 */
export default function MandiDetailPage() {
  const { t } = useTranslation(['market', 'common']);
  const { market = '' } = useParams();
  const [searchParams] = useSearchParams();

  const commodity = searchParams.get('commodity') ?? '';
  const state = searchParams.get('state') ?? undefined;
  const district = searchParams.get('district') ?? undefined;

  /**
   * The window, in days. Matches the market page's default so the two screens
   * share one cache entry rather than each fetching its own copy of the series.
   */
  const days = 30;

  const query = useQuery({
    queryKey: queryKeys.market.prices(commodity, state, district, days),
    queryFn: () => marketApi.prices({ commodity, state, district, days }),
    enabled: Boolean(commodity),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <>
      <PageHeader title={market} kicker={t('market:pageTitle')} description={commodity} />

      {!commodity ? (
        <EmptyState title={t('market:commodityNotFound')} />
      ) : (
        <QueryBoundary query={query} loading={<SkeletonCard />}>
          {(data) => <MandiDetail data={data} market={market} days={days} />}
        </QueryBoundary>
      )}
    </>
  );
}

function MandiDetail({
  data,
  market,
  days,
}: {
  data: PriceSeriesResponse;
  market: string;
  days: number;
}) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  /*
   * Only this mandi's reports, newest first. The series arrives ascending by
   * date for charting; a farmer reading a list wants the most recent report at
   * the top.
   */
  const points: MarketPricePoint[] = data.series
    .filter((point) => point.market === market)
    .slice()
    .reverse();

  const latest = points[0] ?? null;

  if (!latest) {
    return <EmptyState title={t('market:emptySeries')} />;
  }

  const { signal } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <FreshnessDot freshness={data.freshness} />
        {signal.trend && (
          <Badge
            tone={
              signal.trend === 'RISING'
                ? 'success'
                : signal.trend === 'FALLING'
                  ? 'danger'
                  : 'neutral'
            }
          >
            {t(`market:title${signal.trend}`)}
          </Badge>
        )}
      </div>

      {/* The design's three-figure header: modal large, low and high beside it. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={t('market:latestPrice')}
          value={formatCurrency(latest.modalPrice, language)}
          hint={formatDate(latest.date, language)}
        />
        <StatTile label={t('market:minColumn')} value={formatCurrency(latest.minPrice, language)} />
        <StatTile label={t('market:maxColumn')} value={formatCurrency(latest.maxPrice, language)} />
      </div>

      {/*
        An adjusted price is a corrected reading, and the farmer is told which
        one it was rather than being shown a silently repaired number.
      */}
      {latest.adjusted && <Notice tone="info">{t('market:priceAdjusted')}</Notice>}

      {/*
        The series behind the figure. It lives here rather than on the market
        screen: that screen answers "what is trading near me", and a chart of
        one commodity in one mandi is the follow-up question a farmer arrives
        at by opening this page. The chart carries its own accessible data
        table, so the history is readable without reading a picture.
      */}
      <PriceTrendChart series={data.series} days={days} />

      <Section title={t('market:recentReports')} as="h2">
        <Card className="px-5 py-2">
          <KeyValueList>
            {points.slice(0, 7).map((point) => (
              <KeyValueRow
                key={point.date}
                label={formatDate(point.date, language)}
                value={formatCurrency(point.modalPrice, language)}
              />
            ))}
          </KeyValueList>
        </Card>
      </Section>

      <Section title={t('market:signalHeading')} as="h2">
        <Card className="space-y-3 p-5">
          <p className="text-[0.938rem]">
            {translateMessageKey(t, signal.guidanceKey, {
              pct: signal.changePct7d ?? 0,
              modal: latest.modalPrice,
              district: '',
            })}
          </p>

          {signal.momentumDiverges && (
            <p className="text-sm text-ink-500">{t('market:momentumNote')}</p>
          )}

          {/*
            The product's standing promise about prices, on the screen where a
            farmer is most likely to read a forecast into a trend.
          */}
          <Notice tone="info">{t('market:neverPredicts')}</Notice>

          <WhyTrace trace={signal.trace} />
        </Card>
      </Section>

      <p className="text-sm text-ink-500">{t('market:noDistanceNote')}</p>
    </div>
  );
}
