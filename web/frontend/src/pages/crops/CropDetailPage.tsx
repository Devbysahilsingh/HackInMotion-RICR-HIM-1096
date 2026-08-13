import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { cropsApi, farmsApi, healthApi, marketApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CropWithStage, RegistryCrop } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { FertilizerGuidanceView } from '@/components/domain/FertilizerGuidanceView';
import { IrrigationVerdictCard } from '@/components/domain/IrrigationVerdictCard';
import { MarketSignalCard } from '@/components/domain/MarketSignalCard';
import { IrrigationLogForm, IrrigationLedger } from '@/components/domain/IrrigationLog';
import { HealthLogList } from '@/components/domain/HealthLogList';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconCamera, IconTrash } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDate, formatNumber, localizedName } from '@/lib/format';

const TAB_VALUES = ['status', 'irrigation', 'health', 'fertilizer', 'market'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const isTab = (value: string | null): value is TabValue =>
  value !== null && (TAB_VALUES as readonly string[]).includes(value);

export default function CropDetailPage() {
  const { t } = useTranslation(['crop', 'common']);
  const { cropId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  // The tab lives in the URL so a feed item can deep-link to "irrigation" and
  // a browser back button returns to the tab the farmer was on.
  const requested = searchParams.get('tab');
  const tab: TabValue = isTab(requested) ? requested : 'status';

  const query = useQuery({
    queryKey: queryKeys.crops.detail(cropId),
    queryFn: () => cropsApi.get(cropId),
    enabled: Boolean(cropId),
  });

  const items = [
    { value: 'status' as const, label: t('crop:tabStatus') },
    { value: 'irrigation' as const, label: t('crop:tabIrrigation') },
    { value: 'health' as const, label: t('crop:tabHealth') },
    { value: 'fertilizer' as const, label: t('crop:tabFertilizer') },
    { value: 'market' as const, label: t('crop:tabMarket') },
  ];

  return (
    <QueryBoundary query={query} loading={<SkeletonCard />}>
      {({ crop, registry }) => (
        <>
          <CropHeader crop={crop} registry={registry} />

          <Tabs
            items={items}
            value={tab}
            onChange={(next) => setSearchParams({ tab: next }, { replace: true })}
            label={t('crop:detailTitle')}
          />

          <TabPanel id={`crop-${tab}-panel`}>
            {tab === 'status' && <StatusTab crop={crop} registry={registry} />}
            {tab === 'irrigation' && <IrrigationTab cropId={crop.id} />}
            {tab === 'health' && <HealthTab cropId={crop.id} />}
            {tab === 'fertilizer' && <FertilizerTab cropId={crop.id} />}
            {tab === 'market' && <MarketTab cropCode={crop.cropCode} />}
          </TabPanel>
        </>
      )}
    </QueryBoundary>
  );
}

function CropHeader({ crop, registry }: { crop: CropWithStage; registry: RegistryCrop | null }) {
  const { t } = useTranslation(['crop', 'common', 'agri']);
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const name = localizedName(crop.registry.names, language);

  /**
   * The farm-context line (ux-flows: the farmer must never wonder "which
   * field am I looking at?"). Served from the farms-list cache on the common
   * path; if the lookup has not landed, the line simply shows date and
   * variety, exactly as before.
   */
  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });
  const farm = farmsQuery.data?.farms.find((entry) => entry.id === crop.farmId) ?? null;

  const remove = useMutation({
    mutationFn: () => cropsApi.remove(crop.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(crop.farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate(`/farms/${crop.farmId}`, { replace: true });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.push(toMessage(error), 'error');
    },
  });

  const harvest = useMutation({
    mutationFn: () => cropsApi.update(crop.id, { status: 'harvested' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.detail(crop.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
    },
    onError: (error) => toast.push(toMessage(error), 'error'),
  });

  return (
    <>
      <PageHeader
        title={name?.text ?? crop.freeTextLabel ?? crop.cropCode}
        description={
          <>
            {farm && (
              <>
                <Link to={`/farms/${farm.id}`} className="underline underline-offset-2">
                  {farm.name}
                </Link>
                {farm.location.district ? ` · ${farm.location.district}` : ''}
                {' · '}
              </>
            )}
            {formatDate(crop.sowingDate, language)}
            {crop.variety ? ` · ${crop.variety}` : ''}
          </>
        }
        actions={
          <>
            {crop.status === 'active' && (
              <Button
                variant="secondary"
                onClick={() => harvest.mutate()}
                isLoading={harvest.isPending}
              >
                {t('crop:markHarvested')}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              leadingIcon={<IconTrash size={18} />}
              data-testid="crop-delete"
            >
              {t('common:action.delete')}
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge>{t(`agri:cropStatus.${crop.status}`)}</Badge>
          {crop.stage.stage && <Badge tone="brand">{t(`agri:stage.${crop.stage.stage}`)}</Badge>}
          <Badge>{t(`agri:support.${crop.registry.supportLevel}`)}</Badge>
        </div>

        {/*
          Said up front rather than discovered tab by tab: an unsupported crop
          gets a farm record and nothing else, and pretending otherwise would
          waste a farmer's time.
        */}
        {crop.registry.supportLevel === 'UNSUPPORTED' && (
          <Notice tone="warning" className="mt-3" data-testid="crop-unsupported">
            {t('crop:unsupportedNotice')}
          </Notice>
        )}
        {registry?.dataGaps && registry.dataGaps.length > 0 && (
          <Notice tone="info" className="mt-3">
            {t('crop:dataGapsNotice')}
          </Notice>
        )}
      </PageHeader>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
        title={t('crop:deleteConfirmTitle')}
        body={t('crop:deleteConfirmBody')}
        isPending={remove.isPending}
      />
    </>
  );
}

function StatusTab({ crop, registry }: { crop: CropWithStage; registry: RegistryCrop | null }) {
  const { t } = useTranslation(['crop', 'common', 'agri']);
  const { language } = useLanguage();
  const { stage } = crop;

  return (
    <div className="space-y-5">
      <Section title={t('crop:stageHeading')} as="h2">
        {stage.hasVerdict && stage.stage ? (
          <Card>
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{t(`agri:stage.${stage.stage}`)}</Badge>
                {stage.daysSinceSowing != null && (
                  <span className="text-sm text-ink-500">
                    {t('crop:daysSinceSowing', { days: stage.daysSinceSowing })}
                  </span>
                )}
              </div>

              {stage.stageStartDay != null && stage.totalStageDays != null && (
                <StageTimeline
                  daysSinceSowing={stage.daysSinceSowing ?? 0}
                  totalDays={stage.totalStageDays}
                />
              )}

              {stage.kc != null && (
                <p className="text-xs text-ink-500">
                  {t('crop:kcLabel')}{' '}
                  {formatNumber(stage.kc, language, { maximumFractionDigits: 2 })}
                </p>
              )}
            </div>
          </Card>
        ) : (
          <EmptyState title={t('crop:noStage')} />
        )}
      </Section>

      {registry?.seasons && registry.seasons.length > 0 && (
        <Section title={t('crop:seasonsLabel')} as="h2">
          <div className="flex flex-wrap gap-2">
            {registry.seasons.map((season) => (
              <Badge key={season}>{t(`agri:season.${season}`)}</Badge>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/** A minimal progress bar through the published crop calendar. */
function StageTimeline({
  daysSinceSowing,
  totalDays,
}: {
  daysSinceSowing: number;
  totalDays: number;
}) {
  const fraction = totalDays > 0 ? Math.min(1, Math.max(0, daysSinceSowing / totalDays)) : 0;

  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-line"
      role="meter"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-brand-500" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

function IrrigationTab({ cropId }: { cropId: string }) {
  const { t } = useTranslation(['irrigation', 'common']);

  const query = useQuery({
    queryKey: queryKeys.crops.irrigation(cropId),
    queryFn: () => cropsApi.irrigation(cropId),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <div className="space-y-6">
      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {(advice) => <IrrigationVerdictCard advice={advice} />}
      </QueryBoundary>

      <Section title={t('irrigation:logTitle')} as="h2">
        <IrrigationLogForm cropId={cropId} />
      </Section>

      <Section title={t('irrigation:ledgerHeading')} as="h2">
        <IrrigationLedger cropId={cropId} />
      </Section>
    </div>
  );
}

function HealthTab({ cropId }: { cropId: string }) {
  const { t } = useTranslation(['health', 'common']);

  const query = useQuery({
    queryKey: queryKeys.health.logs(cropId, 1),
    queryFn: () => healthApi.logs({ cropId, page: 1, limit: 20 }),
  });

  return (
    <div className="space-y-4">
      <ButtonLink to={`/scan?cropId=${cropId}`} leadingIcon={<IconCamera size={18} />}>
        {t('health:scanTitle')}
      </ButtonLink>

      <QueryBoundary
        query={query}
        isEmpty={(data) => data.data.logs.length === 0}
        empty={<EmptyState title={t('health:historyEmpty')} />}
      >
        {(data) => <HealthLogList logs={data.data.logs} />}
      </QueryBoundary>
    </div>
  );
}

function FertilizerTab({ cropId }: { cropId: string }) {
  const query = useQuery({
    queryKey: queryKeys.crops.fertilizer(cropId),
    queryFn: () => cropsApi.fertilizer(cropId),
    staleTime: STALE_TIME.registry,
  });

  return (
    <QueryBoundary query={query} loading={<SkeletonCard />}>
      {(guidance) => <FertilizerGuidanceView guidance={guidance} />}
    </QueryBoundary>
  );
}

function MarketTab({ cropCode }: { cropCode: string }) {
  const { t } = useTranslation(['market', 'common']);

  const query = useQuery({
    queryKey: queryKeys.market.myCrops(30),
    queryFn: () => marketApi.myCrops({ days: 30 }),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <div className="space-y-4">
      <QueryBoundary
        query={query}
        isEmpty={(data) => !data.data.crops.some((entry) => entry.cropCode === cropCode)}
        empty={<EmptyState title={t('market:noSignal')} />}
      >
        {(data) => (
          <div className="space-y-4">
            {data.data.crops
              .filter((entry) => entry.cropCode === cropCode)
              .map((entry) => (
                <MarketSignalCard key={entry.commodityCode} signal={entry} />
              ))}
            <Link
              to="/market"
              className="inline-block text-sm font-semibold text-brand-700 underline underline-offset-2"
            >
              {t('common:action.viewAll')}
            </Link>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
