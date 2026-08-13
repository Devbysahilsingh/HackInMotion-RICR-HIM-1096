/**
 * District outbreak advisories.
 *
 * With no filter the API answers for the districts the caller actually farms
 * in, derived from their own farms — so this screen needs no location picker
 * and asks for nothing.
 *
 * **There is no write API and no "report this" button**, deliberately
 * (docs/community/community-alerts.md: "No write API — aggregation only"). The
 * only writer is a six-hourly job that counts distinct farmers above a
 * confidence floor, which is what makes the ≥3-farmer threshold impossible to
 * game from a handset. Adding a report control here would quietly undo that.
 */
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { formatDayMonth, localizedName } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { CommunityAlert, RegistryDisease } from '@shared/types/api';

import { communityApi, registryApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { IconLocation, IconUsers } from '../../components/ui/icons';
import { useCropNames } from '../../hooks/useCropNames';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';

export function CommunityScreen() {
  const { t } = useTranslation(['community', 'common']);

  const query = useQuery({
    queryKey: queryKeys.community.alerts(undefined, undefined),
    queryFn: () => communityApi.alerts(),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <Screen
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID="community-screen"
    >
      {/* The privacy guarantee, on the screen it applies to. */}
      <Notice tone="info" testID="community-privacy">
        <Text variant="small" color="ink700">
          {t('community:privacyNote')}
        </Text>
      </Notice>

      <QueryBoundary
        query={query}
        loading={<SkeletonList />}
        isEmpty={(data) => data.alerts.length === 0}
        empty={
          <EmptyState
            title={t('community:empty')}
            icon={<IconUsers size={32} color={colors.brand500} />}
          />
        }
      >
        {(data) => (
          <View style={styles.list} testID="community-alerts">
            {data.alerts.map((alert, index) => (
              <AlertCard key={`${alert.district}-${alert.diseaseCode}-${index}`} alert={alert} />
            ))}
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function AlertCard({ alert }: { alert: CommunityAlert }) {
  const { t } = useTranslation(['community', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  return (
    <Card testID="community-alert">
      <View style={styles.card}>
        <Badge tone={alert.level === 'HIGH' ? 'danger' : 'neutral'}>
          {t(`common:priority.${alert.level === 'HIGH' ? 'HIGH' : 'INFO'}`)}
        </Badge>

        <DiseaseName code={alert.diseaseCode} cropCode={alert.cropCode} />

        <Text variant="body" color="ink700">
          {t('community:reportCount', { count: alert.reportCount })}
        </Text>

        <View style={styles.metaRow}>
          <IconLocation size={14} color={colors.ink500} />
          <Text variant="caption" color="ink500">
            {[alert.district, alert.state].filter(Boolean).join(', ')}
          </Text>
        </View>

        <Text variant="caption" color="ink500">
          {cropName(alert.cropCode)}
        </Text>

        <Text variant="caption" color="ink500">
          {t('community:windowLabel', {
            start: formatDayMonth(alert.windowStart, language),
            end: formatDayMonth(alert.windowEnd, language),
          })}
        </Text>
      </View>
    </Card>
  );
}

/**
 * A disease's name, from the crop registry.
 *
 * The community API returns a `diseaseCode` and no name — names live in
 * `cropRegistry.diseases[].names`, which is a public read cached for a week.
 *
 * ## The Hindi gap, shown rather than papered over
 *
 * Every disease name in the registry has `hi: null` today: no Hindi-language
 * official source has been fetched, and rule 8 forbids translating an
 * agronomic term without one. So on a Hindi screen the English name appears
 * and is **labelled** as an unverified fallback, instead of quietly mixing
 * scripts as though it had been translated.
 */
function DiseaseName({ code, cropCode }: { code: string; cropCode: string }) {
  const { t } = useTranslation(['health', 'agri']);
  const { language } = useLanguage();

  const { data } = useQuery({
    queryKey: queryKeys.registry.crop(cropCode),
    queryFn: () => registryApi.get(cropCode),
    enabled: Boolean(cropCode) && Boolean(code) && code !== 'UNKNOWN',
    staleTime: STALE_TIME.registry,
    // A missing registry entry is not an error worth surfacing here: the code
    // itself is a usable last resort.
    retry: false,
  });

  if (!code || code === 'UNKNOWN') {
    return (
      <Text variant="subheading" accessibilityRole="header">
        {t('health:diseaseUnknownName')}
      </Text>
    );
  }

  const diseases = (data?.crop.diseases ?? []) as RegistryDisease[];
  const entry = diseases.find((disease) => disease.code === code);
  const name = localizedName(entry?.names ?? null, language);

  return (
    <View style={styles.diseaseName}>
      <Text variant="subheading" accessibilityRole="header">
        {name?.text ?? code}
      </Text>
      {name?.isFallback ? (
        <Text variant="caption" color="ink500">
          {t('agri:nameHindiMissing')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { gap: spacing.sm, alignItems: 'flex-start' },
  diseaseName: { gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
