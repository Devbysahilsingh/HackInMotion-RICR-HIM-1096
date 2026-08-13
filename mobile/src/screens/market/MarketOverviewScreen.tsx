/**
 * The market tab.
 *
 * Two questions, in the order a farmer asks them on a phone:
 *
 * 1. **"What is my crop worth?"** — the crops they actually have in the
 *    ground, each with the engine's guidance sentence rather than a number to
 *    interpret. This is the decision, so it is the first screenful.
 * 2. **"What is trading near me?"** — a mandi is not a crop: one carries
 *    several commodities, and a commodity-keyed view can only ever show one of
 *    them. This asks the *farm*, not the farmer, so nobody re-selects a
 *    location they have already given.
 *
 * The web puts the mandi browser first. This does not, deliberately: on a
 * handset the first screenful has to answer the farmer's own question, and
 * browsing is one scroll away here rather than a page away as it is on the web.
 *
 * ## No distances
 *
 * Agmarknet publishes no mandi coordinates, so "12 km away" would have to be
 * invented. Mandis are grouped as "in your district" or "elsewhere in your
 * state" instead, and the footnote says why.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { formatDayMonth, formatNumber, localizedName } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { MyCropSignal, NearbyMandi } from '@shared/types/api';

import { farmsApi, marketApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { FreshnessDot } from '../../components/ui/FreshnessDot';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Select } from '../../components/ui/Select';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import {
  IconChevronRight,
  IconTrendDown,
  IconTrendFlat,
  IconTrendUp,
} from '../../components/ui/icons';
import { useCropNames } from '../../hooks/useCropNames';
import { translateMessageKey } from '../../i18n/messageKey';
import type { MarketStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';
import { RangeSelect, type MarketRange } from './CommodityDetailScreen';

const TREND_ICON = {
  RISING: IconTrendUp,
  FALLING: IconTrendDown,
  STABLE: IconTrendFlat,
} as const;

export function MarketOverviewScreen() {
  const { t } = useTranslation(['market', 'common']);
  const [days, setDays] = useState<MarketRange>(30);

  const myCropsQuery = useQuery({
    queryKey: queryKeys.market.myCrops(days),
    queryFn: () => marketApi.myCrops({ days }),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <Screen
      onRefresh={() => void myCropsQuery.refetch()}
      refreshing={myCropsQuery.isRefetching}
      testID="market-overview"
    >
      <SectionHeader title={t('market:pageTitle')} description={t('market:neverPredicts')} />

      <RangeSelect days={days} onChange={setDays} />

      <View style={styles.section}>
        <SectionHeader title={t('market:myCropsHeading')} />
        <QueryBoundary
          query={myCropsQuery}
          loading={<SkeletonCard />}
          isEmpty={(data) => data.data.crops.length === 0}
          empty={<EmptyState title={t('market:myCropsEmpty')} />}
        >
          {(data) => (
            <View style={styles.list} testID="market-my-crops">
              {data.data.crops.map((crop) => (
                <MyCropRow key={crop.cropCode} crop={crop} />
              ))}
            </View>
          )}
        </QueryBoundary>
      </View>

      <NearbyMandis days={days} />
    </Screen>
  );
}

/**
 * One of the farmer's crops, summarised.
 *
 * The guidance sentence is the row's body — not the percentage, which is a
 * badge beside it. Tapping opens the full series and the mandi comparison.
 */
function MyCropRow({ crop }: { crop: MyCropSignal }) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();
  const navigation = useNavigation<NavigationProp<MarketStackParamList>>();

  const name = localizedName(crop.names, language)?.text ?? crop.cropCode;
  const trend = crop.signal.trend;
  const Icon = trend ? (TREND_ICON[trend] ?? IconTrendFlat) : IconTrendFlat;
  const headline = trend ? t(`market:title${trend}`) : t('market:noSignal');

  const guidance = translateMessageKey(t, crop.signal.guidanceKey, {
    pct: Math.abs(crop.signal.changePct7d ?? 0).toFixed(1),
    district: crop.district ?? '',
    modal: '',
  });

  return (
    <Card
      onPress={() =>
        navigation.navigate('CommodityDetail', {
          commodity: crop.commodityCode,
          ...(crop.state ? { state: crop.state } : {}),
          ...(crop.district ? { district: crop.district } : {}),
        })
      }
      accessibilityLabel={name}
      accessibilityHint={guidance}
      testID="market-crop-row"
    >
      <View style={styles.rowOuter}>
        <View style={styles.rowMain}>
          <Text variant="subheading">{name}</Text>

          <Text variant="body" color="ink700">
            {guidance}
          </Text>

          <View style={styles.chips}>
            <Badge tone="neutral" icon={<Icon size={14} color={colors.ink700} />}>
              {headline}
            </Badge>
            {crop.district ? <Badge tone="brand">{crop.district}</Badge> : null}
          </View>

          <FreshnessDot status={crop.freshness.status} latestDate={crop.freshness.latestDate} />
        </View>

        <IconChevronRight size={22} color={colors.ink500} />
      </View>
    </Card>
  );
}

function NearbyMandis({ days }: { days: MarketRange }) {
  const { t } = useTranslation(['market', 'common']);

  const [farmId, setFarmId] = useState<string | undefined>();
  const [commodity, setCommodity] = useState<string>('');

  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });

  /**
   * The commodity codes on the wire (`WHEAT`, `ONION`) are canonical ids, not
   * display text — a Hindi screen must say प्याज, not ONION.
   */
  const commodityLabel = useCropNames();

  const farms = farmsQuery.data?.farms ?? [];
  const activeFarmId =
    farmId && farms.some((farm) => farm.id === farmId) ? farmId : (farms[0]?.id ?? null);
  const activeFarm = farms.find((farm) => farm.id === activeFarmId) ?? null;

  const nearbyQuery = useQuery({
    queryKey: queryKeys.market.nearby(activeFarmId ?? '', commodity || undefined, days),
    queryFn: () =>
      marketApi.nearby({
        farmId: activeFarmId!,
        ...(commodity ? { commodity } : {}),
        days,
      }),
    enabled: Boolean(activeFarmId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (farmsQuery.isSuccess && farms.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader
        title={
          activeFarm
            ? t('market:nearbyForFarm', { farm: activeFarm.name })
            : t('market:nearbyTitle')
        }
        description={
          activeFarm
            ? [activeFarm.location.village, activeFarm.location.district, activeFarm.location.state]
                .filter(Boolean)
                .join(', ')
            : undefined
        }
      />

      {/* Only offered when there is a genuine choice to make. */}
      {farms.length > 1 ? (
        <Select
          label={t('common:nav.farms')}
          value={activeFarmId ?? undefined}
          onChange={(value) => {
            setFarmId(value);
            // The previous crop may not trade near the new farm.
            setCommodity('');
          }}
          options={farms.map((farm) => ({ value: farm.id, label: farm.name }))}
          testID="nearby-farm"
        />
      ) : null}

      <Select
        label={t('market:allCrops')}
        value={commodity}
        onChange={setCommodity}
        options={[
          { value: '', label: t('market:allCrops') },
          ...(nearbyQuery.data?.availableCommodities ?? []).map((code) => ({
            value: code,
            label: commodityLabel(code),
          })),
        ]}
        testID="nearby-commodity"
      />

      <QueryBoundary
        query={nearbyQuery}
        loading={<SkeletonCard />}
        isEmpty={(data) => data.mandis.length === 0}
        empty={<EmptyState title={t('market:nearbyEmpty')} />}
      >
        {(data) => (
          <View style={styles.list} testID="nearby-mandis">
            <View style={styles.scopeRow}>
              <FreshnessDot status={data.freshness.status} latestDate={data.freshness.latestDate} />
              <Text variant="caption" color="ink500">
                {t('market:mandiCountLabel', {
                  count: data.counts.mandis,
                  commodities: data.counts.commodities,
                })}
              </Text>
            </View>

            <MandiGroup
              title={t('market:inYourDistrict')}
              mandis={data.mandis.filter((mandi) => mandi.proximity === 'SAME_DISTRICT')}
              commodityLabel={commodityLabel}
            />
            <MandiGroup
              title={t('market:inYourState')}
              mandis={data.mandis.filter((mandi) => mandi.proximity === 'SAME_STATE')}
              commodityLabel={commodityLabel}
            />

            <Text variant="caption" color="ink500">
              {t('market:noDistanceNote')}
            </Text>
          </View>
        )}
      </QueryBoundary>
    </View>
  );
}

/** Capped so a state with 200 mandis does not render 200 cards. */
const MANDI_CAP = 12;

function MandiGroup({
  title,
  mandis,
  commodityLabel,
}: {
  title: string;
  mandis: NearbyMandi[];
  commodityLabel: (code: string) => string;
}) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  // A heading over nothing is noise: an empty group simply does not appear.
  if (mandis.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>

      {mandis.slice(0, MANDI_CAP).map((mandi) => (
        <Card key={`${mandi.state}|${mandi.district ?? ''}|${mandi.market}`}>
          <View style={styles.mandiBody}>
            <View style={styles.mandiHead}>
              <Text variant="subheading" style={styles.flexText}>
                {mandi.market}
              </Text>
              {mandi.district ? <Badge>{mandi.district}</Badge> : null}
            </View>

            {mandi.commodities.map((entry) => (
              <View key={entry.commodityCode} style={styles.commodityRow}>
                <Text variant="small" style={styles.flexText}>
                  {commodityLabel(entry.commodityCode)}
                </Text>
                <View style={styles.commodityFigures}>
                  <Text variant="bodyStrong">
                    {t('common:unit.rupeesPerQuintal', {
                      value: formatNumber(entry.modalPrice, language, {
                        maximumFractionDigits: 0,
                      }),
                    })}
                  </Text>
                  <Text variant="caption" color="ink500">
                    {`${formatNumber(entry.minPrice, language, { maximumFractionDigits: 0 })}–${formatNumber(entry.maxPrice, language, { maximumFractionDigits: 0 })} · ${formatDayMonth(entry.date, language)}`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  list: { gap: spacing.md },
  rowOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowMain: { flex: 1, gap: spacing.sm, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scopeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md },
  mandiBody: { gap: spacing.sm },
  mandiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  commodityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
  },
  commodityFigures: { alignItems: 'flex-end', gap: 2 },
  flexText: { flexShrink: 1 },
});
