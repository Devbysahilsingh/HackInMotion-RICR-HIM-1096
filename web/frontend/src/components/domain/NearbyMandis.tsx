import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { farmsApi, marketApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { NearbyCommodity, NearbyMandi } from '@/api/types';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/states';
import { IconChevronRight, IconTrendUp } from '@/components/ui/icons';
import { useCropNames } from '@/hooks/useCropNames';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PriceMove } from './PriceMove';

/**
 * A mandi is "reporting" if its newest observation is inside this many days.
 * Older than that and its prices are history rather than today's market — shown,
 * dated, and visibly set apart rather than deleted (see `MandiCard`).
 */
const RECENT_REPORT_DAYS = 7;

/** Commodity rows on a mandi card before it defers to its own screen. */
const ROWS_PER_MANDI = 4;

/** How many mandi cards a single state may render. */
const MAX_MANDIS = 12;

/**
 * What is trading near the farmer's field.
 *
 * ## Why this is the market screen rather than a section of it
 *
 * The old screen opened with "pick one of your crops", which is the wrong first
 * question — it assumes the farmer already knows what they want to sell and
 * hides everything else their local mandi is doing. **A mandi is not a crop**:
 * one carries seven commodities in the live feed, and a commodity-keyed view can
 * only ever show one of them. Worse, a farmer whose single crop had no recent
 * report saw an empty screen while four mandis nearby were publishing prices for
 * six other things.
 *
 * So this asks the farm, not the farmer: nearby mandis with their whole basket,
 * the farmer's own crops highlighted, and every other commodity still visible
 * because that is the market they are selling into.
 *
 * ## No distances, deliberately
 *
 * Agmarknet publishes no mandi coordinates — a row carries state, district and
 * market name and nothing else — so the design's "12 km" would have to be
 * invented (rule 7). Mandis are grouped as "in your district" or "elsewhere in
 * your state" instead, and the footnote says why.
 */
export function NearbyMandis({ days }: { days: number }) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();
  const commodityLabel = useCropNames();

  const [filter, setFilter] = useState<string>('ALL');
  const { activeFarmId, activeFarm } = useActiveFarm();

  /** The farm's own crops, for the "My crops" filter and the highlight. */
  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(activeFarmId ?? ''),
    queryFn: () => farmsApi.get(activeFarmId!),
    enabled: Boolean(activeFarmId),
    staleTime: STALE_TIME.slowMoving,
  });

  /*
   * Always fetched unfiltered. Narrowing server-side would make the commodity
   * filter a new request per chip and — much worse — would empty the whole
   * screen the moment the chosen crop had no nearby report, which is exactly
   * the failure this rebuild exists to remove. The filter is applied to the
   * result below, so "no onion nearby" still shows every other price.
   */
  const nearbyQuery = useQuery({
    queryKey: queryKeys.market.nearby(activeFarmId ?? '', undefined, days),
    queryFn: () => marketApi.nearby({ farmId: activeFarmId!, days }),
    enabled: Boolean(activeFarmId),
    staleTime: STALE_TIME.slowMoving,
  });

  const myCropCodes = useMemo(
    () =>
      new Set(
        (farmQuery.data?.crops ?? [])
          .filter((crop) => crop.status !== 'harvested')
          .map((crop) => crop.cropCode),
      ),
    [farmQuery.data],
  );

  if (!activeFarmId) return <SkeletonCard />;
  if (nearbyQuery.isPending) return <SkeletonCard />;

  const data = nearbyQuery.data;
  if (nearbyQuery.isError || !data || data.mandis.length === 0) {
    return <MarketUnavailable />;
  }

  /** Which commodity codes survive the current chip. */
  const visible = (code: string) =>
    filter === 'ALL' || (filter === 'MY_CROPS' ? myCropCodes.has(code) : filter === code);

  const mandis = data.mandis
    .map((mandi) => ({
      ...mandi,
      commodities: mandi.commodities.filter((c) => visible(c.commodityCode)),
    }))
    .filter((mandi) => mandi.commodities.length > 0)
    .slice(0, MAX_MANDIS);

  const [primary, ...rest] = mandis;
  const latestDate = data.freshness.latestDate;

  return (
    <div className="space-y-5" data-testid="nearby-mandis">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[1.5rem]">{t('market:nearbyHeading')}</h2>
          <p className="mt-1 text-sm text-ink-500">
            {t('market:nearbySubtitle', {
              count: data.counts.mandis,
              farm: [activeFarm?.name, activeFarm?.location.district].filter(Boolean).join(', '),
            })}
          </p>
        </div>

        {latestDate && (
          <span
            className="inline-flex items-center gap-2 rounded-full bg-harvest-tint px-3.5 py-1.5 text-[0.719rem] font-semibold text-harvest-700"
            data-testid="market-arrivals"
          >
            {t('market:latestArrivals', { date: formatDayMonth(latestDate, language) })}
            <FreshnessDot freshness={data.freshness} className="text-harvest-700" />
          </span>
        )}
      </div>

      <CommodityFilter
        available={data.availableCommodities}
        myCropCodes={myCropCodes}
        value={filter}
        onChange={setFilter}
        label={commodityLabel}
      />

      <PriceRollup commodities={data.commodities} myCropCodes={myCropCodes} filter={filter} />

      {mandis.length === 0 ? (
        <EmptyState title={t('market:nearbyEmpty')} />
      ) : (
        /*
          The design's composition: one large mandi card on the left — the
          farmer's own district, widest basket, which the API already sorts
          first — and the rest stacked beside it. Below 1240px they become one
          column, largest first, which is the same order of importance.
        */
        <div className="grid items-start gap-5 xl:grid-cols-[1.15fr_1fr]">
          {primary && (
            <MandiCard
              mandi={primary}
              myCropCodes={myCropCodes}
              commodityLabel={commodityLabel}
              featured
            />
          )}

          {rest.length > 0 && (
            <div className="flex flex-col gap-5">
              {rest.map((mandi) => (
                <MandiCard
                  key={`${mandi.state}|${mandi.district}|${mandi.market}`}
                  mandi={mandi}
                  myCropCodes={myCropCodes}
                  commodityLabel={commodityLabel}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-ink-500">
        {t('market:publishedNote')} {t('market:noDistanceNote')}
      </p>
    </div>
  );
}

/**
 * The commodity chips.
 *
 * "All commodities" and "My crops" are the two questions a farmer actually
 * opens this screen with; the per-commodity chips are the follow-up. They come
 * from `availableCommodities` — what the nearby mandis genuinely traded in the
 * window — so a chip can never select a commodity with nothing behind it.
 */
function CommodityFilter({
  available,
  myCropCodes,
  value,
  onChange,
  label,
}: {
  available: string[];
  myCropCodes: ReadonlySet<string>;
  value: string;
  onChange: (next: string) => void;
  label: (code: string) => string;
}) {
  const { t } = useTranslation('market');

  const chips = [
    { value: 'ALL', text: t('filterAll') },
    ...(myCropCodes.size > 0 ? [{ value: 'MY_CROPS', text: t('filterMyCrops') }] : []),
    // The farmer's own crops lead the per-commodity chips; the rest follow in
    // the order the API returned them (busiest first).
    ...[...available]
      .sort((a, b) => Number(myCropCodes.has(b)) - Number(myCropCodes.has(a)) || a.localeCompare(b))
      .map((code) => ({ value: code, text: label(code) })),
  ];

  return (
    <div
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      role="group"
      aria-label={t('filterAll')}
      data-testid="commodity-filter"
    >
      {chips.map((chip) => (
        <button
          key={chip.value}
          type="button"
          aria-pressed={value === chip.value}
          onClick={() => onChange(chip.value)}
          className={cn(
            'touch-target shrink-0 rounded-full border px-4 text-sm font-medium transition-colors',
            value === chip.value
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-line bg-surface text-ink-700 hover:border-leaf-500 hover:bg-leaf-tint',
          )}
        >
          {chip.text}
        </button>
      ))}
    </div>
  );
}

/**
 * The area's prices at a glance: the farmer's own crops first, then everything
 * else the nearby mandis are trading.
 *
 * This is the answer to the screen's real failure mode. A farmer growing only
 * onion, in a week nobody reported onion, used to get a blank market page — so
 * "Other market prices" is not decoration, it is the fallback that keeps the
 * screen useful, and it is labelled as other commodities rather than passed off
 * as theirs.
 */
function PriceRollup({
  commodities,
  myCropCodes,
  filter,
}: {
  commodities: NearbyCommodity[];
  myCropCodes: ReadonlySet<string>;
  filter: string;
}) {
  const { t } = useTranslation(['market', 'common']);

  if (commodities.length === 0) return null;

  const shown =
    filter === 'ALL' || filter === 'MY_CROPS'
      ? commodities
      : commodities.filter((entry) => entry.commodityCode === filter);

  const mine = shown.filter((entry) => myCropCodes.has(entry.commodityCode));
  const others = shown.filter((entry) => !myCropCodes.has(entry.commodityCode));

  const groups = [
    mine.length > 0 ? { key: 'mine', title: t('market:myCropsHeading'), entries: mine } : null,
    // Hidden under the "My crops" chip: the farmer asked for theirs.
    others.length > 0 && filter !== 'MY_CROPS'
      ? { key: 'others', title: t('market:otherPricesHeading'), entries: others }
      : null,
  ].filter((group): group is { key: string; title: string; entries: NearbyCommodity[] } =>
    Boolean(group),
  );

  if (groups.length === 0) return null;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} data-testid={`price-rollup-${group.key}`}>
          <h3 className="kicker">{group.title}</h3>
          <div className="mt-2.5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.entries.slice(0, 8).map((entry) => (
              <CommodityTile key={entry.commodityCode} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CommodityTile({ entry }: { entry: NearbyCommodity }) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();
  const commodityLabel = useCropNames();

  return (
    <Card className="h-full p-4" data-testid="commodity-tile" data-commodity={entry.commodityCode}>
      <p className="kicker truncate">{commodityLabel(entry.commodityCode)}</p>
      <p className="mt-2 font-display text-[1.5rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
        {t('common:unit.rupeesPerQuintal', {
          value: formatNumber(entry.latest.modalPrice, language, { maximumFractionDigits: 0 }),
        })}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <PriceMove trend={entry.trend} changePct={entry.changePct7d} />
        <span className="text-xs text-ink-500">
          {entry.latest.market} · {formatDayMonth(entry.latest.date, language)}
        </span>
      </div>
    </Card>
  );
}

/**
 * One mandi and its basket.
 *
 * A mandi whose newest report is older than a week keeps its card rather than
 * disappearing from the list. That is the honest treatment: a farmer who knows
 * Ichhawar exists should be told it has gone quiet, not left wondering why it
 * vanished. Its prices are still shown with their real dates, and the card is
 * visibly set apart so nobody mistakes them for this week's.
 */
function MandiCard({
  mandi,
  myCropCodes,
  commodityLabel,
  featured = false,
}: {
  mandi: NearbyMandi;
  myCropCodes: ReadonlySet<string>;
  commodityLabel: (code: string) => string;
  featured?: boolean;
}) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  const newest = mandi.commodities.reduce<string | null>(
    (latest, c) => (latest === null || c.date > latest ? c.date : latest),
    null,
  );
  const ageDays = newest
    ? Math.floor((Date.now() - new Date(newest).getTime()) / 86_400_000)
    : null;
  const stale = ageDays !== null && ageDays > RECENT_REPORT_DAYS;

  // Own crops first — the farmer's reason for being here — then the rest of the
  // basket in the order the API ranked it.
  const rows = [...mandi.commodities].sort(
    (a, b) =>
      Number(myCropCodes.has(b.commodityCode)) - Number(myCropCodes.has(a.commodityCode)) ||
      b.modalPrice - a.modalPrice,
  );
  const visibleRows = featured ? rows.slice(0, ROWS_PER_MANDI + 2) : rows.slice(0, ROWS_PER_MANDI);
  const hidden = rows.length - visibleRows.length;

  const detailLink = (commodityCode: string) => ({
    pathname: `/market/${encodeURIComponent(mandi.market)}`,
    search: new URLSearchParams({
      commodity: commodityCode,
      state: mandi.state,
      ...(mandi.district ? { district: mandi.district } : {}),
    }).toString(),
  });

  return (
    <Card
      className={cn('h-full p-5', stale && 'border-dashed bg-canvas shadow-none')}
      data-testid="mandi-card"
      data-market={mandi.market}
      data-stale={stale ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={cn('truncate', featured ? 'text-[1.375rem]' : 'text-[1.125rem]')}>
            {mandi.market}
          </h3>
          <p className="mt-1 text-sm text-ink-500">
            {[
              mandi.district,
              mandi.proximity === 'SAME_DISTRICT'
                ? t('market:inYourDistrict')
                : t('market:inYourState'),
              newest ? t('market:reportedOn', { date: formatDayMonth(newest, language) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <Badge tone={stale ? 'neutral' : 'success'}>
          {stale
            ? t('market:noRecentReport')
            : t('market:commodityCount', { count: mandi.commodities.length })}
        </Badge>
      </div>

      {stale && (
        <p className="mt-3 text-sm leading-relaxed text-ink-500" data-testid="mandi-stale-note">
          {t('market:noRecentReportBody')}
        </p>
      )}

      <ul className="mt-3">
        {visibleRows.map((c) => (
          <li key={c.commodityCode} className="border-b border-line last:border-b-0">
            <Link
              to={detailLink(c.commodityCode)}
              className="flex items-center justify-between gap-3 py-3 hover:text-brand-600"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {commodityLabel(c.commodityCode)}
                </span>
                <span className="mt-0.5 block text-xs tabular-nums text-ink-500">
                  {t('common:unit.rupeesPerQuintal', {
                    value: `${formatNumber(c.minPrice, language, { maximumFractionDigits: 0 })}–${formatNumber(c.maxPrice, language, { maximumFractionDigits: 0 })}`,
                  })}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-display text-[1.0625rem] font-bold tabular-nums">
                  {t('common:unit.rupeesPerQuintal', {
                    value: formatNumber(c.modalPrice, language, { maximumFractionDigits: 0 }),
                  })}
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  {formatDayMonth(c.date, language)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <Link
          to={detailLink(rows[0]!.commodityCode)}
          className="mt-3 inline-flex items-center gap-1 font-display text-sm font-semibold text-brand-600 hover:underline"
        >
          {t('market:seeAllCommodities', { count: rows.length })}
          <IconChevronRight size={16} aria-hidden="true" />
        </Link>
      )}
    </Card>
  );
}

/** No mandi rows at all near this field — a designed card, never a blank page. */
export function MarketUnavailable() {
  const { t } = useTranslation(['market', 'common']);

  return (
    <Card className="p-5" data-testid="market-unavailable">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{t('market:pageTitle')}</span>
        <IconTrendUp size={18} className="text-leaf-700" aria-hidden="true" />
      </div>
      <p className="mt-3 text-[1.25rem] font-semibold">{t('market:noMarketTitle')}</p>
      <p className="mt-1.5 max-w-prose text-sm text-ink-500">{t('market:noMarketBody')}</p>
      <ButtonLink to="/market" variant="secondary" className="mt-4">
        {t('market:viewNearbyCta')}
      </ButtonLink>
    </Card>
  );
}
