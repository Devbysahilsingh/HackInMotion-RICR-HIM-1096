/**
 * One commodity's mandi prices.
 *
 * **Verdict-first.** The signal sentence sits above the chart, because the
 * answer to "should I sell?" is a sentence and the chart is only the evidence
 * for it. The sentence itself is the engine's own `guidanceKey` — this screen
 * writes no market copy of its own.
 *
 * ## This describes the past. It never forecasts.
 *
 * NFR-7 rules out predictions entirely ("Never: predictions, guarantees, 'will
 * rise'"), and there is no endpoint that would make one. The guidance strings
 * are written in that register, so nothing here can accidentally promise a
 * price.
 *
 * ## Freshness on this surface is never `live`
 *
 * The market endpoints only ever answer `historical` or `cached` — the seeded
 * data is archived Agmarknet reporting, labelled ● Historical. The banner says
 * so in words as well as by dot, because a price a farmer might act on is
 * exactly where an implied "today's rate" would do damage.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { formatDayMonth, formatNumber, formatPercent } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { Freshness, MarketSignal, PriceSeriesResponse } from '@shared/types/api';

import { marketApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { PriceSparkline } from '../../components/domain/PriceSparkline';
import { SpeakButton, WhyTrace } from '../../components/domain/WhyTrace';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { FreshnessDot } from '../../components/ui/FreshnessDot';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Select } from '../../components/ui/Select';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { IconTrendDown, IconTrendFlat, IconTrendUp } from '../../components/ui/icons';
import { useCropNames } from '../../hooks/useCropNames';
import { translateMessageKey } from '../../i18n/messageKey';
import type { MarketStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';

export const MARKET_RANGES = [30, 60, 90] as const;
export type MarketRange = (typeof MARKET_RANGES)[number];

const TREND_ICON = {
  RISING: IconTrendUp,
  FALLING: IconTrendDown,
  STABLE: IconTrendFlat,
} as const;

export function CommodityDetailScreen() {
  const { t } = useTranslation(['market', 'common']);
  const route = useRoute<RouteProp<MarketStackParamList, 'CommodityDetail'>>();
  const commodityLabel = useCropNames();

  const { commodity, state, district } = route.params;
  const [days, setDays] = useState<MarketRange>(30);

  const query = useQuery({
    queryKey: queryKeys.market.prices(commodity, state, district, days),
    queryFn: () =>
      marketApi.prices({
        commodity,
        ...(state ? { state } : {}),
        ...(district ? { district } : {}),
        days,
      }),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <Screen
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID="commodity-detail"
    >
      <SectionHeader title={commodityLabel(commodity)} description={t('market:neverPredicts')} />

      <RangeSelect days={days} onChange={setDays} />

      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {(prices) => (
          <View style={styles.stack}>
            {prices.freshness.status === 'historical' ? (
              <Notice tone="warning" testID="market-historical">
                <Text variant="small" color="ink700">
                  {t('market:sourceHistorical')}
                </Text>
              </Notice>
            ) : null}

            {/* The sentence first, then the evidence. */}
            <MarketSignalCard
              signal={prices.signal}
              freshness={prices.freshness}
              district={district ?? null}
            />

            <PriceSparkline series={prices.series} days={days} />

            <View style={styles.section}>
              <SectionHeader title={t('market:compareHeading')} />
              <MandiList prices={prices} />
            </View>
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

export function RangeSelect({
  days,
  onChange,
}: {
  days: MarketRange;
  onChange: (days: MarketRange) => void;
}) {
  const { t } = useTranslation('market');

  return (
    <Select
      label={t('rangeLabel')}
      value={String(days)}
      onChange={(value) => onChange(Number(value) as MarketRange)}
      options={MARKET_RANGES.map((range) => ({
        value: String(range),
        label: t(`range${range}`),
      }))}
      testID="market-range"
    />
  );
}

/**
 * The market verdict.
 *
 * `trend` is null when there were no observations at all. There is no
 * `market.titlenull` key and there should not be one: "we cannot describe a
 * trend" is a different statement from "prices are steady", and the engine is
 * careful to distinguish them — the guidance key it sends in that case is
 * already `market.guidanceUnavailable`.
 */
export function MarketSignalCard({
  signal,
  freshness,
  district,
  title,
}: {
  signal: MarketSignal;
  freshness: Freshness;
  district?: string | null;
  title?: string;
}) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  const Icon = signal.trend ? (TREND_ICON[signal.trend] ?? IconTrendFlat) : IconTrendFlat;
  const headline = signal.trend ? t(`market:title${signal.trend}`) : t('market:noSignal');

  const guidance = translateMessageKey(t, signal.guidanceKey, {
    pct: Math.abs(signal.changePct7d ?? 0).toFixed(1),
    district: district ?? '',
    modal: '',
  });

  return (
    <Card testID="market-signal">
      <View style={styles.signalBody}>
        <View style={styles.signalHead}>
          <View style={styles.signalTitle}>
            <Icon size={22} color={colors.ink900} />
            <Text variant="heading" style={styles.flexText}>
              {title ?? headline}
            </Text>
          </View>
          <SpeakButton text={`${headline}. ${guidance}`} />
        </View>

        {/* The sentence, before any number or chart. */}
        <Text variant="body" color="ink700">
          {guidance}
        </Text>

        <View style={styles.chips}>
          {title ? <Badge tone="neutral">{headline}</Badge> : null}
          {signal.changePct7d != null ? (
            <Badge>{`${t('market:change7d')}: ${formatPercent(signal.changePct7d, language)}`}</Badge>
          ) : null}
          {signal.changePct30d != null ? (
            <Badge>{`${t('market:change30d')}: ${formatPercent(signal.changePct30d, language)}`}</Badge>
          ) : null}
        </View>

        {/*
          A 7-day move that contradicts the 30-day trend is exactly the case
          where acting on the short window is most likely to be wrong.
        */}
        {signal.momentumDiverges ? (
          <Notice tone="warning" testID="market-momentum">
            <Text variant="small" color="ink700">
              {t('market:momentumNote')}
            </Text>
          </Notice>
        ) : null}

        <FreshnessDot
          status={freshness.status}
          latestDate={freshness.latestDate}
          fetchedAt={freshness.fetchedAt}
        />

        <WhyTrace trace={signal.trace} />
      </View>
    </Card>
  );
}

/**
 * The most recent report per mandi, dearest first.
 *
 * An `adjusted` row is one whose published modal price fell outside its own
 * day's min–max range and was clamped to the nearest bound by the ingest
 * normalizer. It is flagged rather than shown as though it were published
 * as-is (rule 9).
 */
function MandiList({ prices }: { prices: PriceSeriesResponse }) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  const latestPerMandi = new Map<string, PriceSeriesResponse['series'][number]>();
  for (const row of prices.series) {
    const existing = latestPerMandi.get(row.market);
    if (!existing || row.date > existing.date) latestPerMandi.set(row.market, row);
  }

  const rows = [...latestPerMandi.values()].sort((a, b) => b.modalPrice - a.modalPrice);
  if (rows.length === 0) return <EmptyState title={t('market:emptySeries')} />;

  return (
    <View style={styles.list} testID="mandi-list">
      {rows.map((row) => (
        <Card key={row.market}>
          <View style={styles.mandiBody}>
            <View style={styles.mandiHead}>
              <Text variant="bodyStrong" style={styles.flexText}>
                {row.market}
              </Text>
              <Text variant="bodyStrong" color="brand600">
                {t('common:unit.rupeesPerQuintal', {
                  value: formatNumber(row.modalPrice, language, { maximumFractionDigits: 0 }),
                })}
              </Text>
            </View>

            <Text variant="caption" color="ink500">
              {`${t('market:minColumn')} ${formatNumber(row.minPrice, language, { maximumFractionDigits: 0 })} · ${t('market:maxColumn')} ${formatNumber(row.maxPrice, language, { maximumFractionDigits: 0 })} · ${formatDayMonth(row.date, language)}`}
            </Text>

            {row.adjusted ? (
              <Text variant="caption" color="ink500" testID="mandi-adjusted">
                {t('market:priceAdjusted')}
              </Text>
            ) : null}
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  section: { gap: spacing.md },
  list: { gap: spacing.md },
  signalBody: { gap: spacing.md },
  signalHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  signalTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexText: { flexShrink: 1 },
  mandiBody: { gap: spacing.xs },
  mandiHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
