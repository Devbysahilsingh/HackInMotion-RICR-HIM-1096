import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { cropsApi, yieldApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { YieldSummaryItem } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { YieldEstimateView } from '@/components/domain/YieldEstimateView';
import { PageHeader } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/Stat';
import { SkeletonCard, SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconChart, IconInfo } from '@/components/ui/icons';
import { useCropNames } from '@/hooks/useCropNames';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The harvest-estimate screen.
 *
 * ## Why this is one page with a crop selector rather than a list of cards
 *
 * The estimate is not a number to skim — it is a chain of evidence, and the
 * whole product claim rests on that chain being inspectable. Rendering six
 * crops as six summary cards would hide the ladder, the years, the source and
 * the limitations behind six more taps. So the page shows the farm total, lets
 * the farmer pick a crop, and then shows that crop's estimate *in full*.
 *
 * ## Crops with no evidence are first-class here
 *
 * They appear in the selector, they are reachable, and selecting one shows a
 * designed explanation of why there is no number. Cotton and tomato land there
 * permanently and by decision; a farmer who grows them should find a straight
 * answer rather than an absence.
 *
 * Nothing on this page is a prediction. Every figure is arithmetic over
 * published Government of India district statistics, and the wording is fixed
 * in the `yield` namespace so a translation cannot quietly upgrade it into one.
 */
export default function YieldPage() {
  const { t } = useTranslation(['yield', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: queryKeys.yield.summary(),
    queryFn: () => yieldApi.summary(),
    staleTime: STALE_TIME.slowMoving,
  });

  const items = summary.data?.items ?? [];
  const selected = items.find((item) => item.cropId === selectedId) ?? items[0] ?? null;

  /*
   * The detail for whichever crop is selected. Keyed under `crops` beside
   * `fertilizer`, so editing a crop's area invalidates its estimate with
   * everything else about that crop rather than leaving a stale harvest figure
   * on screen.
   */
  const detail = useQuery({
    queryKey: queryKeys.crops.yieldEstimate(selected?.cropId ?? ''),
    queryFn: () => cropsApi.yieldEstimate(selected!.cropId),
    enabled: Boolean(selected),
    staleTime: STALE_TIME.slowMoving,
  });

  const num = (value: number) => formatNumber(value, language, { maximumFractionDigits: 0 });

  return (
    <>
      <PageHeader
        title={t('yield:pageTitle')}
        kicker={t('yield:dashboardTitle')}
        description={t('yield:pageSubtitle')}
      />

      <QueryBoundary
        query={summary}
        loading={<SkeletonList count={2} />}
        loadingLabel={t('yield:pageTitle')}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={<IconChart size={22} />}
            title={t('yield:dashboardEmpty')}
            body={t('yield:insufficientBody')}
          />
        }
      >
        {(data) => (
          <div className="space-y-5">
            {/* ── Farm total ─────────────────────────────────────────── */}
            <Card className="p-5" data-testid="yield-farm-total">
              <span className="kicker">{t('yield:dashboardTitle')}</span>

              {data.totals ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <StatTile
                    label={t('yield:dashboardTotalLabel', { count: data.totals.crops })}
                    value={t('yield:rangeLabel', {
                      low: num(data.totals.lowQuintals),
                      high: num(data.totals.highQuintals),
                    })}
                    hint={t('yield:rangeTypicalYearToYear')}
                  />
                  <StatTile
                    label={t('yield:estimateHeading')}
                    value={t('common:unit.quintal', { value: num(data.totals.midQuintals) })}
                    tone="quiet"
                  />
                  <StatTile
                    label={t('yield:unavailableForCrop')}
                    value={String(data.unavailableCount)}
                    tone="quiet"
                  />
                </div>
              ) : (
                /*
                 * Null totals, never zero. "0 quintal" reads as a prediction of
                 * total crop failure; the API distinguishes "nothing to add up"
                 * from "adds up to nothing" and this preserves it.
                 */
                <Notice tone="info" className="mt-3" icon={<IconInfo size={16} />}>
                  {t('yield:dashboardEmpty')}
                </Notice>
              )}
            </Card>

            {/* ── Crop selector ──────────────────────────────────────── */}
            {data.items.length > 1 && (
              <div
                className="flex flex-wrap gap-2"
                role="tablist"
                aria-label={t('yield:pageTitle')}
                data-testid="yield-crop-selector"
              >
                {data.items.map((item) => (
                  <CropChip
                    key={item.cropId}
                    item={item}
                    label={cropName(item.cropCode)}
                    selected={item.cropId === selected?.cropId}
                    onSelect={() => setSelectedId(item.cropId)}
                  />
                ))}
              </div>
            )}

            {/* ── The selected crop, in full ─────────────────────────── */}
            {selected && detail.isPending && <SkeletonCard />}
            {detail.data && selected && (
              <YieldEstimateView estimate={detail.data} cropName={cropName(selected.cropCode)} />
            )}

            <p className="px-1 text-xs text-ink-500">{t('yield:notAPrediction')}</p>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

/**
 * One crop in the selector.
 *
 * A crop with no evidence is dimmed but never disabled — it is selectable, and
 * selecting it is how a farmer finds out *why* there is no estimate. Removing
 * it from the list would make the absence unexplainable.
 */
function CropChip({
  item,
  label,
  selected,
  onSelect,
}: {
  item: YieldSummaryItem;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('yield');

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors',
        selected
          ? 'border-leaf-900 bg-leaf-900 text-white'
          : 'border-line bg-surface text-ink-700 hover:border-line-strong',
      )}
      data-testid={`yield-chip-${item.cropCode}`}
      data-estimated={item.estimated}
    >
      {label}
      {!item.estimated && (
        <span
          className={cn('ml-2 text-xs font-normal', selected ? 'text-white/70' : 'text-ink-500')}
        >
          {t('unavailableForCrop')}
        </span>
      )}
    </button>
  );
}
