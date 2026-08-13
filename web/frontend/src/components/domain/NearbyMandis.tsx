import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { farmsApi, marketApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { Language, NearbyMandi } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/Badge';
import { Card, Section } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/states';
import { useCropNames } from '@/hooks/useCropNames';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth, formatNumber } from '@/lib/format';

/**
 * What is trading near the farmer's field.
 *
 * ## Why this is the first thing on the market screen
 *
 * The old screen opened with "pick one of your crops", which is the wrong first
 * question — it assumes the farmer already knows what they want to sell and
 * hides everything else their local mandi is doing. **A mandi is not a crop**:
 * one carries seven commodities in the live feed, and a commodity-keyed view
 * can only ever show one of them.
 *
 * So this asks the farm, not the farmer. The farm already carries the state and
 * district, so nobody re-selects a location they have already given, and the
 * crop dropdown below is a *filter over that place* rather than a new question.
 *
 * ## No distances, deliberately
 *
 * Agmarknet publishes no mandi coordinates, so "12 km away" would have to be
 * invented. Mandis are grouped as "in your district" or "elsewhere in your
 * state" instead, and the footnote says why — an honest grouping beats a
 * confident-looking number nobody measured.
 */
export function NearbyMandis({ days }: { days: number }) {
  const { t } = useTranslation(['market', 'common', 'agri']);
  const { language } = useLanguage();

  const [farmId, setFarmId] = useState<string | null>(null);
  const [commodity, setCommodity] = useState<string>('');

  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });

  /**
   * The commodity codes on the wire (`WHEAT`, `ONION`) are canonical ids, not
   * display text — a Hindi screen must say प्याज, not ONION. The registry
   * carries the bilingual names; `useCropNames` joins them client-side.
   */
  const commodityLabel = useCropNames();

  const farms = farmsQuery.data?.farms ?? [];
  const activeFarmId =
    farmId && farms.some((f) => f.id === farmId) ? farmId : (farms[0]?.id ?? null);
  const activeFarm = farms.find((f) => f.id === activeFarmId) ?? null;

  const nearbyQuery = useQuery({
    queryKey: queryKeys.market.nearby(activeFarmId ?? '', commodity || undefined, days),
    queryFn: () =>
      marketApi.nearby({ farmId: activeFarmId!, ...(commodity ? { commodity } : {}), days }),
    enabled: Boolean(activeFarmId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (farmsQuery.isSuccess && farms.length === 0) {
    return (
      <Section title={t('market:nearbyTitle')}>
        <EmptyState title={t('market:myCropsEmpty')} />
      </Section>
    );
  }

  return (
    <Section
      title={
        activeFarm ? t('market:nearbyForFarm', { farm: activeFarm.name }) : t('market:nearbyTitle')
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {/* Only offered when there is a genuine choice to make. */}
        {farms.length > 1 && (
          <SelectField
            label={t('common:nav.farms')}
            value={activeFarmId ?? ''}
            onChange={(event) => {
              setFarmId(event.target.value);
              // The previous crop may not trade near the new farm.
              setCommodity('');
            }}
            data-testid="nearby-farm"
          >
            {farms.map((farm) => (
              <option key={farm.id} value={farm.id}>
                {farm.name}
              </option>
            ))}
          </SelectField>
        )}

        <SelectField
          label={t('market:allCrops')}
          value={commodity}
          onChange={(event) => setCommodity(event.target.value)}
          data-testid="nearby-commodity"
        >
          <option value="">{t('market:allCrops')}</option>
          {(nearbyQuery.data?.availableCommodities ?? []).map((code) => (
            <option key={code} value={code}>
              {commodityLabel(code)}
            </option>
          ))}
        </SelectField>
      </div>

      {activeFarm && (
        <p className="mb-3 text-sm text-ink-500" data-testid="nearby-scope">
          {[activeFarm.location.village, activeFarm.location.district, activeFarm.location.state]
            .filter(Boolean)
            .join(', ')}
        </p>
      )}

      <QueryBoundary
        query={nearbyQuery}
        loading={<SkeletonCard />}
        isEmpty={(data) => data.mandis.length === 0}
        empty={<EmptyState title={t('market:nearbyEmpty')} />}
      >
        {(data) => (
          <div className="space-y-4" data-testid="nearby-mandis">
            <div className="flex flex-wrap items-center gap-3">
              <FreshnessDot freshness={data.freshness} />
              <span className="text-sm text-ink-500">
                {t('market:mandiCountLabel', {
                  count: data.counts.mandis,
                  commodities: data.counts.commodities,
                })}
              </span>
            </div>

            <MandiGroup
              titleKey="market:inYourDistrict"
              mandis={data.mandis.filter((m) => m.proximity === 'SAME_DISTRICT')}
              language={language}
              commodityLabel={commodityLabel}
            />
            <MandiGroup
              titleKey="market:inYourState"
              mandis={data.mandis.filter((m) => m.proximity === 'SAME_STATE')}
              language={language}
              commodityLabel={commodityLabel}
            />

            <p className="text-xs text-ink-500">{t('market:noDistanceNote')}</p>
          </div>
        )}
      </QueryBoundary>
    </Section>
  );
}

function MandiGroup({
  titleKey,
  mandis,
  language,
  commodityLabel,
}: {
  titleKey: string;
  mandis: NearbyMandi[];
  language: Language;
  commodityLabel: (code: string) => string;
}) {
  const { t } = useTranslation(['market', 'common']);
  // A heading over nothing is noise: an empty group simply does not appear.
  if (mandis.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-700">{t(titleKey)}</h3>
      <ul className="space-y-3">
        {/* Capped so a state with 200 mandis does not render 200 cards. */}
        {mandis.slice(0, 12).map((mandi) => (
          <li key={`${mandi.state}|${mandi.district}|${mandi.market}`}>
            <Card className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-base font-semibold">{mandi.market}</h4>
                {mandi.district && <Badge>{mandi.district}</Badge>}
              </div>

              <ul className="mt-3 space-y-2">
                {mandi.commodities.map((c) => (
                  <li
                    key={c.commodityCode}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-2 first:border-0 first:pt-0"
                  >
                    <span className="text-sm font-medium">{commodityLabel(c.commodityCode)}</span>
                    <span className="text-sm">
                      {t('common:unit.rupeesPerQuintal', {
                        value: formatNumber(c.modalPrice, language),
                      })}
                    </span>
                    <span className="text-xs text-ink-500">
                      {formatNumber(c.minPrice, language)}–{formatNumber(c.maxPrice, language)}
                      {' · '}
                      {formatDayMonth(c.date, language)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
