import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { communityApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CommunityAlert } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { DiseaseName } from '@/components/domain/DiseaseName';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconLocation, IconUsers } from '@/components/ui/icons';
import { useCropNames } from '@/hooks/useCropNames';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth } from '@/lib/format';

/**
 * District outbreak advisories.
 *
 * With no filter the API answers for the districts the caller actually farms
 * in, derived from their own farms — so this page needs no location picker and
 * asks for nothing.
 *
 * **There is no write API and no "report this" button**, deliberately
 * (docs/community/community-alerts.md: "No write API — aggregation only"). The
 * only writer is a six-hourly job that counts distinct farmers above a
 * confidence floor, which is what makes the ≥3-farmer threshold impossible to
 * game from a browser. Adding a report control here would quietly undo that.
 */
export default function CommunityPage() {
  const { t } = useTranslation(['community', 'common']);

  const query = useQuery({
    queryKey: queryKeys.community.alerts(undefined, undefined),
    queryFn: () => communityApi.alerts(),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <>
      <PageHeader title={t('community:pageTitle')} />

      <div className="space-y-4">
        {/* The privacy guarantee, on the page it applies to. */}
        <Notice tone="info" data-testid="community-privacy">
          {t('community:privacyNote')}
        </Notice>

        <QueryBoundary
          query={query}
          loading={<SkeletonList />}
          isEmpty={(data) => data.alerts.length === 0}
          empty={<EmptyState title={t('community:empty')} icon={<IconUsers size={32} />} />}
        >
          {(data) => (
            <ul className="space-y-3" data-testid="community-alerts">
              {data.alerts.map((alert, index) => (
                <li key={`${alert.district}-${alert.diseaseCode}-${index}`}>
                  <AlertCard alert={alert} />
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </div>
    </>
  );
}

function AlertCard({ alert }: { alert: CommunityAlert }) {
  const { t } = useTranslation(['community', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  return (
    <Card data-testid="community-alert" data-level={alert.level}>
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={alert.level === 'HIGH' ? 'danger' : 'neutral'}>
            {t(`common:priority.${alert.level === 'HIGH' ? 'HIGH' : 'INFO'}`)}
          </Badge>
          <h2 className="text-base font-semibold">
            <DiseaseName code={alert.diseaseCode} cropCode={alert.cropCode} showFallbackNote />
          </h2>
        </div>

        <p className="text-sm text-ink-700">
          {t('community:reportCount', { count: alert.reportCount })}
        </p>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
          <span className="flex items-center gap-1">
            <IconLocation size={13} aria-hidden="true" />
            {alert.district}, {alert.state}
          </span>
          <span>{cropName(alert.cropCode)}</span>
          <span>
            {t('community:windowLabel', {
              start: formatDayMonth(alert.windowStart, language),
              end: formatDayMonth(alert.windowEnd, language),
            })}
          </span>
        </p>
      </div>
    </Card>
  );
}
