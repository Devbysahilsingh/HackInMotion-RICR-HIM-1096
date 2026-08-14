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

  const create = useMutation({ mutationFn: (values: FarmInput) => farmsApi.create(values) });
  const uploadPhoto = useMutation({
    mutationFn: ({ farmId, photo }: { farmId: string; photo: File }) =>
      farmsApi.uploadPhoto(farmId, photo),
  });

  /**
   * Create, then upload. The photo route is keyed by a farm id that does not
   * exist until the farm does, so the two cannot be one request — the same
   * two-step the onboarding wizard and the crop form already use.
   *
   * A failed upload is deliberately non-fatal: the farm is saved either way,
   * and the farmer can add the photo from the field's own edit screen. Losing
   * a created farm because a photo did not reach Cloudinary would be the worse
   * outcome by far.
   */
  const handleSubmit = async (values: FarmInput, photo: File | null) => {
    setFormError(null);
    try {
      const { farm } = await create.mutateAsync(values);

      if (photo) {
        try {
          await uploadPhoto.mutateAsync({ farmId: farm.id, photo });
        } catch (error) {
          toast.push(toMessage(error), 'error');
        }
      }

      // The farm list and the dashboard both change shape when the first farm
      // appears — the dashboard swaps its onboarding payload for real content.
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate(`/farms/${farm.id}`, { replace: true });
    } catch (error) {
      setFormError(toMessage(error));
    }
  };

  return (
    <>
      <PageHeader title={t('farm:newTitle')} />
      <FarmForm
        submitLabel={t('farm:createCta')}
        isSubmitting={create.isPending || uploadPhoto.isPending}
        formError={formError}
        onSubmit={(values, photo) => void handleSubmit(values, photo)}
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
  });
  const uploadPhoto = useMutation({
    mutationFn: (photo: File) => farmsApi.uploadPhoto(farmId, photo),
  });

  /**
   * Removing the stored photo is immediate rather than deferred to save: it is
   * its own endpoint (`DELETE /farms/:id/photo`, which destroys the Cloudinary
   * asset so no orphan is left behind), and holding it until submit would mean
   * a farmer who cancels still believing they removed it.
   */
  const removePhoto = useMutation({
    mutationFn: () => farmsApi.removePhoto(farmId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
    },
    onError: (error) => toast.push(toMessage(error), 'error'),
  });

  const handleSubmit = async (values: FarmInput, photo: File | null) => {
    setFormError(null);
    try {
      await update.mutateAsync(values);
      if (photo) {
        try {
          await uploadPhoto.mutateAsync(photo);
        } catch (error) {
          toast.push(toMessage(error), 'error');
        }
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      // A location change moves the farm to a different weather grid cell.
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.weather(farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate(`/farms/${farmId}`, { replace: true });
    } catch (error) {
      setFormError(toMessage(error));
    }
  };

  return (
    <>
      <PageHeader title={t('farm:editTitle')} />
      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {({ farm, crops }) => (
          <FarmForm
            defaultValues={farm}
            submitLabel={t('farm:saveCta')}
            isSubmitting={update.isPending || uploadPhoto.isPending}
            formError={formError}
            // The land ledger's mirror rule: the field cannot shrink below the
            // ground its crops already occupy.
            allocatedAcres={allocatedCropAcres(crops)}
            existingPhotoUrl={farm.photoUrl ?? null}
            onRemovePhoto={() => removePhoto.mutate()}
            isRemovingPhoto={removePhoto.isPending}
            onSubmit={(values, photo) => void handleSubmit(values, photo)}
          />
        )}
      </QueryBoundary>
    </>
  );
}
