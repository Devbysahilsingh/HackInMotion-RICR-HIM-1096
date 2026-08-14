import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';

import { farmsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CropRecItem, FarmRecDetailResponse, RecMarketEvidence } from '@/api/types';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonList } from '@/components/ui/Skeleton';
import { ErrorState, Notice } from '@/components/ui/states';
import { useCropNames } from '@/hooks/useCropNames';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { cn } from '@/lib/cn';
import { formatDayMonth, formatNumber, localizedName } from '@/lib/format';
import { suitabilityOf } from '@/lib/suitability';

/** The engine's four documented factors, in the order the docs list them. */
const FACTOR_ORDER = ['soil', 'season', 'water', 'temp'] as const;
type FactorName = (typeof FACTOR_ORDER)[number];

const FACTOR_LABEL_KEY: Record<FactorName, string> = {
  soil: 'cropRec:soilSuitable',
  season: 'cropRec:seasonMatch',
  water: 'cropRec:waterOk',
  temp: 'cropRec:tempOk',
};

/**
 * One recommended crop, in full.
 *
 * ## One ranking, two screens
 *
 * This reads `GET /farms/:id/recommendations/:cropCode`, which re-runs the
 * identical pipeline the list ran and *selects* a crop out of its result. It
 * does not score anything. That is the whole point of the endpoint: before it,
 * a detail page re-ran the wizard with its own inputs and could legitimately
 * show 0.81 for the crop whose card said 0.86 — the class of bug that makes a
 * farmer stop trusting the number.
 *
 * The crop is identified by its canonical code in the path, never by a name
 * string, so tapping Wheat can only ever open Wheat.
 *
 * ## No crop imagery
 *
 * The design reference opens this page with a full-bleed wheat photograph. It
 * is not reproduced: the picture would be a stock image of somebody else's
 * field placed above this field's score, water figure and mandi price, and at
 * that size it reads as part of the evidence. The header carries the verdict
 * instead.
 */
export default function CropRecDetailPage() {
  const { t } = useTranslation(['cropRec', 'agri', 'common']);
  const { cropCode = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { activeFarmId } = useActiveFarm();
  const toMessage = useApiErrorMessage();

  /*
   * The card passes the farm it was ranked for. Falling back to the sidebar's
   * selection keeps a pasted link working, and pinning it to the query
   * parameter means a link shared between screens cannot silently re-rank
   * against a different field.
   */
  const farmId = searchParams.get('farmId') ?? activeFarmId;

  const query = useQuery({
    queryKey: [...queryKeys.farms.recommendations(farmId ?? '', undefined), cropCode],
    queryFn: () => farmsApi.recommendation(farmId!, cropCode),
    enabled: Boolean(farmId) && Boolean(cropCode),
    staleTime: STALE_TIME.slowMoving,
  });

  if (query.isPending) {
    return (
      <>
        <PageHeader title={t('cropRec:pageTitle')} />
        <SkeletonList count={3} />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title={t('cropRec:pageTitle')} />
        <ErrorState
          title={t('cropRec:detailMissing')}
          message={toMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  return <Detail data={query.data} farmId={farmId!} />;
}

function Detail({ data, farmId }: { data: FarmRecDetailResponse; farmId: string }) {
  const { t } = useTranslation(['cropRec', 'agri', 'common', 'farm']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  const item = data.recommendation;
  const excluded = data.excludedEntry;

  const code = item?.cropCode ?? excluded?.cropCode ?? '';
  const names = item?.names ?? excluded?.names ?? null;
  const primary = localizedName(names, language)?.text ?? cropName(code);
  const secondary = language === 'hi' ? names?.en : names?.hi;

  const contextLine = [
    t('cropRec:contextLine', {
      season: t(`agri:season.${data.season.applied}`),
      year: formatNumber(data.season.year, language, { useGrouping: false }),
      farm: data.farm.name,
    }),
    t('cropRec:landLine', {
      available: formatNumber(data.land.availableAcres, language, { maximumFractionDigits: 1 }),
      total: formatNumber(data.land.totalAcres, language, { maximumFractionDigits: 1 }),
    }),
  ].join(' · ');

  /*
   * A crop the ranking excluded still has a page — it is the honest answer to
   * "why can I not see this one?" — but it carries the reason, not a score.
   */
  if (!item) {
    return (
      <>
        <PageHeader title={primary} kicker={t('cropRec:pageTitle')} description={contextLine} />
        <Card className="p-6" data-testid="rec-detail-excluded">
          <Badge tone="warning">{t('cropRec:excludedHeading')}</Badge>
          <p className="mt-3 text-base leading-relaxed text-ink-700">
            {translateMessageKey(t, excluded!.reasonKey, excluded!.data)}
          </p>
          <p className="mt-2 text-sm text-ink-500">{t('cropRec:notRankedBody')}</p>
          <ButtonLink to="/crop-recommendation" variant="secondary" className="mt-4">
            {t('cropRec:pageTitle')}
          </ButtonLink>
        </Card>
      </>
    );
  }

  const band = suitabilityOf(item.score);

  return (
    <>
      <PageHeader
        title={primary}
        kicker={t('cropRec:pageTitle')}
        description={contextLine}
        actions={
          <Badge tone={band === 'HIGH' ? 'success' : band === 'MED' ? 'brand' : 'warning'}>
            {t(`cropRec:suitability${band}`)} ·{' '}
            {formatNumber(item.score, language, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </Badge>
        }
      >
        {secondary && <p className="text-base text-ink-500">{secondary}</p>}
      </PageHeader>

      <div className="grid items-start gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-5">
          <ScoreBuild item={item} />
          <WhyThisCrop item={item} cropLabel={primary} />
        </div>

        <div className="flex flex-col gap-5">
          <MarketContext market={item.market} />
          <WaterNeeded item={item} />

          <Card className="p-5">
            {/*
              Straight into the existing crop form for the field this ranking
              was built for, with the crop pre-selected. It is the same create
              flow used everywhere else — the land ledger, the sowing-date
              bounds and the ownership checks all still apply.
            */}
            <ButtonLink
              to={`/farms/${farmId}/crops/new?cropCode=${encodeURIComponent(code)}`}
              fullWidth
            >
              {t('cropRec:addToFarmCta', { crop: primary })}
            </ButtonLink>
            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              {t('cropRec:landLine', {
                available: formatNumber(data.land.availableAcres, language, {
                  maximumFractionDigits: 1,
                }),
                total: formatNumber(data.land.totalAcres, language, { maximumFractionDigits: 1 }),
              })}
            </p>
          </Card>
        </div>
      </div>

      {item.cautions.length > 0 && (
        <div className="mt-5 space-y-2" data-testid="rec-cautions">
          {item.cautions.map((caution) => (
            <Notice key={caution.key} tone="info">
              {translateMessageKey(t, caution.key, caution.data)}
            </Notice>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * How the score was built, factor by factor.
 *
 * Every bar is the engine's own sub-score. A factor with no evidence renders as
 * "not scored" with an empty track rather than a zero-length bar next to a
 * number — the difference between "we do not know" and "this crop scores zero
 * here" is the whole reason the engine reports evidence separately.
 */
function ScoreBuild({ item }: { item: CropRecItem }) {
  const { t } = useTranslation(['cropRec', 'common']);
  const { language } = useLanguage();

  const factors = item.factors as Record<string, { score: number | null; evidence: string }>;

  return (
    <Card className="p-5" data-testid="rec-score-build">
      <p className="kicker">{t('cropRec:scoreBuildHeading')}</p>

      <ul className="mt-4 space-y-4">
        {FACTOR_ORDER.map((name) => {
          const factor = factors[name];
          if (!factor) return null;

          const scored = factor.evidence === 'SOURCED' && typeof factor.score === 'number';

          return (
            <li key={name}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span
                  className={cn('text-sm font-semibold', !scored && 'font-normal text-ink-400')}
                >
                  {t(FACTOR_LABEL_KEY[name])}
                </span>
                <span
                  className={cn(
                    'text-sm font-semibold tabular-nums',
                    !scored && 'font-normal text-ink-400',
                  )}
                >
                  {scored
                    ? formatNumber(factor.score!, language, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : t('cropRec:notScored')}
                </span>
              </div>

              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
                {scored && (
                  <div
                    className="h-full rounded-full bg-brand-600"
                    style={{ width: `${factor.score! * 100}%` }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-ink-500">
        {t('cropRec:evidenceLabel')}{' '}
        {formatNumber(item.evidenceRatio * 100, language, { maximumFractionDigits: 0 })}%
      </p>
    </Card>
  );
}

/** The engine's reasons, in full — the card showed only the first three. */
function WhyThisCrop({ item, cropLabel }: { item: CropRecItem; cropLabel: string }) {
  const { t } = useTranslation(['cropRec', 'common']);

  if (item.reasons.length === 0) return null;

  return (
    <Card className="p-5" data-testid="rec-reasons">
      <p className="kicker">{t('cropRec:reasonsWhy', { crop: cropLabel })}</p>
      <ul className="mt-3 space-y-2">
        {item.reasons.map((reason) => (
          <li key={reason.key} className="flex gap-2.5 text-sm leading-relaxed text-ink-700">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-leaf-500"
            />
            {translateMessageKey(t, reason.key, reason.data)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * What the crop is fetching nearby.
 *
 * Present on every ranked crop by construction — market availability is the
 * eligibility gate — so this card has no empty state. The disclaimer is
 * mandatory: a past mandi price is planning context, and NFR-7 forbids
 * presenting it as anything that looks forward.
 */
function MarketContext({ market }: { market: RecMarketEvidence | null }) {
  const { t } = useTranslation(['cropRec', 'common']);
  const { language } = useLanguage();

  if (!market?.available) return null;

  const rupees = (value: number) =>
    t('common:unit.rupeesPerQuintal', {
      value: formatNumber(value, language, { maximumFractionDigits: 0 }),
    });

  return (
    <Card className="p-5" data-testid="rec-market">
      <p className="kicker">{t('cropRec:marketHeading')}</p>

      <p className="mt-2.5 font-display text-[2rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums">
        {rupees(market.modalPrice ?? 0)}
      </p>

      <p className="mt-2 text-sm text-ink-500">
        {t('cropRec:marketReportedAt', {
          mandi: market.mandi ?? '',
          date: market.reportedAt ? formatDayMonth(market.reportedAt, language) : '',
        })}
      </p>

      {market.minPrice != null && market.maxPrice != null && (
        <p className="mt-1 text-sm text-ink-500">
          {t('cropRec:rangeLabel', {
            min: formatNumber(market.minPrice, language, { maximumFractionDigits: 0 }),
            max: formatNumber(market.maxPrice, language, { maximumFractionDigits: 0 }),
          })}
        </p>
      )}

      {market.band && (
        <Badge className="mt-3" tone={market.band === 'FRESH' ? 'success' : 'neutral'}>
          {t(`cropRec:band${market.band}`, { days: market.ageDays ?? 0 })}
        </Badge>
      )}

      <p className="mt-3 text-xs leading-relaxed text-ink-500">{t('cropRec:marketNotForecast')}</p>
    </Card>
  );
}

/**
 * The crop's published seasonal water need, and nothing more.
 *
 * The design's "4–5 waterings" is a count this system cannot produce: it would
 * need the field's soil reservoir *and* an irrigation depth per event, and only
 * the first exists. The registry publishes `waterNeedMm` as a FAO range, so
 * that is what is shown — with the field's own water source beside it, which is
 * the fact that decides whether the range is reachable.
 */
function WaterNeeded({ item }: { item: CropRecItem }) {
  const { t } = useTranslation(['cropRec', 'agri', 'common']);
  const { language } = useLanguage();

  const water = (item.factors as Record<string, { needMm?: number[]; irrigationMethod?: string }>)
    .water;
  const need = Array.isArray(water?.needMm) ? water.needMm : null;

  return (
    <Card className="border-leaf-500/30 bg-leaf-tint/50 p-5" data-testid="rec-water">
      <p className="kicker text-leaf-700">{t('cropRec:waterHeading')}</p>

      {need && need.length === 2 ? (
        <p className="mt-2.5 font-display text-[1.5rem] font-extrabold leading-none tracking-[-0.03em]">
          {t('cropRec:waterNeedRange', {
            min: formatNumber(need[0]!, language, { maximumFractionDigits: 0 }),
            max: formatNumber(need[1]!, language, { maximumFractionDigits: 0 }),
          })}
        </p>
      ) : (
        <p className="mt-2.5 text-sm leading-relaxed text-ink-700">{t('cropRec:waterUnknown')}</p>
      )}

      {water?.irrigationMethod && (
        <p className="mt-2 text-sm text-ink-700">
          {t(`agri:irrigationMethod.${water.irrigationMethod}`)}
        </p>
      )}
    </Card>
  );
}
