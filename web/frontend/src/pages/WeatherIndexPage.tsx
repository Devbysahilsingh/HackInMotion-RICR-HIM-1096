import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';

import { farmsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { QueryBoundary } from '@/components/QueryBoundary';
import { PageHeader } from '@/components/layout/AppLayout';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonList } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/states';
import { IconChevronRight, IconCloud, IconPlus } from '@/components/ui/icons';

/**
 * The top-level Weather entry.
 *
 * Weather is farm-scoped — a forecast belongs to a field, not to an account —
 * but "Weather" still deserves a place in the primary navigation
 * (`/farms/:farmId/weather` used to be reachable only through a farm's detail
 * page, which made the single most-asked farmer question two screens deep).
 *
 * One farm: straight to that farm's weather, no pointless picker. Several:
 * pick the field. None: the same guidance every other screen gives.
 */
export default function WeatherIndexPage() {
  const { t } = useTranslation(['weather', 'farm', 'common']);

  const query = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <>
      <PageHeader title={t('weather:pageTitle')} />

      <QueryBoundary
        query={query}
        loading={<SkeletonList count={3} />}
        isEmpty={(data) => data.farms.length === 0}
        empty={
          <EmptyState
            title={t('farm:listEmpty')}
            icon={<IconCloud size={32} />}
            action={
              <ButtonLink to="/farms/new" leadingIcon={<IconPlus size={18} />}>
                {t('farm:listEmptyCta')}
              </ButtonLink>
            }
          />
        }
      >
        {(data) =>
          data.farms.length === 1 ? (
            <Navigate to={`/farms/${data.farms[0]!.id}/weather`} replace />
          ) : (
            <ul className="space-y-3" data-testid="weather-farm-list">
              {data.farms.map((farm) => (
                <li key={farm.id}>
                  <Link
                    to={`/farms/${farm.id}/weather`}
                    className="block rounded-xl focus-visible:outline-none"
                  >
                    <Card className="flex items-center justify-between gap-3 p-4 hover:bg-canvas">
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold">{farm.name}</span>
                        <span className="block truncate text-sm text-ink-500">
                          {[farm.location.village, farm.location.district, farm.location.state]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </span>
                      <IconChevronRight size={18} aria-hidden="true" />
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </QueryBoundary>
    </>
  );
}
