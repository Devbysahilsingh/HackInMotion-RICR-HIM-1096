import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { farmsApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import type { FarmInput } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { FarmForm } from '@/components/domain/FarmForm';
import { PageHeader } from '@/components/layout/AppLayout';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { allocatedCropAcres } from '@/lib/units';

export default function FarmFormPage({ mode }: { mode: 'create' | 'edit' }) {
  return mode === 'create' ? <CreateFarm /> : <EditFarm />;
}

function CreateFarm() {
  const { t } = useTranslation(['farm', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (values: FarmInput) => farmsApi.create(values),
    onSuccess: ({ farm }) => {
      // The farm list and the dashboard both change shape when the first farm
      // appears — the dashboard swaps its onboarding payload for real content.
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate(`/farms/${farm.id}`, { replace: true });
    },
    onError: (error) => setFormError(toMessage(error)),
  });

  return (
    <>
      <PageHeader title={t('farm:newTitle')} />
      <FarmForm
        submitLabel={t('farm:createCta')}
        isSubmitting={create.isPending}
        formError={formError}
        onSubmit={(values) => {
          setFormError(null);
          create.mutate(values);
        }}
      />
    </>
  );
}

function EditFarm() {
  const { t } = useTranslation(['farm', 'common']);
  const { farmId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.farms.detail(farmId),
    queryFn: () => farmsApi.get(farmId),
    enabled: Boolean(farmId),
  });

  const update = useMutation({
    mutationFn: (values: FarmInput) => farmsApi.update(farmId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      // A location change moves the farm to a different weather grid cell.
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.weather(farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate(`/farms/${farmId}`, { replace: true });
    },
    onError: (error) => setFormError(toMessage(error)),
  });

  return (
    <>
      <PageHeader title={t('farm:editTitle')} />
      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {({ farm, crops }) => (
          <FarmForm
            defaultValues={farm}
            submitLabel={t('farm:saveCta')}
            isSubmitting={update.isPending}
            formError={formError}
            // The land ledger's mirror rule: the field cannot shrink below the
            // ground its crops already occupy.
            allocatedAcres={allocatedCropAcres(crops)}
            onSubmit={(values) => {
              setFormError(null);
              update.mutate(values);
            }}
          />
        )}
      </QueryBoundary>
    </>
  );
}
