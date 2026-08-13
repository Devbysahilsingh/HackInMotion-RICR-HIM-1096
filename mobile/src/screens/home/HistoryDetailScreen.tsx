/**
 * One past photo check, in full.
 *
 * The result itself is rendered by `components/domain/AnalysisResultView` —
 * the same component the scan flow shows immediately after an analysis. There
 * is deliberately no second renderer here: "what we saw / what to do / where
 * this comes from" is a contract with the farmer, and two implementations of
 * it would drift, so a log opened from history must read exactly as it did the
 * day it was taken.
 *
 * `GET /crop-health/logs/:id` returns the full projection — recommendation,
 * escalation path, coverage notice and the `freshness` block. All of it,
 * including the honesty label on a cached analysis (CLAUDE.md rule 9), is
 * rendered by that component; this screen owns only the fetch and the five
 * states around it.
 *
 * `onRetake` / `onSymptomCheck` are deliberately not wired. Both belong to the
 * Scan stack in another tab, and a history screen that silently threw the
 * farmer into a different tab would break the back gesture they expect.
 */
import { useTranslation } from 'react-i18next';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@shared/client/queryKeys';
import type { HealthLog } from '@shared/types/api';

import { healthApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { AnalysisResultView } from '../../components/domain/AnalysisResultView';
import { Screen } from '../../components/ui/Screen';
import { SkeletonCard } from '../../components/ui/Skeleton';
import type { HomeStackParamList } from '../../navigation/types';

export function HistoryDetailScreen() {
  const { t } = useTranslation('common');
  const { params } = useRoute<RouteProp<HomeStackParamList, 'HistoryDetail'>>();

  const query = useQuery({
    queryKey: queryKeys.health.log(params.logId),
    queryFn: () => healthApi.log(params.logId),
  });

  return (
    <Screen testID="history-detail-screen">
      <QueryBoundary query={query} loading={<SkeletonCard />} loadingLabel={t('state.loading')}>
        {({ log }: { log: HealthLog }) => <AnalysisResultView log={log} />}
      </QueryBoundary>
    </Screen>
  );
}
