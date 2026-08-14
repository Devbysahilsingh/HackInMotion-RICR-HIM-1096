import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { farmsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CropCard } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber, localizedName } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { IconCloud, IconDroplet } from '@/components/ui/icons';

const RISK_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'neutral',
};

/**
 * The dashboard's weather slot for the currently selected farm.
 *
 * `farms/:id/weather` is a DB-only read (`farmWeatherService.js` — "No
 * provider is called here"), so calling it from the dashboard page does not
 * break the "request paths never call an external provider" rule (CLAUDE.md
 * rule 3): the data behind it was already fetched by the scheduler.
 *
 * Three real tiers, not four invented ones — this system only ever knows
 * "weather for this farm's location" (there is no separate crop-specific
 * weather feed, and no district-level source distinct from the farm's own
 * cell), so the hierarchy is honest about what actually differs:
 *   1. weather + which of the farm's crops have a flagged risk
 *   2. weather + the farm's crops and their stage (no risk today)
 *   3. weather only (farm carries no active crops)
 *   4. unavailable — never fetched, or the farm has no coordinates
 */
export function DashboardWeatherCard({
  farmId,
  location,
  crops,
}: {
  farmId: string;
  location: string;
  crops: CropCard[];
}) {
  const { t } = useTranslation(['weather', 'common', 'agri', 'crop']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.farms.weather(farmId),
    queryFn: () => farmsApi.weather(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (query.isPending) return <SkeletonCard />;

  if (query.isError || !query.data) {
    return (
      <Card className="p-5" data-testid="dashboard-weather-error">
        <div className="flex items-center justify-between gap-2">
          <span className="kicker">{t('weather:pageTitle')}</span>
          <IconCloud size={18} className="text-sky-700" />
        </div>
        <p className="mt-3 text-sm text-ink-700">{t('weather:unavailableTitle')}</p>
        <Button
          variant="secondary"
          size="md"
          className="mt-3"
          onClick={() => void query.refetch()}
        >
          {t('common:action.refresh')}
        </Button>
      </Card>
    );
  }

  const { daily, risks, freshness } = query.data;

  if (daily.length === 0) {
    return (
      <Card className="p-5" data-testid="dashboard-weather-unavailable">
        <div className="flex items-center justify-between gap-2">
          <span className="kicker">{t('weather:pageTitle')}</span>
          <IconCloud size={18} className="text-sky-700" />
        </div>
        <p className="mt-3 text-sm font-semibold text-ink-900">{t('weather:unavailableTitle')}</p>
        <p className="mt-1 text-sm text-ink-500">
          {freshness.reason === 'no_coordinates'
            ? t('weather:pendingNoCoordinates')
            : t('weather:pendingBody')}
        </p>
        <Button
          variant="secondary"
          size="md"
          className="mt-3"
          onClick={() => void query.refetch()}
        >
          {t('common:action.refresh')}
        </Button>
      </Card>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayRow = daily.find((day) => new Date(day.date) >= today) ?? daily[daily.length - 1]!;

  const riskyCropIds = new Set(risks.map((risk) => risk.cropId));
  const contextCrops = crops.filter((card) => risks.length === 0 || riskyCropIds.has(card.cropId));

  return (
    <Card className="p-5" data-testid="dashboard-weather">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{t('weather:pageTitle')}</span>
        <IconCloud size={18} className="text-sky-700" />
      </div>

      <p className="mt-3.5 font-display text-[2.75rem] font-extrabold leading-none tracking-[-0.04em]">
        {todayRow.tMinC != null && todayRow.tMaxC != null
          ? t('weather:tempRange', {
              min: formatNumber(todayRow.tMinC, language, { maximumFractionDigits: 0 }),
              max: formatNumber(todayRow.tMaxC, language, { maximumFractionDigits: 0 }),
            })
          : '—'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
        {todayRow.humidityPct != null && (
          <span>
            {t('weather:humidity')}{' '}
            {formatNumber(todayRow.humidityPct, language, { maximumFractionDigits: 0 })}%
          </span>
        )}
        {todayRow.rainProbPct != null && (
          <span className="inline-flex items-center gap-1">
            <IconDroplet size={13} aria-hidden="true" />
            {formatNumber(todayRow.rainProbPct, language, { maximumFractionDigits: 0 })}%
          </span>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
        <span>{t('weather:locationCaption', { location })}</span>
        <FreshnessDot freshness={freshness} />
      </div>

      {contextCrops.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="kicker">{t('weather:cropContextHeading')}</p>
          <ul className="mt-2 space-y-1.5">
            {contextCrops.slice(0, 4).map((card) => {
              const name = localizedName(card.names, language)?.text ?? card.cropCode;
              const risk = risks.find((r) => r.cropId === card.cropId);

              return (
                <li key={card.cropId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-ink-700">{name}</span>
                  {risk ? (
                    <Badge tone={RISK_TONE[risk.level] ?? 'neutral'}>
                      {t(`weather:title${risk.type}`)}
                    </Badge>
                  ) : card.stage ? (
                    <span className="text-ink-500">{t(`agri:stage.${card.stage}`)}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
