import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { dashboardApi, healthApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { QueryBoundary } from '@/components/QueryBoundary';
import { UploadDropzone } from '@/components/domain/UploadDropzone';
import { PageHeader } from '@/components/layout/AppLayout';
import { Button, ButtonLink } from '@/components/ui/Button';
import { CheckboxField, SelectField, TextAreaField } from '@/components/ui/Field';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconCamera, IconPlus } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { localizedName } from '@/lib/format';

const MAX_DESCRIPTION = 500;

/**
 * Staged progress copy.
 *
 * The wording tracks the tiers the conductor actually walks (ADR-006), in
 * order, on a timer that matches the documented per-hop budget. It is honest
 * about the shape of the work without claiming to know which tier is running
 * right now — the API does not stream that, and inventing it would be a
 * fabricated status.
 */
const STAGE_KEYS = [
  'health:analyzingPhoto',
  'health:analyzingLocal',
  'health:analyzingAssisted',
  'health:analyzingRules',
] as const;

export default function ScanPage() {
  const { t } = useTranslation(['health', 'common', 'crop']);
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();
  const [searchParams] = useSearchParams();

  const [cropId, setCropId] = useState(searchParams.get('cropId') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [shareToCommunity, setShareToCommunity] = useState(false);
  const [uploadFraction, setUploadFraction] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // The interval outlives an unmount otherwise — navigating away mid-analysis
  // would leave it ticking against a dead component.
  useEffect(
    () => () => {
      if (stageTimer.current) clearInterval(stageTimer.current);
    },
    [],
  );

  // The crop picker is fed from the dashboard payload, which already lists
  // every active crop — a second request just to fill a select would be waste.
  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  const crops = useMemo(() => dashboardQuery.data?.cropCards ?? [], [dashboardQuery.data]);

  const analyze = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('no file');

      setStageIndex(0);
      // Advances the copy on the documented hop budget. Cleared in `onSettled`
      // whichever way the request ends.
      stageTimer.current = setInterval(
        () => setStageIndex((current) => Math.min(current + 1, STAGE_KEYS.length - 1)),
        3500,
      );

      return healthApi.analyze({
        cropId,
        image: file,
        description: description.trim() || undefined,
        shareToCommunity,
        onUploadProgress: setUploadFraction,
      });
    },
    onSuccess: ({ log }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.health.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      navigate(`/health/${log.id}`, { replace: true });
    },
    onError: (error) => setFormError(toMessage(error)),
    onSettled: () => {
      if (stageTimer.current) clearInterval(stageTimer.current);
      stageTimer.current = null;
      setUploadFraction(0);
    },
  });

  const canSubmit = Boolean(cropId) && Boolean(file) && !analyze.isPending;

  return (
    <>
      <PageHeader title={t('health:scanTitle')} />

      <QueryBoundary
        query={dashboardQuery}
        isEmpty={() => crops.length === 0}
        empty={
          <EmptyState
            title={t('health:scanNoCrops')}
            action={
              <ButtonLink to="/farms" leadingIcon={<IconPlus size={18} />}>
                {t('common:nav.farms')}
              </ButtonLink>
            }
          />
        }
      >
        {() => (
          <form
            className="space-y-5"
            data-testid="scan-form"
            onSubmit={(event) => {
              event.preventDefault();
              setFormError(null);
              if (canSubmit) analyze.mutate();
            }}
          >
            {formError && (
              <Notice tone="danger" data-testid="scan-error">
                {formError}
              </Notice>
            )}

            <SelectField
              label={t('health:scanCropLabel')}
              required
              value={cropId}
              onChange={(event) => setCropId(event.target.value)}
              disabled={analyze.isPending}
              data-testid="scan-crop"
            >
              <option value="">{t('crop:cropCodePlaceholder')}</option>
              {crops.map((crop) => (
                <option key={crop.cropId} value={crop.cropId}>
                  {localizedName(crop.names, language)?.text ?? crop.cropCode}
                </option>
              ))}
            </SelectField>

            <UploadDropzone file={file} onSelect={setFile} disabled={analyze.isPending} />

            <TextAreaField
              label={t('health:descriptionLabel')}
              placeholder={t('health:descriptionPlaceholder')}
              maxLength={MAX_DESCRIPTION}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={analyze.isPending}
              data-testid="scan-description"
            />

            {/*
              A per-request opt-in that cannot override the account-level
              consent flag — the service checks both, so ticking this on an
              account that has not consented shares nothing.
            */}
            <CheckboxField
              label={t('health:shareLabel')}
              hint={t('health:shareHint')}
              checked={shareToCommunity}
              onChange={(event) => setShareToCommunity(event.target.checked)}
              disabled={analyze.isPending}
              data-testid="scan-share"
            />

            {analyze.isPending ? (
              <AnalyzingState stageIndex={stageIndex} uploadFraction={uploadFraction} />
            ) : (
              <Button
                type="submit"
                size="lg"
                fullWidth
                disabled={!canSubmit}
                leadingIcon={<IconCamera size={18} />}
                data-testid="scan-submit"
              >
                {t('health:scanSubmit')}
              </Button>
            )}

            <ButtonLink to="/scan/symptoms" variant="ghost" fullWidth>
              {t('health:symptomCheckCta')}
            </ButtonLink>
          </form>
        )}
      </QueryBoundary>
    </>
  );
}

function AnalyzingState({
  stageIndex,
  uploadFraction,
}: {
  stageIndex: number;
  uploadFraction: number;
}) {
  const { t } = useTranslation('health');
  const uploading = uploadFraction > 0 && uploadFraction < 1;
  const percent = Math.round(uploadFraction * 100);

  return (
    <div
      data-testid="scan-analyzing"
      className="space-y-3 rounded-xl border border-brand-200 bg-brand-50 px-5 py-5"
      // The one place the app needs to speak while the farmer waits.
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-semibold text-brand-800">
        {t(STAGE_KEYS[stageIndex]?.replace('health:', '') ?? 'analyzingPhoto')}
      </p>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-brand-200"
        role="progressbar"
        aria-valuenow={uploading ? percent : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={uploading ? 'h-full bg-brand-600' : 'h-full w-1/3 animate-pulse bg-brand-600'}
          style={uploading ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}
