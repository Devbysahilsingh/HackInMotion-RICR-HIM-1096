import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { marketApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { MyCropSignal, PriceSeriesResponse } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { PriceTrendChart } from '@/components/charts/PriceTrendChart';
import { MarketSignalCard } from '@/components/domain/MarketSignalCard';
import { NearbyMandis } from '@/components/domain/NearbyMandis';
import { PageHeader } from '@/components/layout/AppLayout';
import { Card, Section } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState, Notice } from '@/components/ui/states';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth, formatNumber, localizedName } from '@/lib/format';

const RANGES = [30, 60, 90] as const;
type Range = (typeof RANGES)[number];

/**
 * Mandi prices.
 *
 * Verdict-first: the signal sentence sits above the chart, because the answer
 * to "should I sell?" is a sentence and the chart is the evidence for it
 * (ux-flows.md). Tabs come from the farmer's own active crops — this page
 * never asks them to know a commodity code.
 */
export default function MarketPage() {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  const [days, setDays] = useState<Range>(30);
  const [selected, setSelected] = useState<string | null>(null);

  const myCropsQuery = useQuery({
    queryKey: queryKeys.market.myCrops(days),
    queryFn: () => marketApi.myCrops({ days }),
    staleTime: STALE_TIME.slowMoving,
  });

  // Memoised because the default-selection effect below depends on it; a new
  // array identity every render would re-run the effect on every render.
  const crops = useMemo(() => myCropsQuery.data?.data.crops ?? [], [myCropsQuery.data]);

  // Default to the first crop once the list arrives, and recover if the
  // selected one disappears (harvested, deleted).
  useEffect(() => {
    if (crops.length === 0) return;
    if (!selected || !crops.some((crop) => crop.cropCode === selected)) {
      setSelected(crops[0]!.cropCode);
    }
  }, [crops, selected]);

  const active = crops.find((crop) => crop.cropCode === selected) ?? null;

  return (
    <>
      <PageHeader
        title={t('market:pageTitle')}
        description={t('market:neverPredicts')}
        actions={
          <div className="flex gap-1" role="group" aria-label={t('market:rangeLabel')}>
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                aria-pressed={days === range}
                onClick={() => setDays(range)}
                data-testid={`market-range-${range}`}
                className={
                  days === range
                    ? 'touch-target rounded-lg bg-brand-600 px-3 text-sm font-medium text-white'
                    : 'touch-target rounded-lg border border-line px-3 text-sm font-medium text-ink-700'
                }
              >
                {t(`market:range${range}`)}
              </button>
            ))}
          </div>
        }
      />

      {/*
        Nearby mandis come first. "Pick one of your crops" assumes the farmer
        already knows what they want to sell; this shows what their local
        mandis are actually trading, and the crop filter narrows it.
      */}
      <NearbyMandis days={days} />

      <QueryBoundary
        query={myCropsQuery}
        loading={<SkeletonCard />}
        isEmpty={(data) => data.data.crops.length === 0}
        empty={<EmptyState title={t('market:myCropsEmpty')} />}
      >
        {(data) => (
          <div className="space-y-6">
            <Tabs
              label={t('market:myCropsHeading')}
              value={selected ?? data.data.crops[0]!.cropCode}
              onChange={setSelected}
              items={data.data.crops.map((crop) => ({
                value: crop.cropCode,
                label: localizedName(crop.names, language)?.text ?? crop.cropCode,
              }))}
            />

            {active && <CropMarketView signal={active} days={days} />}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

function CropMarketView({ signal, days }: { signal: MyCropSignal; days: Range }) {
  const { t } = useTranslation(['market', 'common']);

  const pricesQuery = useQuery({
    queryKey: queryKeys.market.prices(
      signal.commodityCode,
      signal.state ?? undefined,
      signal.district ?? undefined,
      days,
    ),
    queryFn: () =>
      marketApi.prices({
        commodity: signal.commodityCode,
        ...(signal.state ? { state: signal.state } : {}),
        ...(signal.district ? { district: signal.district } : {}),
        days,
      }),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <div className="space-y-6">
      {/* The sentence first, then the evidence. */}
      <MarketSignalCard signal={signal} />

      <QueryBoundary query={pricesQuery} loading={<SkeletonCard />}>
        {(prices) => (
          <div className="space-y-4">
            {prices.freshness.status === 'historical' && (
              <Notice tone="warning" data-testid="market-historical">
                {t('market:sourceHistorical')}
              </Notice>
            )}

            <PriceTrendChart series={prices.series} days={days} />

            <Section title={t('market:compareHeading')} as="h2">
              <MandiTable prices={prices} />
            </Section>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

/**
 * The most recent report per mandi.
 *
 * An `adjusted` row is one whose published modal price fell outside its own
 * day's min–max range and was clamped to the nearest bound by the ingest
 * normalizer. It is flagged rather than shown as though it were published
 * as-is (rule 9).
 */
function MandiTable({ prices }: { prices: PriceSeriesResponse }) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  const latestPerMandi = new Map<string, PriceSeriesResponse['series'][number]>();
  for (const row of prices.series) {
    const existing = latestPerMandi.get(row.market);
    if (!existing || row.date > existing.date) latestPerMandi.set(row.market, row);
  }

  const rows = [...latestPerMandi.values()].sort((a, b) => b.modalPrice - a.modalPrice);

  if (rows.length === 0) {
    return <EmptyState title={t('market:emptySeries')} />;
  }

  return (
    <Card className="overflow-x-auto">
      <table
        className="w-full min-w-max border-collapse text-left text-sm"
        data-testid="mandi-table"
      >
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-3 py-2 font-semibold">
              {t('market:marketColumn')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {t('market:minColumn')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {t('market:modalColumn')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {t('market:maxColumn')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              {t('market:dateColumn')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.market} className="border-b border-line/60">
              <td className="px-3 py-2">
                {row.market}
                {row.adjusted && (
                  <span
                    className="ml-2 text-xs text-priority-medium"
                    title={t('market:priceAdjusted')}
                  >
                    ●
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatNumber(row.minPrice, language, { maximumFractionDigits: 0 })}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {formatNumber(row.modalPrice, language, { maximumFractionDigits: 0 })}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatNumber(row.maxPrice, language, { maximumFractionDigits: 0 })}
              </td>
              <td className="px-3 py-2 text-right">{formatDayMonth(row.date, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2">
        <FreshnessDot freshness={prices.freshness} />
        {rows.some((row) => row.adjusted) && (
          <span className="text-xs text-ink-500">{t('market:priceAdjusted')}</span>
        )}
      </div>
    </Card>
  );
}
