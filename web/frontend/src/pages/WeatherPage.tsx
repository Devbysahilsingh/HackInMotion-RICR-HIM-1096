import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { farmsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { QueryBoundary } from '@/components/QueryBoundary';
import { RainfallChart, TemperatureChart } from '@/components/charts/WeatherCharts';
import { ForecastStrip, RiskList } from '@/components/domain/WeatherStrip';
import { PageHeader } from '@/components/layout/AppLayout';
import { Section } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState, Notice } from '@/components/ui/states';

export default function WeatherPage() {
  const { t } = useTranslation(['weather', 'common']);
  const { farmId = '' } = useParams();

  const query = useQuery({
    queryKey: queryKeys.farms.weather(farmId),
    queryFn: () => farmsApi.weather(farmId),
    enabled: Boolean(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  // Farm-context line — which field's sky is this? Cache-served on the common path.
  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });
  const farm = farmsQuery.data?.farms.find((entry) => entry.id === farmId) ?? null;

  return (
    <>
      <PageHeader
        title={t('weather:pageTitle')}
        description={
          farm
            ? [farm.name, farm.location.district, farm.location.state].filter(Boolean).join(' · ')
            : undefined
        }
      />

      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {(weather) =>
          /*
            A location with no snapshot yet is a designed 200, not an error —
            the request path never calls a provider, so "we have not fetched
            this cell yet" is a real and temporary state with its own copy.
          */
          weather.freshness.status === 'pending' ? (
            <Notice tone="warning" data-testid="weather-pending">
              {weather.freshness.reason === 'no_coordinates'
                ? t('weather:pendingNoCoordinates')
                : t('weather:pendingBody')}
            </Notice>
          ) : (
            <div className="space-y-8">
              <FreshnessDot freshness={weather.freshness} />

              {/*
                Action first: what this weather means for the crops outranks
                the raw numbers, so the risk verdicts sit above the charts and
                "no risks" is said just as plainly.
              */}
              <Section title={t('weather:risksHeading')} as="h2">
                {weather.risks.length === 0 ? (
                  <EmptyState title={t('weather:noRisks')} />
                ) : (
                  <RiskList risks={weather.risks} />
                )}
              </Section>

              <Section title={t('weather:forecastHeading')} as="h2">
                <ForecastStrip daily={weather.daily} />
              </Section>

              <Section title={t('weather:temperature')} as="h2">
                <div className="space-y-4">
                  <TemperatureChart daily={weather.daily} />
                  <RainfallChart daily={weather.daily} />
                </div>
              </Section>
            </div>
          )
        }
      </QueryBoundary>
    </>
  );
}
