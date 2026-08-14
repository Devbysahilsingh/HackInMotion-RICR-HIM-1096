import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { farmsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CropRecExclusion, FarmRecItem, FarmRecommendationsResponse } from '@/api/types';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState, Notice } from '@/components/ui/states';
import { IconChevronRight, IconPlus } from '@/components/ui/icons';
import { useCropNames } from '@/hooks/useCropNames';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { cn } from '@/lib/cn';
import { formatDayMonth, formatNumber, localizedName } from '@/lib/format';
import { suitabilityOf } from '@/lib/suitability';

/** Reasons shown on a card before it defers to the detail page. */
const REASONS_PER_CARD = 3;

/**
 * What to plant next on the field selected in the sidebar.
 *
 * ## What changed, and why it is an architecture change rather than a restyle
 *
 * This was a three-step wizard: pick a farm, pick a season, pick a preference,
 * then POST. Every one of those questions is one the system can answer itself —
 * the sidebar already names the field, the calendar already names the season —
 * and the ranking it produced could not see the field's free land, its standing
 * crops, or whether any mandi within reach would actually buy the crop it
 * suggested.
 *
 * The page now reads one farm-scoped endpoint whose pipeline is
 * *FarmContext → season → land → market eligibility → the pure engine*, and it
 * renders that result without computing anything. In particular it does **not**
 * compute a score: the detail page reads the same endpoint and selects a crop
 * out of the same ranking, so a card and the page it opens physically cannot
 * disagree about the number.
 *
 * ## No crop images here, deliberately
 *
 * A recommendation is a decision, not a catalogue. A photograph on these cards
 * would be a stock image of somebody else's field standing in for evidence
 * about this one — and beside a real market price and a real score it would
 * read as though it were part of the assessment.
 */
export default function CropRecommendationPage() {
  const { t } = useTranslation(['cropRec', 'farm', 'common']);
  const { activeFarmId, activeFarm, isLoading: farmsLoading } = useActiveFarm();
  const toMessage = useApiErrorMessage();

  const query = useQuery({
    queryKey: queryKeys.farms.recommendations(activeFarmId ?? '', undefined),
    queryFn: () => farmsApi.recommendations(activeFarmId!),
    enabled: Boolean(activeFarmId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (farmsLoading || (activeFarmId && query.isPending)) {
    return (
      <>
        <PageHeader title={t('cropRec:pageTitle')} />
        <SkeletonList count={3} />
      </>
    );
  }

  if (!activeFarmId) {
    return (
      <>
        <PageHeader title={t('cropRec:pageTitle')} />
        <EmptyState
          title={t('farm:listEmpty')}
          action={
            <ButtonLink to="/farms/new" leadingIcon={<IconPlus size={18} />}>
              {t('farm:listEmptyCta')}
            </ButtonLink>
          }
        />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title={t('cropRec:pageTitle')} />
        <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
      </>
    );
  }

  return (
    <RecommendationList data={query.data} farmName={activeFarm?.name ?? ''} farmId={activeFarmId} />
  );
}

function RecommendationList({
  data,
  farmName,
  farmId,
}: {
  data: FarmRecommendationsResponse;
  farmName: string;
  farmId: string;
}) {
  const { t } = useTranslation(['cropRec', 'agri', 'common']);
  const { language } = useLanguage();

  const { recommendations, season, land, marketContext } = data;

  /*
   * The context line, entirely derived. "Rabi 2026 · Kolar Road field" comes
   * from the season resolver and the sidebar; the free-land figure comes from
   * the land ledger. Nothing here is written into the page.
   */
  const contextLine = [
    t('cropRec:contextLine', {
      season: t(`agri:season.${season.applied}`),
      year: formatNumber(season.year, language, { useGrouping: false }),
      farm: farmName,
    }),
    t('cropRec:landLine', {
      available: formatNumber(land.availableAcres, language, { maximumFractionDigits: 1 }),
      total: formatNumber(land.totalAcres, language, { maximumFractionDigits: 1 }),
    }),
  ].join(' · ');

  return (
    <>
      <PageHeader title={t('cropRec:pageTitle')} description={contextLine} />

      <div className="space-y-5">
        <EvidenceBanner data={data} />

        {recommendations.length === 0 ? (
          <NoMarketState mandiCount={marketContext.mandiCount} />
        ) : (
          <>
            {/*
              Said plainly when the market thins the list. Better than showing
              two cards with no explanation of where the rest went.
            */}
            {recommendations.length < 3 && (
              <Notice tone="info" data-testid="rec-thin">
                {t('cropRec:onlyFewBody', { count: recommendations.length })}
              </Notice>
            )}

            <div className="grid items-stretch gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {recommendations.map((item) => (
                <RecommendationCard key={item.cropCode} item={item} farmId={farmId} />
              ))}
            </div>
          </>
        )}

        <NotRanked excluded={data.excluded} />
      </div>
    </>
  );
}

/**
 * How much of the intended evidence the ranking actually had.
 *
 * Written for a farmer, not for whoever wrote the engine: the old copy said
 * "the temperature-fit weight was removed and the rest renormalised", which is
 * true and unreadable. The factor names still appear — a farmer is entitled to
 * know *which* consideration was missing — but the sentence explains the
 * consequence rather than the arithmetic.
 */
function EvidenceBanner({ data }: { data: FarmRecommendationsResponse }) {
  const { t } = useTranslation(['cropRec', 'common']);

  const [lead] = data.recommendations;
  if (!lead) return null;

  // `evidenceRatio` is the share of the documented weight that was backed by
  // data. Four factors are documented, so this reports it as "n of 4".
  const total = 4;
  const used = Math.round(lead.evidenceRatio * total);

  return (
    <Card className="border-sky-700/20 bg-sky-tint p-5" data-testid="rec-evidence">
      <p className="text-sm leading-relaxed text-sky-700">
        {t('cropRec:evidenceExplained', { used, total })}
      </p>

      {data.limitations.length > 0 && (
        <ul className="mt-2.5 space-y-1 text-sm leading-relaxed text-sky-700/90">
          {data.limitations.map((limitation) => (
            <li key={limitation.key}>{translateMessageKey(t, limitation.key, limitation.data)}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One ranked crop.
 *
 * Information-first and in one order: what it is, how well it fits, why, what
 * it fetches nearby. The market block is never empty — a crop with no price
 * could not have reached this list.
 */
function RecommendationCard({ item, farmId }: { item: FarmRecItem; farmId: string }) {
  const { t } = useTranslation(['cropRec', 'agri', 'common', 'market']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  const names = item.names;
  const primary = localizedName(names, language)?.text ?? cropName(item.cropCode);
  const secondary = language === 'hi' ? names?.en : names?.hi;

  const band = suitabilityOf(item.score);

  return (
    <Card
      className="flex h-full flex-col p-5"
      data-testid="rec-card"
      data-crop-code={item.cropCode}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={band === 'HIGH' ? 'success' : band === 'MED' ? 'brand' : 'warning'}>
          {t(`cropRec:suitability${band}`)}
        </Badge>
        <span className="font-display text-[1.5rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
          {formatNumber(item.score, language, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>

      <h2 className="mt-3 text-[1.5rem] leading-tight">
        {primary}
        {secondary && (
          <span className="ml-2 font-sans text-base font-normal text-ink-500">{secondary}</span>
        )}
      </h2>

      {/* The strongest reasons the engine produced, in its own order. */}
      <ul className="mt-3 space-y-1.5">
        {item.reasons.slice(0, REASONS_PER_CARD).map((reason) => (
          <li key={reason.key} className="flex gap-2 text-sm leading-relaxed text-ink-700">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-leaf-500"
            />
            {translateMessageKey(t, reason.key, reason.data)}
          </li>
        ))}
      </ul>

      {item.market?.available && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="kicker">{t('cropRec:marketHeading')}</p>
          <p className="mt-1.5 font-display text-[1.25rem] font-extrabold leading-none tabular-nums">
            {t('common:unit.rupeesPerQuintal', {
              value: formatNumber(item.market.modalPrice ?? 0, language, {
                maximumFractionDigits: 0,
              }),
            })}
          </p>
          <p className="mt-1.5 text-xs text-ink-500">
            {t('cropRec:marketReportedAt', {
              mandi: item.market.mandi ?? '',
              date: item.market.reportedAt ? formatDayMonth(item.market.reportedAt, language) : '',
            })}
          </p>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="text-xs text-ink-500">
          {t('cropRec:evidenceLabel')}{' '}
          {formatNumber(item.evidenceRatio * 100, language, { maximumFractionDigits: 0 })}%
        </span>
        <Link
          to={`/crop-recommendation/${encodeURIComponent(item.cropCode)}?farmId=${farmId}`}
          className="inline-flex items-center gap-1 font-display text-sm font-semibold text-brand-600 hover:underline"
        >
          {t('cropRec:detailCta')}
          <IconChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

/** Nothing on the platform could be priced near this field. */
function NoMarketState({ mandiCount }: { mandiCount: number }) {
  const { t } = useTranslation(['cropRec', 'market', 'common']);

  return (
    <Card className="p-6 text-center" data-testid="rec-no-market">
      <h2 className="text-[1.25rem]">{t('cropRec:noMarketTitle')}</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm leading-relaxed text-ink-500">
        {t('cropRec:noMarketBody')}
      </p>
      <ButtonLink to="/market" variant="secondary" className="mt-4">
        {mandiCount > 0 ? t('market:viewNearbyCta') : t('market:pageTitle')}
      </ButtonLink>
    </Card>
  );
}

/**
 * Crops the platform carries but could not rank, with the engine's own reason.
 *
 * Transparency, and quiet by design — it explains an absence rather than
 * competing with the ranking. No score appears here: an excluded crop was never
 * scored, and printing one would imply it was in the running.
 */
function NotRanked({ excluded }: { excluded: CropRecExclusion[] }) {
  const { t } = useTranslation(['cropRec', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  if (excluded.length === 0) return null;

  return (
    <section
      className="rounded-card border border-dashed border-line-strong bg-canvas p-5"
      data-testid="rec-not-ranked"
    >
      <p className="kicker">{t('cropRec:excludedHeading')}</p>

      <ul className="mt-3 space-y-2">
        {excluded.slice(0, 8).map((entry) => (
          <li
            key={`${entry.cropCode}-${entry.reason}`}
            className={cn('flex flex-wrap items-baseline gap-x-2 text-sm text-ink-500')}
          >
            <span className="font-semibold text-ink-700">
              {localizedName(entry.names, language)?.text ?? cropName(entry.cropCode)}
            </span>
            {translateMessageKey(t, entry.reasonKey, entry.data)}
          </li>
        ))}
      </ul>
    </section>
  );
}
