import { useTranslation } from 'react-i18next';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { cropsApi, dashboardApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CropCard, IrrigationAdvice, IrrigationLogEntry } from '@/api/types';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { IrrigationWorking } from '@/components/domain/IrrigationWorking';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SkeletonCard, SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/states';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { cn } from '@/lib/cn';
import { byUrgency } from '@/lib/irrigationUrgency';
import { formatDayMonth, formatNumber, localizedName } from '@/lib/format';

/**
 * The selected field's watering, on one page.
 *
 * The design gives irrigation its own screen because "should I water?" is asked
 * about the field, not about one crop: the verdict is set at display scale, the
 * crops sit underneath as gauges, and the FAO-56 working is laid out beside the
 * ledger — visible, not folded behind a "why this?" that nobody opens.
 *
 * ## Where the data comes from
 *
 * There is no farm-level irrigation endpoint, and inventing an aggregate verdict
 * here would mean this page deciding agronomy — which belongs to the engine
 * (rule 5). So the page does three honest things instead:
 *
 *   1. `/dashboard` supplies the crop list and each crop's verdict in **one**
 *      request, which is what it is contracted for. It is narrowed to the farm
 *      selected in the sidebar, in memory.
 *   2. Each card fetches that crop's own advice for the numbers behind its
 *      gauge. One request per crop, on a page a farmer opened deliberately.
 *   3. The recent-water list merges the farm's own crop ledgers client-side —
 *      there is no farm-scoped ledger route, and adding one for a read the
 *      client can compose would be a new endpoint without an FR behind it.
 *
 * The headline is not composed: it is the engine's own verdict for the crop that
 * needs water soonest, rendered from that crop's `irrigation.title*` key. This
 * page ranks; it never writes agronomic prose.
 */
export default function IrrigationPlanPage() {
  const { t } = useTranslation(['irrigation', 'common', 'farm']);
  const { activeFarmId, activeFarm, isLoading: farmsLoading } = useActiveFarm();

  const query = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  if (query.isPending || farmsLoading) {
    return (
      <>
        <PageHeader title={t('irrigation:planTitle')} kicker={t('irrigation:planScope')} />
        <SkeletonList count={3} />
      </>
    );
  }

  /*
   * Farm-scoped, like every other farm-dependent screen: a verdict for farm A's
   * soybean must never appear while the sidebar names farm B. `/dashboard`
   * itself stays account-wide (rule 3) — the split happens here, over the
   * `farmId` every crop card already carries.
   */
  const cards = byUrgency(
    (query.data?.cropCards ?? []).filter((card) => card.farmId === activeFarmId),
  );
  const lead = cards[0];

  return (
    <>
      <PageHeader
        title={t('irrigation:planTitle')}
        kicker={t('irrigation:planScope')}
        description={
          activeFarm
            ? [activeFarm.name, activeFarm.location.district].filter(Boolean).join(' · ')
            : undefined
        }
      />

      {!lead ? (
        <EmptyState title={t('irrigation:noCrops')} />
      ) : (
        <div className="space-y-5">
          <LeadVerdict card={lead} farmName={activeFarm?.name ?? ''} cropCount={cards.length} />

          {/*
            Gauges and insight tiles share one grid.

            A field with a single crop used to draw one card into a
            three-column row and leave two thirds of the page blank. The
            insights are not filler for that hole — they are figures a farmer
            asked for anyway (how much rain is coming, when to look again, how
            much water this field has had) — but putting them in the *same*
            grid is what guarantees the row is always complete, at any crop
            count, without a per-count layout rule.
          */}
          <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <CropGauge key={card.cropId} card={card} />
            ))}
            <FieldInsights cards={cards} leadCropId={lead.cropId} />
          </div>

          <div className="grid items-stretch gap-5 xl:grid-cols-[1.5fr_1fr]">
            <LeadWorking cropId={lead.cropId} />
            <RecentWater cards={cards} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The page's headline: the most urgent crop's verdict, set at the design's
 * display scale on the forest band, with the two figures a farmer checks it
 * against inset beside it.
 */
function LeadVerdict({
  card,
  farmName,
  cropCount,
}: {
  card: CropCard;
  farmName: string;
  cropCount: number;
}) {
  const { t } = useTranslation(['irrigation', 'common', 'weather', 'farm']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.crops.irrigation(card.cropId),
    queryFn: () => cropsApi.irrigation(card.cropId),
    staleTime: STALE_TIME.slowMoving,
  });

  const name = localizedName(card.names, language)?.text ?? card.cropCode;

  return (
    <section className="furrow overflow-hidden rounded-[18px] bg-brand-600 text-white">
      <div className="px-5 py-7 sm:px-8">
        {query.isPending ? (
          <SkeletonCard />
        ) : !query.data ? (
          <>
            <p className="kicker text-leaf-tint/80">{t('irrigation:pageTitle')}</p>
            <h2 className="mt-3 text-[2rem] leading-tight text-white">
              {t('irrigation:noDecisionTitle')}
            </h2>
            <p className="mt-3 max-w-[44ch] text-brand-100">{t('irrigation:noDecisionBody')}</p>
          </>
        ) : (
          <LeadBody
            advice={query.data}
            card={card}
            name={name}
            farmName={farmName}
            cropCount={cropCount}
          />
        )}
      </div>

      <div className="strata" aria-hidden="true">
        <i className="bg-leaf-500" />
        <i className="bg-harvest-500" />
        <i className="bg-earth-600" />
        <i className="bg-earth-800" />
      </div>
    </section>
  );
}

function LeadBody({
  advice,
  card,
  name,
  farmName,
  cropCount,
}: {
  advice: IrrigationAdvice;
  card: CropCard;
  name: string;
  farmName: string;
  cropCount: number;
}) {
  const { t } = useTranslation(['irrigation', 'common', 'weather', 'farm']);
  const { language } = useLanguage();

  const verdict = advice.verdict ?? 'UNAVAILABLE';
  const params = {
    ...advice,
    days: advice.days ?? 0,
    amountMm: advice.amountMm ?? 0,
    amountLitersPerAcre: advice.amountLitersPerAcre ?? 0,
    rainMm: advice.rain?.mm ?? 0,
    date: advice.rain?.date ? formatDayMonth(advice.rain.date, language) : '',
  };

  return (
    <div className="grid items-start gap-7 lg:grid-cols-[1.35fr_1fr]">
      <div>
        <p className="kicker text-leaf-tint/80">
          {[t('irrigation:pageTitle'), farmName, name].filter(Boolean).join(' · ')}
        </p>

        {/*
          The design's 64px verdict. It steps down hard on a phone — a
          translated verdict can be several words, and at 64px on 390px it
          would wrap to four lines.
        */}
        <h2 className="mt-3 max-w-[16ch] text-[2rem] leading-[1.02] tracking-[-0.045em] text-white sm:text-[2.75rem] lg:text-[3.5rem]">
          {translateMessageKey(t, `irrigation.title${verdict}`, params)}
        </h2>

        <p className="mt-3 max-w-[46ch] leading-relaxed text-brand-100">
          {translateMessageKey(t, `irrigation.body${verdict}`, params)}
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink to={`/crops/${card.cropId}?tab=irrigation`} variant="onDark" size="md">
            {t('irrigation:logWaterAnyway')}
          </ButtonLink>
          <ButtonLink to={`/farms/${card.farmId}/weather`} variant="onDarkOutline" size="md">
            {t('irrigation:seeForecast')}
          </ButtonLink>
        </div>
      </div>

      {/*
        The design's two stat insets. Each is rendered only when the engine
        actually returned it — a blank inset is better than a confident zero.
      */}
      <div className="flex flex-col gap-3">
        {advice.rain && (
          <StatInset
            label={t('irrigation:rainExpectedLabel')}
            value={`${formatNumber(advice.rain.probPct, language, { maximumFractionDigits: 0 })}%`}
          />
        )}
        {advice.nextCheckDays != null && (
          <StatInset
            label={t('irrigation:nextReviewHeading')}
            value={formatDayMonth(
              new Date(Date.now() + advice.nextCheckDays * 86_400_000),
              language,
            )}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/20 px-4 py-3">
          <FreshnessDot freshness={advice.freshness} className="text-white/75" />
          <span className="text-xs text-white/60">
            {t('farm:cropsHeading')} · {formatNumber(cropCount, language)}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatInset({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/20 px-4 py-3.5">
      <p className="kicker text-leaf-tint/80">{label}</p>
      <p className="mt-1 font-display text-[1.75rem] font-extrabold leading-none text-white">
        {value}
      </p>
    </div>
  );
}

/**
 * One crop's water balance as a gauge: how far the soil has dried against the
 * depth at which the engine says to water.
 *
 * The bar is drawn only when both numbers are present. `depletionMm` and
 * `rawMm` are optional on the advice — a crop that is not in the ground has
 * neither — and a gauge with a guessed denominator would be a fabricated
 * measurement rather than a missing one. That case prints the engine's own
 * reason instead, which is the whole answer for an unsown crop.
 */
function CropGauge({ card }: { card: CropCard }) {
  const { t } = useTranslation(['irrigation', 'common', 'agri']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.crops.irrigation(card.cropId),
    queryFn: () => cropsApi.irrigation(card.cropId),
    staleTime: STALE_TIME.slowMoving,
  });

  const name = localizedName(card.names, language)?.text ?? card.cropCode;
  const area =
    card.areaValue != null && card.areaUnit
      ? `${formatNumber(card.areaValue, language)} ${t(`common:unit.${card.areaUnit}`)}`
      : null;

  const verdict = card.irrigationVerdict;

  return (
    <Card
      className="flex h-full flex-col p-5"
      data-testid="irrigation-gauge"
      data-crop-code={card.cropCode}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={`/crops/${card.cropId}?tab=irrigation`}
          className="text-[1.0625rem] font-semibold hover:underline"
        >
          {name}
          {area && <span className="font-normal text-ink-500"> · {area}</span>}
        </Link>
        {verdict && (
          <Badge
            tone={
              verdict === 'IRRIGATE_TODAY'
                ? 'danger'
                : verdict === 'IRRIGATE_IN_N_DAYS'
                  ? 'warning'
                  : 'success'
            }
          >
            {t(`irrigation:title${verdict}`, { days: 0, defaultValue: verdict })}
          </Badge>
        )}
      </div>

      {query.isPending ? (
        <SkeletonCard />
      ) : query.data ? (
        <Gauge advice={query.data} />
      ) : (
        <p className="mt-3 text-sm text-ink-500">{t('irrigation:noDecisionBody')}</p>
      )}
    </Card>
  );
}

function Gauge({ advice }: { advice: IrrigationAdvice }) {
  const { t } = useTranslation(['irrigation', 'common']);
  const { language } = useLanguage();
  const { depletionMm, rawMm } = advice;

  if (depletionMm == null || rawMm == null || rawMm <= 0) {
    return (
      <p className="mt-3 text-sm text-ink-500" data-testid="irrigation-gauge-reason">
        {t(`irrigation:reason${advice.reasonCode}`, { defaultValue: '' })}
      </p>
    );
  }

  // Clamped so a deficit past the trigger fills the bar rather than overflowing
  // it; the numbers underneath still report the true figures.
  const filled = Math.min(100, (depletionMm / rawMm) * 100);
  const past = depletionMm >= rawMm;

  return (
    <>
      {/* `mt-auto` pins the bar to the bottom, so a crop whose name wraps to
          two lines still lines its gauge up with the card beside it. */}
      <div
        className="relative mt-auto h-[26px] overflow-hidden rounded-lg bg-mute pt-0"
        role="meter"
        aria-valuenow={Math.round(filled)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('irrigation:deficitLabel', {
          value: formatNumber(depletionMm, language, { maximumFractionDigits: 0 }),
        })}
      >
        <div
          className={cn('absolute inset-y-0 left-0', past ? 'wxbar-mild' : 'wxbar-rain')}
          style={{ width: `${filled}%` }}
        />
        {/* The trigger line — where the engine says to water. */}
        <div className="absolute inset-y-0 right-0 w-0.5 bg-brand-600" />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 text-[0.719rem] font-medium text-ink-500">
        <span>
          {t('irrigation:deficitLabel', {
            value: formatNumber(depletionMm, language, { maximumFractionDigits: 0 }),
          })}
        </span>
        <span className="ml-auto">
          {t('irrigation:triggerLabel', {
            value: formatNumber(rawMm, language, { maximumFractionDigits: 0 }),
          })}
        </span>
      </div>
    </>
  );
}

/**
 * The field's watering figures, as tiles beside the crop gauges.
 *
 * Every one is a number this system already holds — the engine's rain
 * probability and next-review interval, the farm's own soil reservoir from the
 * `SOIL` trace step, and the sum of what the farmer has actually logged. None
 * is modelled or projected here.
 *
 * They are rendered as a fragment rather than a wrapper so they become direct
 * children of the gauge grid: that is what lets one crop plus three tiles
 * complete a three-column row instead of leaving it two thirds empty.
 */
function FieldInsights({ cards, leadCropId }: { cards: readonly CropCard[]; leadCropId: string }) {
  const { t } = useTranslation(['irrigation', 'weather', 'agri', 'common', 'farm']);
  const { language } = useLanguage();

  const adviceQuery = useQuery({
    queryKey: queryKeys.crops.irrigation(leadCropId),
    queryFn: () => cropsApi.irrigation(leadCropId),
    staleTime: STALE_TIME.slowMoving,
  });

  const ledgers = useQueries({
    queries: cards.map((card) => ({
      queryKey: queryKeys.crops.irrigationLedger(card.cropId, 1),
      queryFn: () => cropsApi.irrigationLedger(card.cropId, { page: 1, limit: 50 }),
      staleTime: STALE_TIME.interactive,
    })),
  });

  const advice = adviceQuery.data;
  const soil = advice?.trace?.find((step) => step.step === 'SOIL') ?? null;
  const awc = typeof soil?.awcMmPerM === 'number' ? soil.awcMmPerM : null;
  const soilType = typeof soil?.soilType === 'string' ? soil.soilType : null;

  const logs = ledgers.flatMap((ledger) => ledger.data?.data.logs ?? []);
  const measured = logs.filter((log) => log.amountMm !== null);
  const appliedMm = measured.reduce((sum, log) => sum + (log.amountMm ?? 0), 0);

  const tiles = [
    advice?.rain
      ? {
          key: 'rain',
          label: t('irrigation:rainExpectedLabel'),
          value: `${formatNumber(advice.rain.probPct, language, { maximumFractionDigits: 0 })}%`,
          hint: `${formatNumber(advice.rain.mm, language, { maximumFractionDigits: 0 })} ${t('common:unit.mm')} · ${formatDayMonth(advice.rain.date, language)}`,
        }
      : null,
    advice?.nextCheckDays != null
      ? {
          key: 'next',
          label: t('irrigation:nextReviewHeading'),
          value: formatDayMonth(new Date(Date.now() + advice.nextCheckDays * 86_400_000), language),
          hint: t('common:unit.days', { count: advice.nextCheckDays }),
        }
      : null,
    soilType
      ? {
          key: 'soil',
          label: t('irrigation:soilWaterLabel'),
          value: t(`agri:soil.${soilType}`),
          hint:
            awc != null
              ? `${formatNumber(awc, language, { maximumFractionDigits: 0 })} ${t('common:unit.mm')}/m`
              : null,
        }
      : null,
    {
      key: 'applied',
      label: t('irrigation:waterLoggedLabel'),
      value:
        measured.length > 0
          ? `${formatNumber(appliedMm, language, { maximumFractionDigits: 0 })} ${t('common:unit.mm')}`
          : t('irrigation:noWaterLogged'),
      hint:
        logs.length > 0
          ? t('irrigation:recentWaterHeading') +
            ' · ' +
            formatNumber(logs.length, language, { maximumFractionDigits: 0 })
          : null,
    },
  ].filter((tile): tile is { key: string; label: string; value: string; hint: string | null } =>
    Boolean(tile),
  );

  return (
    <>
      {tiles.map((tile) => (
        <Card key={tile.key} className="h-full p-5" data-testid="irrigation-insight">
          <p className="kicker">{tile.label}</p>
          <p className="mt-2.5 font-display text-[1.75rem] font-extrabold leading-none tracking-[-0.03em]">
            {tile.value}
          </p>
          {tile.hint && <p className="mt-1.5 text-sm text-ink-500">{tile.hint}</p>}
        </Card>
      ))}
    </>
  );
}

/** The soil-to-verdict working for the crop the page leads with. */
function LeadWorking({ cropId }: { cropId: string }) {
  const { t } = useTranslation('irrigation');

  const query = useQuery({
    queryKey: queryKeys.crops.irrigation(cropId),
    queryFn: () => cropsApi.irrigation(cropId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (query.isPending) return <SkeletonCard />;

  if (!query.data) {
    return (
      <Card className="p-5">
        <h3 className="kicker">{t('howWorkedOut')}</h3>
        <p className="mt-3 text-sm text-ink-500">{t('noDecisionBody')}</p>
      </Card>
    );
  }

  return <IrrigationWorking advice={query.data} variant="full" />;
}

/**
 * What has actually been applied lately, across the farm's crops.
 *
 * Composed client-side from each crop's own ledger — the ledger route is
 * crop-scoped and there is no farm-level one. `useQueries` rather than a loop
 * of hooks so the crop list can change length without breaking the rules of
 * hooks. Ordering is by date across all crops, so "recent" means recent on this
 * field rather than recent within one planting.
 */
function RecentWater({ cards }: { cards: readonly CropCard[] }) {
  const { t } = useTranslation(['irrigation', 'common']);
  const { language } = useLanguage();

  const ledgers = useQueries({
    queries: cards.map((card) => ({
      queryKey: queryKeys.crops.irrigationLedger(card.cropId, 1),
      queryFn: () => cropsApi.irrigationLedger(card.cropId, { page: 1, limit: 10 }),
      staleTime: STALE_TIME.interactive,
    })),
  });

  const isPending = ledgers.some((ledger) => ledger.isPending);

  const entries: Array<{ log: IrrigationLogEntry; card: CropCard }> = ledgers
    .flatMap((ledger, index) => {
      const card = cards[index];
      if (!card) return [];
      return (ledger.data?.data.logs ?? []).map((log) => ({ log, card }));
    })
    .sort((a, b) => new Date(b.log.date).getTime() - new Date(a.log.date).getTime())
    .slice(0, 5);

  return (
    <Card className="flex h-full flex-col p-5" data-testid="recent-water">
      <h3 className="kicker">{t('irrigation:recentWaterHeading')}</h3>

      {isPending ? (
        <SkeletonList count={2} />
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">{t('irrigation:ledgerEmpty')}</p>
      ) : (
        <ul className="mt-2">
          {entries.map(({ log, card }) => {
            const name = localizedName(card.names, language)?.text ?? card.cropCode;
            const measured = log.amountMm !== null;

            return (
              <li
                key={log.id}
                className="flex items-start justify-between gap-3 border-b border-line py-3.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {measured
                      ? t('irrigation:appliedLabel', {
                          value: formatNumber(log.amountMm as number, language, {
                            maximumFractionDigits: 0,
                          }),
                        })
                      : t('irrigation:logFullRefill')}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {name} · {formatDayMonth(log.date, language)}
                    {measured ? '' : ` · ${t('irrigation:noAmountGiven')}`}
                  </p>
                </div>
                <Badge tone={measured ? 'neutral' : 'brand'}>
                  {measured ? t('irrigation:measuredTag') : t('irrigation:refillTag')}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}

      <ButtonLink to="/history" variant="secondary" fullWidth className="mt-auto pt-4">
        {t('irrigation:fullHistoryCta')}
      </ButtonLink>
    </Card>
  );
}
