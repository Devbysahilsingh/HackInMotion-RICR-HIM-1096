/**
 * The answer.
 *
 * Thin on purpose: everything the farmer reads lives in `AnalysisResultView`,
 * so the history screen can mount the identical result with its own
 * destinations rather than growing a second, drifting copy of it.
 *
 * The log is read through React Query even though `AnalyzingScreen` has just
 * seeded the cache with it. That seed makes the first paint instant; the query
 * is what makes the screen correct on a cold open from history, and what picks
 * up the re-assessed severity after the follow-up form invalidates it.
 */
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { queryKeys } from '@shared/client/queryKeys';

import { healthApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { AnalysisResultView } from '../../components/domain/AnalysisResultView';
import { Screen } from '../../components/ui/Screen';
import { SkeletonCard } from '../../components/ui/Skeleton';
import type { MainTabsParamList, ScanStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ScanStackParamList, 'AnalysisResult'>;

export function AnalysisResultScreen({ navigation, route }: Props) {
  const { logId } = route.params;
  const { t } = useTranslation('common');

  const query = useQuery({
    queryKey: queryKeys.health.log(logId),
    queryFn: () => healthApi.log(logId),
    enabled: Boolean(logId),
  });

  return (
    <Screen
      scroll
      edges={['left', 'right']}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID="analysis-result-screen"
    >
      <QueryBoundary query={query} loading={<SkeletonCard />} loadingLabel={t('state.loading')}>
        {({ log }) => (
          <AnalysisResultView
            log={log}
            // `replace` rather than `navigate`: a farmer taking a better photo
            // is redoing this check, not stacking a second one behind it.
            onRetake={() => navigation.replace('Camera', { cropId: log.cropId })}
            onSymptomCheck={() => navigation.navigate('SymptomChecklist', { cropId: log.cropId })}
            onHistory={() =>
              navigation
                .getParent<BottomTabNavigationProp<MainTabsParamList>>()
                ?.navigate('HomeTab', { screen: 'History' })
            }
          />
        )}
      </QueryBoundary>
    </Screen>
  );
}
