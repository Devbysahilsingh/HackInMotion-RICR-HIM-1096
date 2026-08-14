import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { yieldApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { useCropNames } from '@/hooks/useCropNames';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { IconChart } from '@/components/ui/icons';

/** Rows before the card defers to the full harvest screen. */
const MAX_ROWS = 3;

/**
 * The dashboard's harvest slot.
 *
 * ## What it shows, and what it refuses to
 *
 * A combined range across every crop that could be estimated, then the biggest
 * few individually. Crops with no government evidence are **counted, not
 * hidden**: a card that silently dropped them would imply the total covers the
 * whole farm when it does not. That count is the honest half of the summary and
 * it links through to the page that explains each one.
 *
 * The total is `null` rather than `0` when nothing could be estimated — a zero
 * would read as "you will harvest nothing", which is the opposite of "we do not
 * know". The API makes that distinction and this card preserves it.
 *
 * Every figure here is arithmetic over published district statistics. Nothing
 * on this card may be labelled a prediction or a forecast.
 */
export function DashboardYieldCard() {
  const { t } = useTranslation(['yield', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  const query = useQuery({
    queryKey: queryKeys.yield.summary(),
    queryFn: () => yieldApi.summary(),
    staleTime: STALE_TIME.slowMoving,
  });

  if (query.isPending) return <SkeletonCard />;

  const data = query.data;
  const totals = data?.totals ?? null;
  const num = (value: number) => formatNumber(value, language, { maximumFractionDigits: 0 });

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="kicker">{t('yield:dashboardTitle')}</span>
      <IconChart size={18} className="text-leaf-700" aria-hidden="true" />
    </div>
  );

  if (query.isError || !data || data.items.length === 0) {
    return (
      <Card className="flex h-full flex-col p-5" data-testid="dashboard-yield-empty">
        {header}
        <p className="mt-3 text-sm text-ink-500">{t('yield:dashboardEmpty')}</p>
        <ButtonLink to="/yield" variant="secondary" size="md" className="mt-auto pt-3">
          {t('yield:dashboardCta')}
        </ButtonLink>
      </Card>
    );
  }

  // Largest estimates first — the ones a farmer plans around.
  const rows = data.items
    .filter((item) => item.estimated && item.production)
    .sort((a, b) => (b.production?.midQuintals ?? 0) - (a.production?.midQuintals ?? 0))
    .slice(0, MAX_ROWS);

  return (
    <Card className="flex h-full flex-col p-5" data-testid="dashboard-yield">
      {header}

      {totals ? (
        <>
          <p
            className="mt-3 font-display text-3xl font-extrabold leading-none tracking-[-0.03em]"
            data-testid="dashboard-yield-total"
          >
            {t('yield:rangeLabel', {
              low: num(totals.lowQuintals),
              high: num(totals.highQuintals),
            })}
          </p>
          <p className="kicker mt-2">{t('yield:dashboardTotalLabel', { count: totals.crops })}</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-500">{t('yield:dashboardEmpty')}</p>
      )}

      {rows.length > 0 && (
        <ul className="mt-3">
          {rows.map((item) => (
            <li
              key={item.cropId}
              className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
            >
              <span className="min-w-0 truncate text-sm">{cropName(item.cropCode)}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {t('yield:rangeLabel', {
                  low: num(item.production!.lowQuintals ?? item.production!.midQuintals),
                  high: num(item.production!.highQuintals ?? item.production!.midQuintals),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Counted rather than dropped. Without this the total silently claims to
        cover crops it does not.
      */}
      {data.unavailableCount > 0 && (
        <p className="mt-3 text-xs text-ink-500" data-testid="dashboard-yield-unavailable">
          {t('yield:unavailableForCrop')} · {data.unavailableCount}
        </p>
      )}

      <ButtonLink to="/yield" variant="secondary" size="md" className="mt-auto pt-3">
        {t('yield:dashboardCta')}
      </ButtonLink>
    </Card>
  );
}
