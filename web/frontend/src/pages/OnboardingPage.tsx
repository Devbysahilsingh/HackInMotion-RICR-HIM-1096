import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthContext';
import { cropsApi, farmsApi, marketApi, registryApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import {
  IRRIGATION_METHODS,
  LAND_UNITS,
  SOIL_TYPES,
  type CreateCropInput,
  type CropWithStage,
  type Farm,
  type FarmInput,
  type IrrigationMethod,
  type LandUnit,
  type SoilType,
} from '@/api/types';
import { CropForm } from '@/components/domain/CropForm';
import { UploadDropzone } from '@/components/domain/UploadDropzone';
import { Button, ButtonLink } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { Notice } from '@/components/ui/states';
import { IconCheck, IconLeaf, IconLocation, IconPlus } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useGeolocation, type GeolocationErrorKind } from '@/hooks/useGeolocation';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDate, formatNumber, localizedName } from '@/lib/format';
import { allocatedCropAcres, availableFarmAcres, toAcres } from '@/lib/units';
import { cn } from '@/lib/cn';

const STEPS = ['location', 'land', 'crops', 'ready'] as const;
type WizardStep = (typeof STEPS)[number];

const GPS_ERROR_KEY: Record<GeolocationErrorKind, string> = {
  'not-supported': 'gpsNotSupported',
  denied: 'gpsDenied',
  unavailable: 'gpsUnavailable',
  timeout: 'gpsTimeout',
  'outside-india': 'gpsOutsideIndia',
};

/** One colour per allocation-bar segment, cycling for a farm with many crops. */
const BAR_TONES = [
  'bg-brand-600',
  'bg-harvest-500',
  'bg-leaf-500',
  'bg-earth-600',
  'bg-sky-700',
];

/**
 * Post-registration farm setup — four steps, matching the reference: where the
 * farm is (plus an optional photo), the land itself, what's growing on it, and
 * a ready summary.
 *
 * This replaces the previous single-screen intro-then-hop-to-`/farms/new`
 * flow. The steps are presentational; every write goes through the same real
 * endpoints `/farms/new` and `/farms/:id/crops/new` already use
 * (`farmsApi.create`, `farmsApi.uploadPhoto`, `cropsApi.create`) — nothing
 * here is a duplicate of that logic, and nothing is a fake/local farm record.
 *
 * The farm is created once, at the location→land transition — not on every
 * step, and not re-created on Back/Continue — because crop creation
 * (`POST /farms/:farmId/crops`) needs a real farm id to nest under. Editing
 * location or land after that point calls `farmsApi.update` on the same id.
 */
export default function OnboardingPage() {
  const { t } = useTranslation(['common', 'farm', 'crop', 'agri']);
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();

  const [stepIndex, setStepIndex] = useState(0);
  const step: WizardStep = STEPS[stepIndex]!;

  // ── Step 1 — location + photo ────────────────────────────────────────────
  const gps = useGeolocation();
  const [locState, setLocState] = useState('');
  const [locDistrict, setLocDistrict] = useState('');
  const [locVillage, setLocVillage] = useState('');
  const [lat, setLat] = useState<number | undefined>();
  const [lon, setLon] = useState<number | undefined>();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const uploadedPhotoRef = useRef<File | null>(null);

  useEffect(() => {
    if (!gps.coordinates) return;
    setLat(gps.coordinates.lat);
    setLon(gps.coordinates.lon);
  }, [gps.coordinates]);

  // ── Step 2 — land ─────────────────────────────────────────────────────────
  const [farmName, setFarmName] = useState('');
  const [sizeValue, setSizeValue] = useState('1');
  const [sizeUnit, setSizeUnit] = useState<LandUnit>('acre');
  const [soilType, setSoilType] = useState<SoilType>('unknown');
  const [irrigationMethod, setIrrigationMethod] = useState<IrrigationMethod>('unknown');

  // ── Server truth, once the farm exists ──────────────────────────────────
  const [farm, setFarm] = useState<Farm | null>(null);
  const [crops, setCrops] = useState<CropWithStage[]>([]);
  const [farmError, setFarmError] = useState<string | null>(null);

  // ── Step 3 — crops ────────────────────────────────────────────────────────
  const [showCropForm, setShowCropForm] = useState(true);
  const [editingCrop, setEditingCrop] = useState<CropWithStage | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);

  const createFarm = useMutation({ mutationFn: (input: FarmInput) => farmsApi.create(input) });
  const updateFarm = useMutation({
    mutationFn: (input: FarmInput) => farmsApi.update(farm!.id, input),
  });
  const uploadPhoto = useMutation({
    mutationFn: ({ farmId, file }: { farmId: string; file: File }) =>
      farmsApi.uploadPhoto(farmId, file),
  });
  const createCrop = useMutation({
    mutationFn: (payload: CreateCropInput) => cropsApi.create(farm!.id, payload),
  });
  const removeCrop = useMutation({ mutationFn: (cropId: string) => cropsApi.remove(cropId) });
  const uploadCropPhoto = useMutation({
    mutationFn: ({ cropId, photo }: { cropId: string; photo: File }) =>
      cropsApi.uploadPhoto(cropId, photo),
  });

  const registryQuery = useQuery({
    queryKey: queryKeys.registry.list(),
    queryFn: registryApi.list,
    staleTime: STALE_TIME.registry,
  });
  const registryByCode = useMemo(() => {
    const map = new Map<string, { seasons: readonly string[] }>();
    for (const crop of registryQuery.data?.data.crops ?? []) map.set(crop.cropCode, crop);
    return map;
  }, [registryQuery.data]);

  const editingCropId = editingCrop?.id;
  const availableAcres = useMemo(() => {
    if (!farm) return null;
    const others = editingCropId ? crops.filter((c) => c.id !== editingCropId) : crops;
    return availableFarmAcres(farm, others);
  }, [farm, crops, editingCropId]);

  const totalAcres = farm ? toAcres(farm.sizeValue, farm.sizeUnit) : 0;
  const allocatedAcres = allocatedCropAcres(crops);

  // ── Step 4 — ready ────────────────────────────────────────────────────────
  const weatherQuery = useQuery({
    queryKey: queryKeys.farms.weather(farm?.id ?? ''),
    queryFn: () => farmsApi.weather(farm!.id),
    enabled: Boolean(farm) && step === 'ready',
  });
  const mandiQuery = useQuery({
    queryKey: queryKeys.market.nearby(farm?.id ?? '', undefined, 7),
    queryFn: () => marketApi.nearby({ farmId: farm!.id, days: 7 }),
    enabled: Boolean(farm) && step === 'ready',
  });
  const readyPhoto = useMutation({
    mutationFn: ({ farmId, file }: { farmId: string; file: File }) =>
      farmsApi.uploadPhoto(farmId, file),
    onSuccess: ({ farm: updated }) => setFarm(updated),
  });

  // Pulled into single-level locals rather than chained inline in the JSX —
  // safer for TypeScript to narrow through `!= null` checks, and easier to
  // read than a multi-level optional chain repeated at each call site.
  const dailyForecast = weatherQuery.data?.daily;
  const today = dailyForecast && dailyForecast.length > 0 ? dailyForecast[0] : undefined;
  const nearestMandi = mandiQuery.data?.mandis[0];

  function buildFarmInput(): FarmInput {
    const hasCoordinates = lat !== undefined && lon !== undefined;
    const name =
      farmName.trim() || locVillage.trim() || locDistrict.trim() || t('farm:defaultName');
    return {
      name,
      location: {
        ...(hasCoordinates ? { lat, lon } : {}),
        state: locState.trim(),
        district: locDistrict.trim(),
        ...(locVillage.trim() ? { village: locVillage.trim() } : {}),
        source: hasCoordinates && gps.coordinates ? 'gps' : 'manual',
      },
      sizeValue: Number(sizeValue) || 0.01,
      sizeUnit,
      soilType,
      irrigationMethod,
    };
  }

  const locationValid = locState.trim().length > 0 && locDistrict.trim().length > 0;
  const landValid = Number(sizeValue) > 0;

  async function handleLandContinue() {
    setFarmError(null);
    const input = buildFarmInput();
    try {
      let nextFarm: Farm;
      if (!farm) {
        const { farm: created } = await createFarm.mutateAsync(input);
        nextFarm = created;
      } else {
        const { farm: updated } = await updateFarm.mutateAsync(input);
        nextFarm = updated;
      }

      if (photoFile && uploadedPhotoRef.current !== photoFile) {
        try {
          const { farm: withPhoto } = await uploadPhoto.mutateAsync({
            farmId: nextFarm.id,
            file: photoFile,
          });
          nextFarm = withPhoto;
          uploadedPhotoRef.current = photoFile;
        } catch {
          // Non-fatal: the farm exists either way. The photo can be added
          // again from step 4 or the farm's own page.
        }
      }

      setFarm(nextFarm);
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      setStepIndex(2);
    } catch (err) {
      setFarmError(toMessage(err));
    }
  }

  async function handleCropSubmit(values: CreateCropInput, photo: File | null) {
    setCropError(null);
    try {
      if (editingCrop) await removeCrop.mutateAsync(editingCrop.id);
      let { crop } = await createCrop.mutateAsync(values);

      if (photo) {
        try {
          ({ crop } = await uploadCropPhoto.mutateAsync({ cropId: crop.id, photo }));
        } catch {
          // Non-fatal: the crop exists either way. The photo can be added
          // again from the crop's own page.
        }
      }

      setCrops((prev) => [...prev.filter((c) => c.id !== editingCrop?.id), crop]);
      setEditingCrop(null);
      setShowCropForm(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.forFarm(farm!.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
    } catch (err) {
      setCropError(toMessage(err));
    }
  }

  function handleCropsContinue() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
    setStepIndex(3);
  }

  const isSavingLand = createFarm.isPending || updateFarm.isPending || uploadPhoto.isPending;

  return (
    <div className="min-h-dvh bg-canvas">
      <OnboardingHeader stepIndex={stepIndex} t={t} />

      <main className="mx-auto w-full max-w-[92.5rem] px-5 py-10 sm:px-10 sm:py-14">
        {step === 'location' && (
          <StepShell
            eyebrow={t('common:stepOf', { current: 1, total: STEPS.length })}
            title={t('farm:wizardLocationTitle')}
            body={t('farm:locationWhy')}
            visual={
              <PhotoPanel
                t={t}
                file={photoFile}
                onSelect={setPhotoFile}
                existingUrl={null}
              />
            }
          >
            {farmError && <Notice tone="danger">{farmError}</Notice>}

            <div className="space-y-2">
              <Button
                variant="secondary"
                onClick={gps.locate}
                isLoading={gps.isLocating}
                leadingIcon={<IconLocation size={18} />}
                data-testid="onboarding-gps"
              >
                {gps.isLocating ? t('farm:gpsLocating') : t('farm:useGps')}
              </Button>
              {gps.error && (
                <Notice tone="warning">{t(`farm:${GPS_ERROR_KEY[gps.error]}`)}</Notice>
              )}
              {gps.coordinates && !gps.error && <Notice tone="info">{t('farm:gpsSuccess')}</Notice>}
            </div>

            <p className="kicker pt-2">{t('farm:manualHeading')}</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t('farm:stateLabel')}
                placeholder={t('farm:statePlaceholder')}
                required
                autoComplete="address-level1"
                data-testid="onboarding-state"
                value={locState}
                onChange={(e) => setLocState(e.target.value)}
              />
              <TextField
                label={t('farm:districtLabel')}
                placeholder={t('farm:districtPlaceholder')}
                required
                autoComplete="address-level2"
                data-testid="onboarding-district"
                value={locDistrict}
                onChange={(e) => setLocDistrict(e.target.value)}
              />
            </div>

            <TextField
              label={t('farm:villageLabel')}
              placeholder={t('farm:villagePlaceholder')}
              autoComplete="address-level3"
              data-testid="onboarding-village"
              value={locVillage}
              onChange={(e) => setLocVillage(e.target.value)}
            />

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Button
                size="lg"
                disabled={!locationValid}
                onClick={() => setStepIndex(1)}
                data-testid="onboarding-next"
              >
                {t('common:action.next')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => navigate('/dashboard', { replace: true })}
                data-testid="onboarding-skip"
              >
                {t('farm:wizardSkip')}
              </Button>
            </div>
          </StepShell>
        )}

        {step === 'land' && (
          <StepShell
            eyebrow={t('common:stepOf', { current: 2, total: STEPS.length })}
            title={t('farm:wizardLandTitle')}
            body={t('farm:wizardLandBody')}
          >
            {farmError && <Notice tone="danger">{farmError}</Notice>}

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('farm:nameLabel')}
                  placeholder={t('farm:namePlaceholder')}
                  hint={t('farm:nameOptionalHint')}
                  data-testid="onboarding-name"
                  value={farmName}
                  onChange={(e) => setFarmName(e.target.value)}
                />
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <TextField
                    label={t('farm:sizeLabel')}
                    type="number"
                    step="0.01"
                    min="0.01"
                    inputMode="decimal"
                    required
                    data-testid="onboarding-size"
                    value={sizeValue}
                    onChange={(e) => setSizeValue(e.target.value)}
                  />
                  <div className="self-end">
                    <select
                      aria-label={t('farm:sizeUnitLabel')}
                      data-testid="onboarding-size-unit"
                      className="touch-target h-[46px] rounded-lg border border-line bg-surface px-3 text-base"
                      value={sizeUnit}
                      onChange={(e) => setSizeUnit(e.target.value as LandUnit)}
                    >
                      {LAND_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {t(`common:unit.${unit}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <p className="kicker">{t('farm:soilLabel')}</p>
              <PillGroup
                className="mt-3"
                value={soilType}
                onChange={setSoilType}
                options={SOIL_TYPES.map((soil) => ({ value: soil, label: t(`agri:soil.${soil}`) }))}
                testId="onboarding-soil"
              />
              {soilType === 'unknown' && (
                <p className="mt-3 text-xs text-ink-500">{t('farm:soilUnknownNudge')}</p>
              )}
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-card">
              <p className="kicker">{t('farm:irrigationLabel')}</p>
              <PillGroup
                className="mt-3"
                value={irrigationMethod}
                onChange={setIrrigationMethod}
                options={IRRIGATION_METHODS.map((method) => ({
                  value: method,
                  label: t(`agri:irrigationMethod.${method}`),
                }))}
                testId="onboarding-irrigation"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={() => setStepIndex(0)} data-testid="onboarding-back">
                {t('common:action.back')}
              </Button>
              <Button
                disabled={!landValid}
                isLoading={isSavingLand}
                onClick={() => void handleLandContinue()}
                data-testid="onboarding-next"
              >
                {t('common:action.next')}
              </Button>
            </div>
          </StepShell>
        )}

        {step === 'crops' && farm && (
          <StepShell
            eyebrow={t('common:stepOf', { current: 3, total: STEPS.length })}
            title={t('farm:wizardCropsTitle')}
            body={t('farm:wizardCropsBody')}
          >
            {cropError && <Notice tone="danger">{cropError}</Notice>}

            {crops.length > 0 && (
              <ul className="space-y-3" data-testid="onboarding-crop-list">
                {crops.map((crop) => {
                  const name = crop.registry.names
                    ? (localizedName(crop.registry.names, language)?.text ?? crop.cropCode)
                    : (crop.freeTextLabel ?? crop.cropCode);
                  const registryCrop = registryByCode.get(crop.cropCode);
                  const season =
                    registryCrop && registryCrop.seasons.length === 1
                      ? t(`agri:season.${registryCrop.seasons[0]}`)
                      : null;
                  const dateLabel =
                    crop.status === 'planned'
                      ? t('farm:wizardCropPlanned', { date: formatDate(crop.sowingDate, language) })
                      : t('farm:wizardCropSown', { date: formatDate(crop.sowingDate, language) });

                  return (
                    <li
                      key={crop.id}
                      className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card"
                    >
                      {crop.photoUrl ? (
                        <img
                          src={crop.photoUrl}
                          alt=""
                          className="size-14 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="ph grid size-14 shrink-0 place-items-center rounded-lg text-white/80">
                          <IconLeaf size={22} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-[0.938rem] font-semibold">
                          {name}
                        </p>
                        <p className="text-xs text-ink-500">
                          {dateLabel}
                          {season ? ` · ${season}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-base font-semibold">
                          {crop.areaValue
                            ? `${formatNumber(crop.areaValue, language)} ${t(`common:unit.${crop.areaUnit ?? 'acre'}`)}`
                            : '—'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="touch-target shrink-0 text-sm font-semibold text-brand-600 underline underline-offset-2"
                        data-testid="onboarding-crop-edit"
                        onClick={() => {
                          setEditingCrop(crop);
                          setShowCropForm(true);
                        }}
                      >
                        {t('common:action.edit')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {farm && totalAcres > 0 && crops.length > 0 && (
              <div className="rounded-card border border-line bg-leaf-tint p-4">
                <p className="text-sm font-semibold text-leaf-700">
                  {t('farm:landAllocated', {
                    used: formatNumber(allocatedAcres, language, { maximumFractionDigits: 2 }),
                    total: formatNumber(totalAcres, language, { maximumFractionDigits: 2 }),
                    unit: t('common:unit.acre'),
                  })}
                </p>
                <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-white/60">
                  {crops.map((crop, index) => {
                    const acres = crop.areaValue ? toAcres(crop.areaValue, crop.areaUnit ?? 'acre') : 0;
                    const pct = totalAcres > 0 ? Math.min(100, (acres / totalAcres) * 100) : 0;
                    return (
                      <span
                        key={crop.id}
                        style={{ width: `${pct}%` }}
                        className={BAR_TONES[index % BAR_TONES.length]}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {showCropForm ? (
              <div className="rounded-card border border-line bg-surface p-5 shadow-card">
                <CropForm
                  key={editingCrop?.id ?? 'new'}
                  isSubmitting={
                    createCrop.isPending || removeCrop.isPending || uploadCropPhoto.isPending
                  }
                  onSubmit={(values, photo) => void handleCropSubmit(values, photo)}
                  availableAcres={availableAcres}
                  submitLabel={editingCrop ? t('crop:saveEditedCta') : t('crop:saveCta')}
                  defaultValues={
                    editingCrop
                      ? {
                          cropCode: editingCrop.cropCode,
                          freeTextLabel: editingCrop.freeTextLabel,
                          sowingDate: editingCrop.sowingDate,
                          variety: editingCrop.variety,
                          areaValue: editingCrop.areaValue,
                          areaUnit: editingCrop.areaUnit,
                        }
                      : undefined
                  }
                />
                {crops.length > 0 && (
                  <Button
                    variant="ghost"
                    className="mt-3"
                    onClick={() => {
                      setShowCropForm(false);
                      setEditingCrop(null);
                    }}
                  >
                    {t('common:action.cancel')}
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="secondary"
                leadingIcon={<IconPlus size={18} />}
                onClick={() => setShowCropForm(true)}
                data-testid="onboarding-add-crop"
              >
                {t('farm:wizardAddCrop')}
              </Button>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStepIndex(1)} data-testid="onboarding-back">
                {t('common:action.back')}
              </Button>
              <Button onClick={handleCropsContinue} data-testid="onboarding-next">
                {t('common:action.next')}
              </Button>
            </div>
          </StepShell>
        )}

        {step === 'ready' && farm && (
          <StepShell
            eyebrow={t('common:stepOf', { current: 4, total: STEPS.length })}
            title={
              <>
                <span className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-leaf-tint px-[11px] py-1 text-[0.719rem] font-semibold text-leaf-700">
                  <IconCheck size={14} />
                  {t('farm:wizardReadyBadge')}
                </span>
                <br />
                {t('farm:wizardReadyTitle', { name: user?.name ?? '' })}
              </>
            }
            body={t('farm:wizardReadyBody', { count: crops.length })}
            visual={
              <PhotoPanel
                t={t}
                file={null}
                onSelect={(file) => {
                  if (file) readyPhoto.mutate({ farmId: farm.id, file });
                }}
                existingUrl={farm.photoUrl ?? null}
              />
            }
          >
            {readyPhoto.isError && <Notice tone="danger">{toMessage(readyPhoto.error)}</Notice>}

            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryTile
                label={t('farm:wizardLocationCardLabel')}
                value={farm.location.village || farm.location.district}
                hint={`${farm.location.district}, ${farm.location.state}`}
              />
              <SummaryTile
                label={t('farm:wizardWeatherCardLabel')}
                value={
                  today?.tMaxC != null
                    ? `${formatNumber(today.tMaxC, language, { maximumFractionDigits: 0 })}°`
                    : t('common:freshness.pending')
                }
                hint={
                  today?.rainProbPct != null
                    ? `${formatNumber(today.rainProbPct, language, { maximumFractionDigits: 0 })}%`
                    : undefined
                }
              />
              <SummaryTile
                label={t('farm:wizardMandiCardLabel')}
                value={nearestMandi?.market ?? '—'}
                hint={
                  nearestMandi
                    ? t('farm:wizardCommoditiesCount', { count: nearestMandi.commodities.length })
                    : undefined
                }
              />
              <SummaryTile
                label={t('farm:wizardCropsCardLabel')}
                value={String(crops.length)}
                hint={
                  totalAcres > 0
                    ? t('farm:landAllocated', {
                        used: formatNumber(allocatedAcres, language, { maximumFractionDigits: 2 }),
                        total: formatNumber(totalAcres, language, { maximumFractionDigits: 2 }),
                        unit: t('common:unit.acre'),
                      })
                    : undefined
                }
              />
            </div>

            <ButtonLink to={`/farms/${farm.id}`} size="lg" data-testid="onboarding-finish">
              {t('farm:wizardGoToFarm')}
            </ButtonLink>
          </StepShell>
        )}
      </main>
    </div>
  );
}

/**
 * Brand top-left, "Step N of 4" top-right, four progress segments underneath —
 * the reference's chrome, present on every step.
 */
function OnboardingHeader({
  stepIndex,
  t,
}: {
  stepIndex: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <header className="sticky top-0 z-10 bg-canvas">
      <div className="flex flex-wrap items-center gap-4 px-5 pt-5 sm:px-10">
        <p className="flex items-center gap-2.5">
          <span
            className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-leaf-500 text-brand-900"
            aria-hidden="true"
          >
            <IconLeaf size={17} />
          </span>
          <span className="font-display text-lg font-extrabold tracking-[-0.03em]">
            {t('common:app.name')}
          </span>
        </p>
        <div className="ml-auto flex items-center gap-3">
          <p className="text-[0.813rem] font-medium text-ink-500">
            {t('common:stepOf', { current: stepIndex + 1, total: STEPS.length })}
          </p>
          <LanguageToggle />
        </div>
      </div>
      <div className="mt-4 flex gap-2 px-5 sm:px-10" aria-hidden="true">
        {STEPS.map((s, index) => (
          <span
            key={s}
            className={cn(
              'h-[3px] flex-1 rounded-full transition-colors',
              index <= stepIndex ? 'bg-brand-600' : 'bg-line-strong',
            )}
          />
        ))}
      </div>
    </header>
  );
}

/** The two-column (desktop) / stacked (mobile) shell every step renders inside. */
function StepShell({
  eyebrow,
  title,
  body,
  visual,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  body?: ReactNode;
  visual?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid gap-10', Boolean(visual) && 'lg:grid-cols-2 lg:items-start')}>
      <div className="max-w-[34rem] space-y-5">
        <div>
          <p className="kicker">{eyebrow}</p>
          <h1 className="mt-2 text-[1.75rem] sm:text-[2.375rem]">{title}</h1>
          {body && <p className="mt-3 max-w-[46ch] leading-relaxed text-ink-500">{body}</p>}
        </div>
        {children}
      </div>
      {visual && <div className="lg:sticky lg:top-28">{visual}</div>}
    </div>
  );
}

/**
 * The right-column photo area — reference's "Aerial view / browse files" box,
 * reused as the real farm-photo upload surface rather than a decorative
 * placeholder. Shows the already-uploaded photo when one exists (step 4);
 * otherwise the picker.
 */
function PhotoPanel({
  t,
  file,
  onSelect,
  existingUrl,
}: {
  t: (key: string) => string;
  file: File | null;
  onSelect: (file: File | null) => void;
  existingUrl: string | null;
}) {
  if (existingUrl) {
    return (
      <div className="overflow-hidden rounded-card border border-dashed border-line-strong">
        <img src={existingUrl} alt={t('farm:wizardPhotoAlt')} className="h-[420px] w-full object-cover" />
      </div>
    );
  }

  return (
    <div className="rounded-card border border-dashed border-line-strong bg-mute/40 p-5">
      <div className="flex min-h-[380px] flex-col items-center justify-center">
        <UploadDropzone
          file={file}
          onSelect={onSelect}
          title={t('farm:wizardPhotoTitle')}
          hint={t('farm:wizardPhotoHint')}
          cta={t('farm:wizardPhotoCta')}
          alt={t('farm:wizardPhotoAlt')}
        />
      </div>
    </div>
  );
}

/** A row of individually-styled pill buttons — the reference's soil/water selector. */
function PillGroup<T extends string>({
  value,
  onChange,
  options,
  testId,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              'touch-target rounded-full border px-4 text-sm font-semibold transition-colors',
              selected
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-line bg-surface text-ink-700 hover:border-brand-300',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <p className="kicker">{label}</p>
      <p className="mt-1 font-display text-xl font-extrabold tracking-[-0.02em]">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
