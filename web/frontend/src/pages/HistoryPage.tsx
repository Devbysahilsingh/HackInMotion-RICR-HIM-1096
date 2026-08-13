import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { healthApi, recommendationsApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import { QueryBoundary } from '@/components/QueryBoundary';
import { HealthLogList } from '@/components/domain/HealthLogList';
import { WhyTrace } from '@/components/domain/WhyTrace';
import { localizeCropParams, useCropNames } from '@/hooks/useCropNames';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PriorityChip } from '@/components/ui/PriorityChip';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/states';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatDateTime } from '@/lib/format';

type HistoryTab = 'advice' | 'scans';

/**
 * The record of what the platform has told this farmer, and what they sent it.
 *
 * Acknowledged and expired advice is included — `GET /recommendations` serves
 * "full history incl. acknowledged/expired", and a history that quietly
 * dropped the items a farmer had already dealt with would be a worse record
 * than none.
 */
export default function HistoryPage() {
  const { t } = useTranslation(['common', 'health']);
  const [tab, setTab] = useState<HistoryTab>('advice');

  return (
    <>
      <PageHeader title={t('common:nav.history')} />

      <Tabs
        label={t('common:nav.history')}
        value={tab}
        onChange={setTab}
        items={[
          { value: 'advice', label: t('common:history.advice') },
          { value: 'scans', label: t('health:historyHeading') },
        ]}
      />

      <TabPanel id={`history-${tab}-panel`}>
        {tab === 'advice' ? <AdviceHistory /> : <ScanHistory />}
      </TabPanel>
    </>
  );
}

function AdviceHistory() {
  const { t } = useTranslation(['common', 'irrigation', 'weather', 'market', 'health']);
  const { language } = useLanguage();
  const cropName = useCropNames();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: queryKeys.recommendations.history(page),
    queryFn: () => recommendationsApi.history({ page, limit: 20 }),
  });

  return (
    <QueryBoundary
      query={query}
      loading={<SkeletonList />}
      isEmpty={(data) => data.data.recommendations.length === 0}
      empty={<EmptyState title={t('common:state.empty')} />}
    >
      {(data) => {
        const total = data.meta.total;
        // A missing total must not dead-end the pagination: a full page is
        // read as "there may be more", an under-full one as the end.
        const hasMore = total != null ? page * 20 < total : data.data.recommendations.length === 20;

        return (
          <div className="space-y-3" data-testid="advice-history">
            {data.data.recommendations.map((item) => {
              const params = localizeCropParams(item.data, cropName);
              const title = translateMessageKey(t, item.titleKey, params);
              const body = translateMessageKey(t, item.bodyKey, params);
              const trace = Array.isArray(item.data?.trace) ? item.data.trace : null;

              return (
                <Card key={item.id}>
                  <div className="space-y-2.5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <PriorityChip priority={item.priority} />
                      {item.acknowledgedAt && (
                        <Badge tone="success">{t('common:action.done')}</Badge>
                      )}
                      <span className="ml-auto text-xs text-ink-500">
                        {formatDateTime(item.createdAt, language)}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold">{title}</h3>
                    <p className="text-sm text-ink-700">{body}</p>
                    <WhyTrace trace={trace} />
                  </div>
                </Card>
              );
            })}

            <div className="flex justify-between gap-2 pt-2">
              <Button
                variant="secondary"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('common:action.back')}
              </Button>
              <Button
                variant="secondary"
                disabled={!hasMore}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('common:action.next')}
              </Button>
            </div>
          </div>
        );
      }}
    </QueryBoundary>
  );
}

function ScanHistory() {
  const { t } = useTranslation('health');

  const query = useQuery({
    queryKey: queryKeys.health.logs(undefined, 1),
    queryFn: () => healthApi.logs({ page: 1, limit: 20 }),
  });

  return (
    <QueryBoundary
      query={query}
      loading={<SkeletonList />}
      isEmpty={(data) => data.data.logs.length === 0}
      empty={<EmptyState title={t('historyEmpty')} />}
    >
      {(data) => <HealthLogList logs={data.data.logs} />}
    </QueryBoundary>
  );
}
