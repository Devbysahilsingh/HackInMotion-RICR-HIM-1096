import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { cropsApi, farmsApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import type { CreateCropInput } from '@/api/types';
import { CropForm } from '@/components/domain/CropForm';
import { PageHeader } from '@/components/layout/AppLayout';
import { useToast } from '@/components/ui/Toast';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { availableFarmAcres } from '@/lib/units';

export default function CropFormPage() {
  const { t } = useTranslation(['crop', 'common']);
  const { farmId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [formError, setFormError] = useState<string | null>(null);

  /**
   * The farm this crop is going onto. Two things come from it: the context
   * line under the title (which field am I planting?) and the remaining-area
   * figure the land ledger validates against. When the fetch has not landed,
   * `availableAcres` stays null and the form simply skips the client-side
   * check — the server enforces the same rule regardless.
   */
  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(farmId),
    queryFn: () => farmsApi.get(farmId),
    enabled: Boolean(farmId),
  });

  const detail = farmQuery.data;
  const availableAcres = detail ? availableFarmAcres(detail.farm, detail.crops) : null;

  const create = useMutation({
    mutationFn: (values: CreateCropInput) => cropsApi.create(farmId, values),
    onSuccess: ({ crop }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.all() });
      // A new crop changes the dashboard's card set and, after the next feed
      // job, its advice.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate(`/crops/${crop.id}`, { replace: true });
    },
    onError: (error) => setFormError(toMessage(error)),
  });

  return (
    <>
      <PageHeader
        title={t('crop:addTitle')}
        description={
          detail
            ? [detail.farm.name, detail.farm.location.district].filter(Boolean).join(' · ')
            : undefined
        }
      />
      <CropForm
        isSubmitting={create.isPending}
        formError={formError}
        availableAcres={availableAcres}
        onSubmit={(values) => {
          setFormError(null);
          create.mutate(values);
        }}
      />
    </>
  );
}
