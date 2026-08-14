import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { marketApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { NearbyCommodity, NearbyMandi, NearbyMandisResponse } from '@/api/types';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useCropNames } from '@/hooks/useCropNames';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { PriceMove } from './PriceMove';

/** How many nearby mandis the comparison lists before it defers to the market screen. */
const MAX_COMPARISON_ROWS = 4;

/** Fallback commodities shown when this crop has no nearby report at all. */
const MAX_FALLBACK_ROWS = 3;

/**
 * What this crop is fetching nearby — and, when it is fetching nothing, what
 * the market around this field is doing instead.
 *
 * ## The failure this exists to fix
 *
 * The crop screen used to render "Not enough recent reports to describe a
 * trend" and stop. That sentence is true and almost useless: a farmer looking
 * at it had a real price on record for their onion and four mandis publishing
 * wheat, soybean and maize, and the screen showed none of it.
 *
 * So the card degrades in three honest steps rather than one:
 *
 *   1. **A price and a trend** — this crop's newest nearby observation and the
 *      engine's movement figure, with the other mandis trading it beneath.
 *   2. **A price but no trend** — the price still leads; the missing trend is
 *      stated as a fact about the reports, not as an absence of price.
 *   3. **No price for this crop** — named plainly, followed by the latest
 *      nearby prices for other commodities, labelled as other commodities.
 *      A fallback, never dressed up as this crop's own figure.
 *
 * Every number is the server's: `GET /market/nearby` returns each commodity's
 * newest observation and the signal engine's trend for it. Nothing here
 * computes a price, a percentage or a comparison the payload does not contain.
 */
export function CropMarketCard({
  farmId,
  cropCode,
  onOpenDetails,
}: {
  farmId: string;
  cropCode: string;
  /** Opens the crop's own market tab, where the full series and trace live. */
  onOpenDetails?: () => void;
}) {
  const { t } = useTranslation(['market', 'crop', 'common']);
  const cropName = useCropNames();

  const query = useQuery({
    queryKey: queryKeys.market.nearby(farmId, undefined, 30),
    queryFn: () => marketApi.nearby({ farmId, days: 30 }),
    enabled: Boolean(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (query.isPending) return <SkeletonCard />;

  const data = query.data;
  const entry = data?.commodities.find((row) => row.commodityCode === cropCode) ?? null;

  if (!data || data.commodities.length === 0) {
    return (
      <Card className="p-5" data-testid="crop-market-card">
        <span className="kicker">{t('crop:tabMarket')}</span>
        <p className="mt-2.5 text-[1.25rem] font-semibold">{t('market:noMarketTitle')}</p>
        <p className="mt-1.5 text-sm text-ink-500">{t('market:noMarketBody')}</p>
        <ButtonLink to="/market" variant="secondary" size="md" className="mt-4">
          {t('market:viewNearbyCta')}
        </ButtonLink>
      </Card>
    );
  }

  return (
    <Card className="p-5" data-testid="crop-market-card" data-commodity={cropCode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="kicker">
          {t('crop:tabMarket')} · {cropName(cropCode)}
        </span>
        {onOpenDetails ? (
          <button
            type="button"
            onClick={onOpenDetails}
            className="font-display text-sm font-semibold text-brand-600 hover:underline"
          >
            {t('market:signalHeading')}
          </button>
        ) : (
          <Link
            to="/market"
            className="font-display text-sm font-semibold text-brand-600 hover:underline"
          >
            {t('market:viewNearbyCta')}
          </Link>
        )}
      </div>

      {entry ? (
        <CropPrice entry={entry} mandis={data.mandis} cropCode={cropCode} />
      ) : (
        <CropPriceMissing data={data} cropCode={cropCode} />
      )}
    </Card>
  );
}

/** This crop has a nearby price. Lead with it, then compare the mandis. */
function CropPrice({
  entry,
  mandis,
  cropCode,
}: {
  entry: NearbyCommodity;
  mandis: NearbyMandi[];
  cropCode: string;
}) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  /*
   * Every nearby mandi that reported this commodity, dearest first. Built from
   * the mandi list rather than re-queried: `/market/nearby` already carries one
   * observation per (mandi, commodity), which is exactly this comparison.
   */
  const quotes = mandis
    .map((mandi) => ({
      mandi,
      quote: mandi.commodities.find((c) => c.commodityCode === cropCode) ?? null,
    }))
    .filter((row): row is { mandi: NearbyMandi; quote: NonNullable<typeof row.quote> } =>
      Boolean(row.quote),
    )
    .sort((a, b) => b.quote.modalPrice - a.quote.modalPrice);

  const best = quotes[0] ?? null;
  const spread =
    quotes.length > 1
      ? quotes[0]!.quote.modalPrice - quotes[quotes.length - 1]!.quote.modalPrice
      : 0;

  const price = (value: number) =>
    t('common:unit.rupeesPerQuintal', {
      value: formatNumber(value, language, { maximumFractionDigits: 0 }),
    });

  return (
    <>
      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <p className="font-display text-[2rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums">
            {price(entry.latest.modalPrice)}
          </p>
          <p className="mt-1.5 text-sm text-ink-500">
            {entry.latest.market} · {formatDayMonth(entry.latest.date, language)}
          </p>
        </div>

        <div className="pb-1">
          <PriceMove trend={entry.trend} changePct={entry.changePct7d} className="text-sm" />
          <p className="mt-1 text-xs text-ink-500">{t('market:latestNearbyPrice')}</p>
        </div>
      </div>

      {/*
        The trend's absence is a statement about the reports, not about the
        price — which is printed above regardless. Saying so is the difference
        between "we have no price" and "we have one price".
      */}
      {!entry.trend && (
        <p className="mt-2.5 text-sm text-ink-500" data-testid="crop-market-no-trend">
          {t('market:noTrendYet')}
        </p>
      )}

      {quotes.length > 1 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="kicker">{t('market:nearbyComparisonHeading')}</p>
          <ul className="mt-2">
            {quotes.slice(0, MAX_COMPARISON_ROWS).map(({ mandi, quote }) => (
              <li
                key={`${mandi.state}|${mandi.market}`}
                className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                <span className="min-w-0 truncate text-sm">{mandi.market}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {price(quote.modalPrice)}
                </span>
              </li>
            ))}
          </ul>

          {/*
            "What this means for you", only when the numbers support a
            statement. A spread of zero is not a comparison, so the copy falls
            back to saying the mandis are close rather than inventing a winner.
          */}
          <p
            className="mt-3 text-sm leading-relaxed text-ink-700"
            data-testid="crop-market-meaning"
          >
            {best && spread > 0
              ? t('market:spreadNote', {
                  crop: cropName(cropCode),
                  market: best.mandi.market,
                  price: price(best.quote.modalPrice),
                })
              : t('market:pricesCloseNote')}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * No nearby report for this crop. Say so by name, then show the market that
 * does exist — clearly labelled as other commodities, never as this crop's.
 */
function CropPriceMissing({ data, cropCode }: { data: NearbyMandisResponse; cropCode: string }) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  const others = data.commodities.slice(0, MAX_FALLBACK_ROWS);

  return (
    <>
      <p className="mt-3 text-[1.25rem] font-semibold" data-testid="crop-market-missing">
        {t('market:noRecentCropTitle', { crop: cropName(cropCode) })}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
        {t('market:noRecentCropBody', { crop: cropName(cropCode) })}
      </p>

      {others.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="kicker">{t('market:otherPricesHeading')}</p>
          <ul className="mt-2">
            {others.map((entry) => (
              <li
                key={entry.commodityCode}
                className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {cropName(entry.commodityCode)}
                  </span>
                  <span className="text-xs text-ink-500">
                    {entry.latest.market} · {formatDayMonth(entry.latest.date, language)}
                  </span>
                </span>
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

          <Badge className="mt-3" tone="neutral">
            {t('market:otherPricesHeading')}
          </Badge>
        </div>
      )}
    </>
  );
}
