import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { farmsApi, healthApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CropWithStage, HealthLogSummary } from '@/api/types';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { DiseaseName } from '@/components/domain/DiseaseName';
import { FramingGuide } from '@/components/domain/FramingGuide';
import { ScanCoverage } from '@/components/domain/ScanCoverage';
import { ScanProgress } from '@/components/domain/ScanProgress';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CheckboxField, SelectField, TextAreaField } from '@/components/ui/Field';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState, Notice } from '@/components/ui/states';
import { IconCamera, IconPlus, IconUpload } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { usePageHeading } from '@/hooks/usePageHeading';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';
import { formatDateTime, localizedName } from '@/lib/format';

const MAX_DESCRIPTION = 500;

/**
 * Mirrors the server's own upload gate (`config/constants.js`). Checking here
 * saves an 8MB upload that was always going to be rejected; the server still
 * checks the bytes themselves, which is the real control — the client's
 * declared MIME type and filename are never trusted there.
 */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif';

type Phase = 'choose' | 'confirm' | 'scanning';

/**
 * The three steps of the check, in the farmer's terms.
 *
 * Each one describes work the pipeline genuinely performs — photograph in,
 * tiered comparison against that crop's registry conditions, guidance rendered
 * from the sourced knowledge base. Nothing here promises a step
 * `cropHealthService.js` does not take.
 */
const HOW_IT_WORKS = [
  { title: 'step1Title', body: 'step1Body' },
  { title: 'step2Title', body: 'step2Body' },
  { title: 'step3Title', body: 'step3Body' },
] as const;

/**
 * Crop health, for the field selected in the sidebar.
 *
 * The screen is one flow in three phases — *show us the leaf* → *which crop is
 * this?* → *looking at your leaf* — and it ends on the result page rather than
 * here. It replaced a plain form (a select, a dropzone, a submit button) that
 * asked the farmer to fill in a record before they could ask their question.
 *
 * Two things are load-bearing and easy to lose:
 *
 *   1. **The photograph the farmer chose is the photograph they see**, at every
 *      step. An object URL is held from the moment they pick it, so the
 *      scanning state shows their leaf, and the result page shows the stored
 *      copy of the same one — never a placeholder.
 *   2. **The scan belongs to a farm.** `cropId` comes from the field selected
 *      in the sidebar, so the account's other fields cannot be scanned into by
 *      accident, and the history below is that field's alone.
 */
export default function ScanPage() {
  const { t } = useTranslation(['health', 'common', 'crop', 'farm']);
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();
  const [searchParams] = useSearchParams();
  const { activeFarmId, activeFarm } = useActiveFarm();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cropId, setCropId] = useState(searchParams.get('cropId') ?? '');
  const [description, setDescription] = useState('');
  const [shareToCommunity, setShareToCommunity] = useState(false);
  const [uploadFraction, setUploadFraction] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<'TOO_LARGE' | 'NOT_AN_IMAGE' | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const headingRef = usePageHeading(t('health:landingTitle'));

  /*
   * The crops on the selected field. `/farms/:id` is already cached by the farm
   * screen, and unlike the dashboard payload it carries the stage and area the
   * result page prints beside the diagnosis.
   */
  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(activeFarmId ?? ''),
    queryFn: () => farmsApi.get(activeFarmId!),
    enabled: Boolean(activeFarmId),
    staleTime: STALE_TIME.slowMoving,
  });

  const crops = useMemo(
    () => (farmQuery.data?.crops ?? []).filter((crop) => crop.status !== 'harvested'),
    [farmQuery.data],
  );

  // One crop on the field is not a choice — pre-select it so the farmer's only
  // action is the photograph. A stale id from the query string is dropped if it
  // does not belong to this field.
  useEffect(() => {
    if (crops.length === 0) return;
    if (cropId && crops.some((crop) => crop.id === cropId)) return;
    setCropId(crops.length === 1 ? crops[0]!.id : '');
  }, [crops, cropId]);

  // An object URL is a document-scoped handle; without the revoke the page
  // leaks one per photo the farmer flips through.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const analyze = useMutation({
    mutationFn: () =>
      healthApi.analyze({
        cropId,
        image: file!,
        description: description.trim() || undefined,
        shareToCommunity,
        onUploadProgress: setUploadFraction,
      }),
    onSuccess: ({ log }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.health.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.detail(log.cropId) });
      navigate(`/health/${log.id}`, { replace: true });
    },
    onError: (error) => {
      setFormError(toMessage(error));
      setUploadFraction(0);
    },
  });

  const accept = (candidate: File | undefined) => {
    if (!candidate) return;

    if (!candidate.type.startsWith('image/')) {
      setRejection('NOT_AN_IMAGE');
      setFile(null);
      return;
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      setRejection('TOO_LARGE');
      setFile(null);
      return;
    }

    setRejection(null);
    setFormError(null);
    setFile(candidate);
  };

  /*
   * The crop the coverage card describes: whichever is selected, or the field's
   * only crop. Null when the field carries several and none is chosen yet —
   * the card then renders nothing rather than describing an arbitrary one.
   */
  const selectedCropCode = crops.find((crop) => crop.id === cropId)?.cropCode ?? null;

  const phase: Phase = analyze.isPending ? 'scanning' : file ? 'confirm' : 'choose';
  const canSubmit = Boolean(cropId) && Boolean(file) && !analyze.isPending;

  if (phase === 'scanning') {
    return (
      <ScanProgress
        previewUrl={previewUrl}
        uploadFraction={uploadFraction}
        uploaded={uploadFraction >= 1}
      />
    );
  }

  return (
    <div className="space-y-6">
      {formError && (
        <Notice tone="danger" data-testid="scan-error">
          {formError}
        </Notice>
      )}
      {rejection && (
        <Notice tone="danger" data-testid="upload-rejection">
          {rejection === 'TOO_LARGE' ? t('errors:uploadTooLarge') : t('errors:uploadNotAnImage')}
        </Notice>
      )}

      {/*
        The hero: the ask on the left, the photograph on the right. The right
        half is a real drop target as well as a preview, so a desktop farmer can
        drag a file onto it without hunting for a button.
      */}
      <Card className="overflow-hidden">
        <div className="grid lg:grid-cols-[1.1fr_1fr]">
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <p className="kicker">{t('health:landingKicker')}</p>
              {activeFarm && (
                <Badge tone="neutral">{t('health:scanningInto', { farm: activeFarm.name })}</Badge>
              )}
            </div>

            {/*
              `usePageHeading` rather than a bare `<h1>`: it is what moves focus
              here on a route change and sets the document title, which the
              hero rewrite would otherwise have quietly dropped along with
              `PageHeader` (accessibility.md).
            */}
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-3 text-[2rem] leading-[1.05] sm:text-[2.5rem]"
            >
              {t('health:landingTitle')}
            </h1>
            <p className="mt-3 max-w-[46ch] text-[0.9375rem] leading-relaxed text-ink-700">
              {t('health:landingBody')}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => cameraRef.current?.click()}
                leadingIcon={<IconCamera size={18} />}
                data-testid="scan-take-photo"
              >
                {t('health:takePhoto')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => galleryRef.current?.click()}
                leadingIcon={<IconUpload size={18} />}
                data-testid="scan-upload"
              >
                {t('health:uploadFromGallery')}
              </Button>
            </div>

            {/*
              What actually happens to the photograph, in three lines. It is the
              same chain the scanning screen narrates and the result page
              evidences — said here, before the farmer commits a photo, because
              "what will this do?" is the question they have at this moment.
            */}
            <ol className="mt-7 space-y-3.5 border-t border-line pt-5">
              {HOW_IT_WORKS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 font-display text-xs font-bold text-brand-600"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{t(`health:${step.title}`)}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                      {t(`health:${step.body}`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {/*
              Two inputs, not one. `capture="environment"` opens the rear camera
              directly on a phone — which is where every one of these photos is
              actually taken — but it also *prevents* choosing an existing file
              on some browsers. Keeping a plain picker beside it means "take a
              photo" and "upload from gallery" each do what they say.
            */}
            <input
              ref={cameraRef}
              type="file"
              accept={ACCEPTED}
              capture="environment"
              className="sr-only"
              aria-label={t('health:takePhoto')}
              data-testid="scan-input-camera"
              onChange={(event) => accept(event.target.files?.[0])}
            />
            <input
              ref={galleryRef}
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              aria-label={t('health:uploadFromGallery')}
              data-testid="scan-input-gallery"
              onChange={(event) => accept(event.target.files?.[0])}
            />
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              accept(event.dataTransfer.files[0]);
            }}
            className={cn(
              'flex min-h-[16rem] items-center justify-center border-line bg-canvas p-4',
              'border-t border-dashed lg:border-l lg:border-t-0',
            )}
            data-testid="scan-dropzone"
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={t('health:photoAlt')}
                className="max-h-72 w-full rounded-lg object-contain"
                data-testid="upload-preview"
              />
            ) : (
              <div className="py-2">
                <FramingGuide />
                <p className="mt-4 text-center text-xs text-ink-400">{t('health:dropzoneHint')}</p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Phase 2: which crop, and anything the farmer wants to add ── */}
      {phase === 'confirm' && (
        <Card className="p-5 sm:p-6" data-testid="scan-form">
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              setFormError(null);
              if (canSubmit) analyze.mutate();
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{t('health:photoChosen')}</Badge>
              {activeFarm && <span className="text-sm text-ink-500">{activeFarm.name}</span>}
            </div>

            {/*
              Error before empty, and the order matters. `crops` falls back to
              `[]` when the field could not be loaded, so testing emptiness
              first would tell a farmer their field has no crops because the
              request failed — and then invite them to add one they already
              have. A failed load and an empty field are different facts and
              lead to different actions.
            */}
            {farmQuery.isError ? (
              <ErrorState
                message={toMessage(farmQuery.error)}
                onRetry={() => void farmQuery.refetch()}
              />
            ) : crops.length === 0 ? (
              <EmptyState
                title={t('health:scanNoCrops')}
                action={
                  <ButtonLink
                    to={activeFarmId ? `/farms/${activeFarmId}/crops/new` : '/farms'}
                    leadingIcon={<IconPlus size={18} />}
                  >
                    {t('farm:addCropCta')}
                  </ButtonLink>
                }
              />
            ) : (
              <>
                <SelectField
                  label={t('health:scanCropLabel')}
                  required
                  value={cropId}
                  onChange={(event) => setCropId(event.target.value)}
                  data-testid="scan-crop"
                >
                  <option value="">{t('crop:cropCodePlaceholder')}</option>
                  {crops.map((crop) => (
                    <option key={crop.id} value={crop.id}>
                      {cropLabel(crop, language)}
                    </option>
                  ))}
                </SelectField>

                <TextAreaField
                  label={t('health:descriptionLabel')}
                  placeholder={t('health:descriptionPlaceholder')}
                  maxLength={MAX_DESCRIPTION}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
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
                  data-testid="scan-share"
                />

                <div className="flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    size="lg"
                    disabled={!canSubmit}
                    leadingIcon={<IconCamera size={18} />}
                    data-testid="scan-submit"
                  >
                    {t('health:scanSubmit')}
                  </Button>
                  <Button variant="ghost" onClick={() => setFile(null)}>
                    {t('common:action.cancel')}
                  </Button>
                </div>
              </>
            )}
          </form>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <ScanCoverage cropCode={selectedCropCode} />
        <PhotoGuidance />
      </div>

      <ScanHistory farmId={activeFarmId} />

      <ButtonLink to="/scan/symptoms" variant="ghost">
        {t('health:symptomCheckCta')}
      </ButtonLink>
    </div>
  );
}

/** The three tips the design puts under the hero. Copy only — no data behind it. */
function PhotoGuidance() {
  const { t } = useTranslation('health');

  const tips = [
    { key: 'good', label: t('goodPhotoLabel'), body: t('goodPhotoTip'), tone: 'success' as const },
    { key: 'avoid', label: t('avoidLabel'), body: t('avoidTip'), tone: 'warning' as const },
    { key: 'privacy', label: t('privacyLabel'), body: t('privacyTip'), tone: 'info' as const },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {tips.map((tip) => (
        <Card key={tip.key} className="h-full p-5">
          <Badge tone={tip.tone}>{tip.label}</Badge>
          <p className="mt-3 text-sm leading-relaxed text-ink-700">{tip.body}</p>
        </Card>
      ))}
    </div>
  );
}

/**
 * Previous scans on this field.
 *
 * Farm-scoped through the new `farmId` filter on `GET /crop-health/logs`, so a
 * farmer with onion on one field and soybean on another sees only the field
 * they are standing in. Each card carries the farmer's own stored photograph —
 * the same asset the scan was run on, never a placeholder.
 */
function ScanHistory({ farmId }: { farmId: string | null }) {
  const { t } = useTranslation(['health', 'common']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.health.farmLogs(farmId ?? '', 1),
    queryFn: () => healthApi.logs({ farmId: farmId!, page: 1, limit: 6 }),
    enabled: Boolean(farmId),
    staleTime: STALE_TIME.interactive,
  });

  if (!farmId || query.isPending) return <SkeletonCard />;

  const logs = query.data?.data.logs ?? [];

  return (
    <section data-testid="scan-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[1.25rem]">{t('health:scanHistoryHeading')}</h2>
        <Link
          to="/history"
          className="font-display text-sm font-semibold text-brand-600 hover:underline"
        >
          {t('common:action.viewAll')}
        </Link>
      </div>

      {logs.length === 0 ? (
        <EmptyState className="mt-3" title={t('health:scanHistoryEmpty')} />
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {logs.map((log) => (
            <ScanHistoryCard key={log.id} log={log} language={language} />
          ))}
        </div>
      )}
    </section>
  );
}

function ScanHistoryCard({
  log,
  language,
}: {
  log: HealthLogSummary;
  language: ReturnType<typeof useLanguage>['language'];
}) {
  const { t } = useTranslation('health');

  const unknown = !log.analysis.diseaseCode || log.analysis.diseaseCode === 'UNKNOWN';

  return (
    <Card className="h-full overflow-hidden" data-testid="health-log-item">
      <Link to={`/health/${log.id}`} className="flex h-full flex-col hover:bg-canvas/60">
        {log.imageUrl ? (
          <img
            src={log.imageUrl}
            alt={t('photoAlt')}
            loading="lazy"
            className="h-36 w-full shrink-0 object-cover"
          />
        ) : (
          <div className="ph h-36 shrink-0" aria-hidden="true" />
        )}

        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 text-[0.9375rem] font-semibold">
              <DiseaseName code={log.analysis.diseaseCode} />
            </p>
            {log.analysis.severityAssessment && !unknown && (
              <Badge tone={log.analysis.severityAssessment === 'SEVERE' ? 'danger' : 'warning'}>
                {t(`severity${titleCase(log.analysis.severityAssessment)}`)}
              </Badge>
            )}
          </div>
          <p className="mt-auto text-xs text-ink-500">{formatDateTime(log.createdAt, language)}</p>
        </div>
      </Link>
    </Card>
  );
}

/** `SEVERE` → `Severe`, matching the `health.severity*` key spelling. */
const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** "Onion · 15 acre" — enough to tell two plantings of one crop apart. */
function cropLabel(crop: CropWithStage, language: ReturnType<typeof useLanguage>['language']) {
  const name = localizedName(crop.registry.names, language)?.text ?? crop.cropCode;
  return crop.areaValue != null ? `${name} · ${crop.areaValue}` : name;
}
