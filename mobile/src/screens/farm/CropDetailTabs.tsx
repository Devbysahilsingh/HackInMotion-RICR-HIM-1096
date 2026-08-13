/**
 * The four decisions a farmer makes about one crop, as tabs.
 *
 * This is the *body* of the crop detail screen, not the screen: the header, the
 * stage block and the edit/delete controls belong to `CropDetailScreen`, which
 * renders this beneath them. Splitting it here keeps four independent data
 * fetches — each with its own loading, empty and error state — out of a screen
 * whose own job is the crop record.
 *
 * Only the visible tab fetches. A crop detail that fired four requests on open
 * would be four times the round trips on a connection that has none to spare,
 * for three answers nobody has asked for yet.
 *
 * Tab order is by how often the question is asked: water today, is it sick,
 * feed it, what is it worth.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatDate, formatDayMonth, formatNumber, localizedName } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { CropWithStage, HealthLogSummary, SeverityLevel } from '@shared/types/api';

import { cropsApi, healthApi, marketApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { FertilizerGuidanceView } from '../../components/domain/FertilizerGuidanceView';
import { IrrigationVerdictCard } from '../../components/domain/IrrigationVerdictCard';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Select } from '../../components/ui/Select';
import { SkeletonCard, SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { IconCamera, IconChevronRight, IconDroplet } from '../../components/ui/icons';
import { useApiErrorMessage } from '../../hooks/useApiError';
import { translateMessageKey } from '../../i18n/messageKey';
import type { CropDetailTab, RootStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { PRESSED_OPACITY, TOUCH_TARGET, colors, radius, spacing } from '../../theme';
import { MarketSignalCard } from '../market/CommodityDetailScreen';

/**
 * The runtime order of the tabs. The *union* lives in `navigation/types.ts`,
 * because a feed item can deep-link to a tab and the param list has to name
 * them — declaring it twice invited the two copies to drift apart.
 *
 * `satisfies` proves every entry here is a real tab, and `TAB_LABEL_KEY` below
 * being a total `Record` proves none is missing: adding a tab to the union
 * without adding it here is a compile error.
 */
export const CROP_DETAIL_TABS = [
  'irrigation',
  'health',
  'fertilizer',
  'market',
] as const satisfies readonly CropDetailTab[];

const TAB_LABEL_KEY: Record<CropDetailTab, string> = {
  irrigation: 'crop:tabIrrigation',
  health: 'crop:tabHealth',
  fertilizer: 'crop:tabFertilizer',
  market: 'crop:tabMarket',
};

export interface CropDetailTabsProps {
  crop: CropWithStage;
  initialTab?: CropDetailTab;
}

export function CropDetailTabs({ crop, initialTab = 'irrigation' }: CropDetailTabsProps) {
  const { t } = useTranslation(['crop', 'common']);
  const [tab, setTab] = useState<CropDetailTab>(initialTab);

  return (
    <View style={styles.stack}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBar}
        accessibilityRole="tablist"
      >
        {CROP_DETAIL_TABS.map((entry) => {
          const selected = entry === tab;
          return (
            <Pressable
              key={entry}
              onPress={() => setTab(entry)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              testID={`crop-tab-${entry}`}
              style={({ pressed }) => [
                styles.tab,
                selected && styles.tabSelected,
                pressed && { opacity: PRESSED_OPACITY },
              ]}
            >
              <Text
                variant={selected ? 'bodyStrong' : 'body'}
                color={selected ? 'brand600' : 'ink700'}
              >
                {t(TAB_LABEL_KEY[entry])}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {tab === 'irrigation' ? <IrrigationTab cropId={crop.id} /> : null}
      {tab === 'health' ? <HealthTab cropId={crop.id} /> : null}
      {tab === 'fertilizer' ? <FertilizerTab cropId={crop.id} /> : null}
      {tab === 'market' ? <MarketTab cropCode={crop.cropCode} /> : null}
    </View>
  );
}

// ── Irrigation ──────────────────────────────────────────────────────────────

function IrrigationTab({ cropId }: { cropId: string }) {
  const { t } = useTranslation(['irrigation', 'common']);
  const { language } = useLanguage();
  const [logging, setLogging] = useState(false);

  const adviceQuery = useQuery({
    queryKey: queryKeys.crops.irrigation(cropId),
    queryFn: () => cropsApi.irrigation(cropId),
    staleTime: STALE_TIME.interactive,
  });

  const ledgerQuery = useQuery({
    queryKey: queryKeys.crops.irrigationLedger(cropId, 1),
    queryFn: () => cropsApi.irrigationLedger(cropId, { page: 1 }),
    staleTime: STALE_TIME.interactive,
  });

  return (
    <View style={styles.stack}>
      <QueryBoundary query={adviceQuery} loading={<SkeletonCard />}>
        {(advice) => (
          <IrrigationVerdictCard
            advice={advice}
            action={
              <Button
                variant="secondary"
                fullWidth
                onPress={() => setLogging((current) => !current)}
                leadingIcon={<IconDroplet size={18} color={colors.brand600} />}
                testID="irrigation-log-toggle"
              >
                {t('irrigation:logCta')}
              </Button>
            }
          />
        )}
      </QueryBoundary>

      {logging ? <IrrigationLogForm cropId={cropId} onDone={() => setLogging(false)} /> : null}

      <View style={styles.section}>
        <SectionHeader title={t('irrigation:ledgerHeading')} />
        <QueryBoundary
          query={ledgerQuery}
          loading={<SkeletonList count={2} />}
          isEmpty={(data) => data.data.logs.length === 0}
          empty={<EmptyState title={t('irrigation:ledgerEmpty')} />}
        >
          {(data) => (
            <View style={styles.list} testID="irrigation-ledger">
              {data.data.logs.map((entry) => (
                <Card key={entry.id}>
                  <View style={styles.ledgerRow}>
                    <Text variant="body">{formatDate(entry.date, language)}</Text>
                    <Text variant="bodyStrong">
                      {entry.amountMm == null
                        ? t('irrigation:logFullRefill')
                        : `${formatNumber(entry.amountMm, language, { maximumFractionDigits: 1 })} ${t('common:unit.mm')}`}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </QueryBoundary>
      </View>
    </View>
  );
}

/** How far back a watering can be recorded from this control. */
const LOG_DAYS_BACK = 7;

/**
 * Recording a watering.
 *
 * The date is a short list of recent days rather than a calendar: no date-picker
 * dependency is installed, a free-text ISO field is not something a farmer
 * should have to type, and a watering older than a week is not what this control
 * is for. An omitted amount means "refilled fully" — the engine's own R8 rule —
 * so the field is genuinely optional and says so.
 */
function IrrigationLogForm({ cropId, onDone }: { cropId: string; onDone: () => void }) {
  const { t } = useTranslation(['irrigation', 'common']);
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();

  const options = recentDays(LOG_DAYS_BACK).map((date, index) => ({
    value: toIsoDay(date),
    label:
      index === 0
        ? t('common:time.today')
        : index === 1
          ? t('common:time.yesterday')
          : formatDayMonth(date, language),
  }));

  const [date, setDate] = useState<string>(options[0]!.value);
  const [amount, setAmount] = useState('');

  const parsedAmount = amount.trim() === '' ? undefined : Number(amount.replace(',', '.'));
  const amountInvalid =
    parsedAmount !== undefined &&
    (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 200);

  const log = useMutation({
    mutationFn: () =>
      cropsApi.logIrrigation(cropId, {
        date,
        ...(parsedAmount !== undefined ? { amountMm: parsedAmount } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.irrigation(cropId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      onDone();
    },
  });

  return (
    <Card testID="irrigation-log-form">
      <View style={styles.section}>
        <Text variant="subheading" accessibilityRole="header">
          {t('irrigation:logTitle')}
        </Text>

        <Select
          label={t('irrigation:logDateLabel')}
          value={date}
          onChange={setDate}
          options={options}
          testID="irrigation-log-date"
        />

        <Input
          label={t('irrigation:logAmountLabel')}
          hint={t('irrigation:logAmountHint')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          error={amountInvalid ? t('common:validation.number') : undefined}
          testID="irrigation-log-amount"
        />

        {log.isError ? (
          <Notice tone="danger">
            <Text variant="small" color="ink700">
              {toMessage(log.error)}
            </Text>
          </Notice>
        ) : null}

        <View style={styles.formActions}>
          <Button variant="ghost" onPress={onDone} style={styles.formButton}>
            {t('common:action.cancel')}
          </Button>
          <Button
            onPress={() => log.mutate()}
            loading={log.isPending}
            disabled={amountInvalid}
            style={styles.formButton}
            testID="irrigation-log-submit"
          >
            {t('irrigation:logSubmit')}
          </Button>
        </View>
      </View>
    </Card>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────

const SEVERITY_KEY: Record<SeverityLevel, string> = {
  MILD: 'health:severityMild',
  MODERATE: 'health:severityModerate',
  SEVERE: 'health:severitySevere',
  NOT_ASSESSED: 'health:severityNotAssessed',
};

/**
 * Earlier photo checks for this crop.
 *
 * A summary row, not a diagnosis: the disease *name* lives in the registry
 * rather than on this projection, and the full reading — name, confidence
 * band, guidance, sources — is what the result screen exists to show. So each
 * row carries what the list projection actually has (when, which tier answered,
 * the engine's severity) and opens the real thing.
 */
function HealthTab({ cropId }: { cropId: string }) {
  const { t } = useTranslation(['health', 'common', 'mobile']);
  const { language } = useLanguage();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const query = useQuery({
    queryKey: queryKeys.health.logs(cropId, 1),
    queryFn: () => healthApi.logs({ cropId, page: 1 }),
    staleTime: STALE_TIME.interactive,
  });

  const scan = () =>
    navigation.navigate('Main', {
      screen: 'ScanTab',
      params: { screen: 'Camera', params: { cropId } },
    });

  return (
    <View style={styles.stack}>
      <Button
        fullWidth
        onPress={scan}
        leadingIcon={<IconCamera size={20} color={colors.surface} />}
        testID="health-scan-cta"
      >
        {t('common:nav.scan')}
      </Button>

      <QueryBoundary
        query={query}
        loading={<SkeletonList count={2} />}
        isEmpty={(data) => data.data.logs.length === 0}
        empty={<EmptyState title={t('health:historyEmpty')} />}
      >
        {(data) => (
          <View style={styles.list} testID="health-logs">
            {data.data.logs.map((log) => (
              <Card
                key={log.id}
                onPress={() =>
                  navigation.navigate('Main', {
                    screen: 'HomeTab',
                    params: { screen: 'HistoryDetail', params: { logId: log.id } },
                  })
                }
                accessibilityLabel={formatDate(log.createdAt, language)}
                testID="health-log-row"
              >
                <View style={styles.rowOuter}>
                  <View style={styles.rowMain}>
                    <Text variant="bodyStrong">{formatDate(log.createdAt, language)}</Text>
                    <HealthLogChips log={log} />
                  </View>
                  <IconChevronRight size={22} color={colors.ink500} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </QueryBoundary>
    </View>
  );
}

function HealthLogChips({ log }: { log: HealthLogSummary }) {
  const { t } = useTranslation(['health', 'common']);

  const severity = log.analysis.severityAssessment;

  return (
    <View style={styles.chips}>
      {/* Which tier answered — an AI-assisted reading is always labelled (rule 9). */}
      {log.analysis.sourceLabelKey ? (
        <Badge tone="neutral">{translateMessageKey(t, log.analysis.sourceLabelKey)}</Badge>
      ) : null}
      {severity ? (
        <Badge tone={severity === 'SEVERE' ? 'danger' : 'neutral'}>
          {t(SEVERITY_KEY[severity])}
        </Badge>
      ) : null}
    </View>
  );
}

// ── Fertilizer ──────────────────────────────────────────────────────────────

function FertilizerTab({ cropId }: { cropId: string }) {
  const query = useQuery({
    queryKey: queryKeys.crops.fertilizer(cropId),
    queryFn: () => cropsApi.fertilizer(cropId),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <QueryBoundary query={query} loading={<SkeletonCard />}>
      {(guidance) => <FertilizerGuidanceView guidance={guidance} />}
    </QueryBoundary>
  );
}

// ── Market ──────────────────────────────────────────────────────────────────

/**
 * The market view for this one crop.
 *
 * `/market/my-crops` is the only endpoint that maps a `cropCode` to the
 * `commodityCode` mandis actually report against — there is no per-crop market
 * route — so the answer is looked up in that list. A crop the mapping does not
 * cover says so plainly rather than showing an empty chart.
 */
function MarketTab({ cropCode }: { cropCode: string }) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const query = useQuery({
    queryKey: queryKeys.market.myCrops(30),
    queryFn: () => marketApi.myCrops({ days: 30 }),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <QueryBoundary query={query} loading={<SkeletonCard />}>
      {(data) => {
        const entry = data.data.crops.find((crop) => crop.cropCode === cropCode);
        if (!entry) return <EmptyState title={t('market:commodityNotFound')} />;

        return (
          <View style={styles.stack}>
            <MarketSignalCard
              signal={entry.signal}
              freshness={entry.freshness}
              district={entry.district}
              title={localizedName(entry.names, language)?.text ?? entry.cropCode}
            />

            <Button
              variant="secondary"
              fullWidth
              onPress={() =>
                navigation.navigate('Main', {
                  screen: 'MarketTab',
                  params: {
                    screen: 'CommodityDetail',
                    params: {
                      commodity: entry.commodityCode,
                      ...(entry.state ? { state: entry.state } : {}),
                      ...(entry.district ? { district: entry.district } : {}),
                    },
                  },
                })
              }
              testID="crop-market-detail"
            >
              {t('common:action.viewAll')}
            </Button>
          </View>
        );
      }}
    </QueryBoundary>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function recentDays(count: number): Date[] {
  const days: Date[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    days.push(date);
  }
  return days;
}

/** A calendar day the server can parse, unaffected by the device's timezone. */
function toIsoDay(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  section: { gap: spacing.md },
  list: { gap: spacing.md },
  tabBar: { gap: spacing.sm, paddingBottom: spacing.xs },
  tab: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  tabSelected: { backgroundColor: colors.brand50, borderColor: colors.brand300 },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  formActions: { flexDirection: 'row', gap: spacing.md },
  formButton: { flex: 1 },
  rowOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowMain: { flex: 1, gap: spacing.sm, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
