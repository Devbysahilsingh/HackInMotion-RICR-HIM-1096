/**
 * The weather over one field.
 *
 * **Risks first.** What the sky means for the crops outranks the raw numbers,
 * so the crop-scoped verdicts sit above the forecast strip and "no risks" is
 * said just as plainly. The web made this same correction; this follows it.
 *
 * ## The pending branch is a designed 200, not an error
 *
 * The request path never calls a weather provider (rule 3), so a location with
 * no snapshot yet answers `freshness.status: 'pending'` with a `reason` of
 * `awaiting_first_fetch` or `no_coordinates`. That is "we have not fetched this
 * cell yet" — a real, temporary, *non-failing* state with its own copy and its
 * own way forward. Rendering it as an error would tell a farmer something is
 * broken when nothing is.
 *
 * ## thresholdSource
 *
 * A risk is assessed against either the crop's published threshold
 * (`REGISTRY`) or the engine's generic fallback (`ENGINE_DEFAULT`). The second
 * is labelled, because showing a generic threshold as though it were
 * crop-specific would imply a precision the registry does not have.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { formatDayMonth, formatNumber } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { RiskLevel, WeatherDay, WeatherRisk } from '@shared/types/api';

import { farmsApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { SpeakButton } from '../../components/domain/WhyTrace';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { FreshnessDot } from '../../components/ui/FreshnessDot';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { IconCloud, IconDroplet } from '../../components/ui/icons';
import { useCropNames } from '../../hooks/useCropNames';
import { translateMessageKey } from '../../i18n/messageKey';
import type { FarmStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, radius, spacing } from '../../theme';

/** Most urgent first. Presentation only — the engine assigns the levels. */
const LEVEL_RANK: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const RISK_TINT: Record<RiskLevel, { fill: string; border: string }> = {
  CRITICAL: { fill: colors.priorityCriticalSoft, border: colors.priorityCritical },
  HIGH: { fill: colors.priorityHighSoft, border: colors.priorityHigh },
  MEDIUM: { fill: colors.priorityMediumSoft, border: colors.priorityMedium },
  LOW: { fill: colors.surface, border: colors.line },
};

export function WeatherScreen() {
  const { t } = useTranslation(['weather', 'common']);
  const { language } = useLanguage();
  const route = useRoute<RouteProp<FarmStackParamList, 'Weather'>>();
  const { farmId } = route.params;

  const query = useQuery({
    queryKey: queryKeys.farms.weather(farmId),
    queryFn: () => farmsApi.weather(farmId),
    enabled: Boolean(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  // Which field's sky is this? Cache-served on the common path.
  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });
  const farm = farmsQuery.data?.farms.find((entry) => entry.id === farmId) ?? null;

  return (
    <Screen
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID="weather-screen"
    >
      {farm ? (
        <Text variant="small" color="ink500">
          {[farm.name, farm.location.district, farm.location.state].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {(weather) =>
          weather.freshness.status === 'pending' ? (
            <Notice tone="warning" testID="weather-pending">
              <Text variant="small" color="ink700">
                {weather.freshness.reason === 'no_coordinates'
                  ? t('weather:pendingNoCoordinates')
                  : t('weather:pendingBody')}
              </Text>
            </Notice>
          ) : (
            <View style={styles.stack}>
              <FreshnessDot
                status={weather.freshness.status}
                fetchedAt={weather.freshness.fetchedAt}
                ageHours={weather.freshness.ageHours}
                staleWarning={weather.freshness.staleWarning}
              />

              <View style={styles.section}>
                <SectionHeader title={t('weather:risksHeading')} />
                {weather.risks.length === 0 ? (
                  <EmptyState
                    title={t('weather:noRisks')}
                    icon={<IconCloud size={32} color={colors.brand500} />}
                  />
                ) : (
                  <View style={styles.list} testID="risk-list">
                    {[...weather.risks]
                      .sort(
                        (a, b) =>
                          LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.daysAhead - b.daysAhead,
                      )
                      .map((risk, index) => (
                        <RiskCard key={`${risk.cropId}-${risk.type}-${index}`} risk={risk} />
                      ))}
                  </View>
                )}
              </View>

              <View style={styles.section}>
                <SectionHeader title={t('weather:forecastHeading')} />
                <ForecastStrip daily={weather.daily} />
              </View>

              <View style={styles.section}>
                <SectionHeader title={t('weather:temperature')} />
                {forecastDays(weather.daily).map((day, index) => (
                  <DayDetail key={day.date} day={day} isToday={index === 0} language={language} />
                ))}
              </View>
            </View>
          )
        }
      </QueryBoundary>
    </Screen>
  );
}

/**
 * A crop-scoped weather risk.
 *
 * Title and body come from `weather.title{TYPE}` / `weather.body{TYPE}` with
 * the risk's own `data` as parameters, so the numbers in the sentence are the
 * numbers the engine actually compared against a threshold.
 */
function RiskCard({ risk }: { risk: WeatherRisk }) {
  const { t } = useTranslation(['weather', 'agri', 'common']);
  const cropName = useCropNames();

  const tint = RISK_TINT[risk.level] ?? RISK_TINT.LOW;
  const title = translateMessageKey(t, `weather.title${risk.type}`, risk.data);
  const body = translateMessageKey(t, `weather.body${risk.type}`, risk.data);
  const when =
    risk.daysAhead === 0 ? t('weather:today') : t('weather:daysAhead', { days: risk.daysAhead });

  return (
    <Card
      style={[styles.riskCard, { backgroundColor: tint.fill, borderColor: tint.border }]}
      testID="risk-card"
    >
      <View style={styles.riskBody}>
        <View style={styles.riskHead}>
          <View style={styles.riskTitle}>
            <IconCloud size={20} color={colors.ink900} />
            <Text variant="subheading" style={styles.flexText}>
              {title}
            </Text>
          </View>
          <SpeakButton text={`${title}. ${body}`} />
        </View>

        <View style={styles.chips}>
          <Badge tone={risk.level === 'LOW' ? 'neutral' : 'warn'}>
            {t(`agri:risk.${risk.level}`)}
          </Badge>
          <Badge tone="neutral">{when}</Badge>
          <Badge tone="brand">{cropName(risk.cropCode)}</Badge>
        </View>

        <Text variant="body" color="ink700">
          {body}
        </Text>

        {risk.thresholdSource === 'ENGINE_DEFAULT' ? (
          <Text variant="caption" color="ink500" testID="risk-threshold-default">
            {t('weather:thresholdDefault')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * The seven-day strip.
 *
 * Only forecast days are shown — the snapshot also carries the past week, which
 * the irrigation ledger needs but a farmer looking at "what is coming" does
 * not. Missing values render as an em dash rather than a zero: a provider that
 * did not report humidity has not reported 0% humidity.
 */
function ForecastStrip({ daily }: { daily: WeatherDay[] }) {
  const { t } = useTranslation(['weather', 'common']);
  const { language } = useLanguage();

  const forecast = forecastDays(daily);
  if (forecast.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      testID="forecast-strip"
    >
      {forecast.map((day, index) => (
        <View key={day.date} style={styles.stripCell}>
          <Text variant="caption" color="ink500" align="center">
            {index === 0 ? t('weather:today') : formatDayMonth(day.date, language)}
          </Text>
          <Text variant="bodyStrong" align="center">
            {day.tMaxC != null && day.tMinC != null
              ? t('weather:tempRange', {
                  min: formatNumber(day.tMinC, language, { maximumFractionDigits: 0 }),
                  max: formatNumber(day.tMaxC, language, { maximumFractionDigits: 0 }),
                })
              : '—'}
          </Text>
          <View style={styles.stripRain}>
            <IconDroplet size={14} color={colors.ink500} />
            <Text variant="caption" color="ink500">
              {day.rainMm != null
                ? `${formatNumber(day.rainMm, language, { maximumFractionDigits: 1 })} ${t('common:unit.mm')}`
                : '—'}
            </Text>
          </View>
          <Text variant="caption" color="ink500" align="center">
            {day.rainProbPct != null
              ? `${formatNumber(day.rainProbPct, language, { maximumFractionDigits: 0 })}${t('common:unit.percent')}`
              : '—'}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function DayDetail({
  day,
  isToday,
  language,
}: {
  day: WeatherDay;
  isToday: boolean;
  language: Parameters<typeof formatNumber>[1];
}) {
  const { t } = useTranslation(['weather', 'common']);

  const rows: { label: string; value: string }[] = [
    {
      label: t('weather:tempMin'),
      value: unit(day.tMinC, language, t('common:unit.celsius'), 0),
    },
    {
      label: t('weather:tempMax'),
      value: unit(day.tMaxC, language, t('common:unit.celsius'), 0),
    },
    { label: t('weather:rain'), value: unit(day.rainMm, language, t('common:unit.mm'), 1) },
    {
      label: t('weather:rainChance'),
      value: unit(day.rainProbPct, language, t('common:unit.percent'), 0),
    },
    {
      label: t('weather:humidity'),
      value: unit(day.humidityPct, language, t('common:unit.percent'), 0),
    },
    { label: t('weather:wind'), value: unit(day.windKmh, language, t('common:unit.kmh'), 0) },
  ];

  return (
    <Card>
      <View style={styles.dayBody}>
        <Text variant="bodyStrong">
          {isToday ? t('weather:today') : formatDayMonth(day.date, language)}
        </Text>
        {rows.map((row) => (
          <View key={row.label} style={styles.dayRow}>
            <Text variant="small" color="ink500" style={styles.flexText}>
              {row.label}
            </Text>
            <Text variant="small" color="ink900">
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** A missing reading is an em dash, never a zero and never a unit on nothing. */
function unit(
  value: number | null,
  language: Parameters<typeof formatNumber>[1],
  suffix: string,
  digits: number,
): string {
  if (value == null) return '—';
  return `${formatNumber(value, language, { maximumFractionDigits: digits })} ${suffix}`;
}

function forecastDays(daily: WeatherDay[]): WeatherDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return daily
    .filter((day) => {
      const date = new Date(day.date);
      date.setHours(0, 0, 0, 0);
      return date >= today;
    })
    .slice(0, 7);
}

const styles = StyleSheet.create({
  stack: { gap: spacing.xl },
  section: { gap: spacing.md },
  list: { gap: spacing.md },
  riskCard: { borderWidth: 1 },
  riskBody: { gap: spacing.sm },
  riskHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  riskTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexText: { flexShrink: 1 },
  strip: { gap: spacing.sm, paddingBottom: spacing.xs },
  stripCell: {
    width: 108,
    gap: spacing.xs,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  stripRain: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dayBody: { gap: spacing.xs },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
