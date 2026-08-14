import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

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
  const [searchParams] = useSearchParams();

  /**
   * Pre-selects the crop when the farmer arrived from a recommendation.
   *
   * A hint, not a decision: the form's own select stays editable and its
   * validation is unchanged, so a code that is not in the registry simply
   * leaves the field empty rather than submitting something the API would
   * reject. Uppercased because crop codes are canonical ids.
   */
  const suggestedCropCode = (searchParams.get('cropCode') ?? '').toUpperCase() || undefined;
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
  });
  const uploadPhoto = useMutation({
    mutationFn: ({ cropId, photo }: { cropId: string; photo: File }) =>
      cropsApi.uploadPhoto(cropId, photo),
  });

  const handleSubmit = async (values: CreateCropInput, photo: File | null) => {
    setFormError(null);
    try {
      const { crop } = await create.mutateAsync(values);

      if (photo) {
        try {
          await uploadPhoto.mutateAsync({ cropId: crop.id, photo });
        } catch {
          // Non-fatal: the crop exists either way. The photo can be added
          // again from the crop's own page.
        }
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.all() });
      // A new crop changes the dashboard's card set and, after the next feed
      // job, its advice.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate(`/crops/${crop.id}`, { replace: true });
    } catch (error) {
      setFormError(toMessage(error));
    }
  };

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
        defaultValues={suggestedCropCode ? { cropCode: suggestedCropCode } : undefined}
        isSubmitting={create.isPending || uploadPhoto.isPending}
        formError={formError}
        availableAcres={availableAcres}
        onSubmit={(values, photo) => void handleSubmit(values, photo)}
      />
    </>
  );
}
