import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { farmsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { MAX_ACTIVE_CROPS_PER_FARM } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ForecastStrip, RiskList } from '@/components/domain/WeatherStrip';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { ConfirmDialog } from '@/components/ui/Modal';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, Notice } from '@/components/ui/states';
import {
  IconChevronRight,
  IconCloud,
  IconLocation,
  IconPlus,
  IconTrash,
} from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDate, formatNumber, localizedName } from '@/lib/format';

export default function FarmDetailPage() {
  const { t } = useTranslation(['farm', 'crop', 'common', 'agri', 'weather']);
  const { farmId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const { language } = useLanguage();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(farmId),
    queryFn: () => farmsApi.get(farmId),
    enabled: Boolean(farmId),
  });

  const weatherQuery = useQuery({
    queryKey: queryKeys.farms.weather(farmId),
    queryFn: () => farmsApi.weather(farmId),
    enabled: Boolean(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  const remove = useMutation({
    mutationFn: () => farmsApi.remove(farmId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate('/farms', { replace: true });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.push(toMessage(error), 'error');
    },
  });

  const activeCrops = farmQuery.data?.crops.filter((crop) => crop.status === 'active').length ?? 0;

  return (
    <>
      <QueryBoundary query={farmQuery} loading={<SkeletonCard />}>
        {({ farm, crops }) => (
          <>
            <PageHeader
              title={farm.name}
              description={
                <span className="flex items-center gap-1.5">
                  <IconLocation size={15} aria-hidden="true" />
                  {farm.location.district}, {farm.location.state}
                  {' · '}
                  {farm.location.source === 'gps'
                    ? t('farm:locationSourceGps')
                    : t('farm:locationSourceManual')}
                </span>
              }
              actions={
                <>
                  <ButtonLink to={`/farms/${farm.id}/edit`} variant="secondary">
                    {t('common:action.edit')}
                  </ButtonLink>
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmOpen(true)}
                    leadingIcon={<IconTrash size={18} />}
                    data-testid="farm-delete"
                  >
                    {t('common:action.delete')}
                  </Button>
                </>
              }
            >
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge>
                  {formatNumber(farm.sizeValue, language)} {t(`common:unit.${farm.sizeUnit}`)}
                </Badge>
                <Badge>{t(`agri:soil.${farm.soilType}`)}</Badge>
                <Badge>{t(`agri:irrigationMethod.${farm.irrigationMethod}`)}</Badge>
              </div>
            </PageHeader>

            <div className="space-y-8">
              <Section
                title={t('farm:weatherHeading')}
                action={
                  <ButtonLink
                    to={`/farms/${farm.id}/weather`}
                    variant="ghost"
                    size="md"
                    leadingIcon={<IconCloud size={18} />}
                  >
                    {t('common:action.viewAll')}
                  </ButtonLink>
                }
              >
                <QueryBoundary query={weatherQuery} loading={<SkeletonCard />}>
                  {(weather) =>
                    weather.freshness.status === 'pending' ? (
                      <Notice tone="warning" data-testid="weather-pending">
                        {weather.freshness.reason === 'no_coordinates'
                          ? t('weather:pendingNoCoordinates')
                          : t('weather:pendingBody')}
                      </Notice>
                    ) : (
                      <div className="space-y-3">
                        <FreshnessDot freshness={weather.freshness} />
                        <ForecastStrip daily={weather.daily} />
                        <RiskList risks={weather.risks.slice(0, 3)} />
                      </div>
                    )
                  }
                </QueryBoundary>
              </Section>

              <Section
                title={t('farm:cropsHeading')}
                action={
                  activeCrops < MAX_ACTIVE_CROPS_PER_FARM && (
                    <ButtonLink
                      to={`/farms/${farm.id}/crops/new`}
                      size="md"
                      leadingIcon={<IconPlus size={18} />}
                    >
                      {t('farm:addCropCta')}
                    </ButtonLink>
                  )
                }
              >
                {crops.length === 0 ? (
                  <EmptyState
                    title={t('farm:cropsEmpty')}
                    action={
                      <ButtonLink to={`/farms/${farm.id}/crops/new`}>
                        {t('farm:addCropCta')}
                      </ButtonLink>
                    }
                  />
                ) : (
                  <ul className="space-y-3" data-testid="farm-crops">
                    {crops.map((crop) => {
                      const name = localizedName(crop.registry.names, language);
                      return (
                        <li key={crop.id}>
                          <Card>
                            <Link
                              to={`/crops/${crop.id}`}
                              className="flex items-center gap-3 p-4 hover:bg-canvas/60"
                            >
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <h3 className="text-base font-semibold">
                                  {name?.text ?? crop.freeTextLabel ?? crop.cropCode}
                                </h3>
                                <p className="text-sm text-ink-500">
                                  {formatDate(crop.sowingDate, language)}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <Badge>{t(`agri:cropStatus.${crop.status}`)}</Badge>
                                  {crop.stage.stage && (
                                    <Badge tone="brand">
                                      {t(`agri:stage.${crop.stage.stage}`)}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <IconChevronRight
                                size={20}
                                className="shrink-0 text-ink-500"
                                aria-hidden="true"
                              />
                            </Link>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            </div>
          </>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
        title={t('farm:deleteConfirmTitle')}
        body={t('farm:deleteConfirmBody')}
        confirmLabel={t('farm:deleteCta')}
        isPending={remove.isPending}
      />
    </>
  );
}
