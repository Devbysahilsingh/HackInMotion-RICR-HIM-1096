import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  INDIA_BOUNDS,
  IRRIGATION_METHODS,
  LAND_UNITS,
  SOIL_TYPES,
  type FarmInput,
} from '@/api/types';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Notice } from '@/components/ui/states';
import { IconLocation } from '@/components/ui/icons';
import { useGeolocation, type GeolocationErrorKind } from '@/hooks/useGeolocation';
import { toAcres } from '@/lib/units';

/**
 * Farm create/edit.
 *
 * The schema below mirrors `createFarmSchema` in `backend/src/routes/farms.js`
 * — same bounds, same enums, same "half a coordinate is not a location" rule —
 * so the browser rejects what the server would reject, in the farmer's own
 * language, before a round trip. The server still validates: this is a
 * courtesy, never the control.
 */
const coordinate = z
  .union([z.string(), z.number()])
  .transform((value) => (value === '' || value === null ? undefined : Number(value)))
  .optional();

const makeSchema = (allocatedAcres: number | null) =>
  z
    .object({
      // Optional here, defaulted on submit. A farmer who does not know what to
      // call their field must not be blocked by a naming decision.
      name: z.string().trim().max(80).optional(),
      state: z.string().trim().min(1).max(60),
      district: z.string().trim().min(1).max(60),
      village: z.string().trim().max(80).optional(),
      lat: coordinate,
      lon: coordinate,
      sizeValue: z.coerce.number().min(0.01),
      sizeUnit: z.enum(LAND_UNITS),
      soilType: z.enum(SOIL_TYPES),
      irrigationMethod: z.enum(IRRIGATION_METHODS),
      notes: z.string().trim().max(500).optional(),
    })
    .superRefine((value, ctx) => {
      const hasLat = value.lat !== undefined && !Number.isNaN(value.lat);
      const hasLon = value.lon !== undefined && !Number.isNaN(value.lon);

      if (hasLat !== hasLon) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [hasLat ? 'lon' : 'lat'],
          message: 'required',
        });
        return;
      }

      if (hasLat && (value.lat! < INDIA_BOUNDS.minLat || value.lat! > INDIA_BOUNDS.maxLat)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lat'], message: 'outsideIndia' });
      }
      if (hasLon && (value.lon! < INDIA_BOUNDS.minLon || value.lon! > INDIA_BOUNDS.maxLon)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lon'], message: 'outsideIndia' });
      }

      // The mirror half of the land ledger: an edit may not shrink the farm
      // below the ground its crops already occupy (`farm.sizeBelowCropArea`
      // on the server; this refusal simply arrives before the round trip).
      if (
        allocatedAcres != null &&
        Number.isFinite(value.sizeValue) &&
        toAcres(value.sizeValue, value.sizeUnit) + 1e-9 < allocatedAcres
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sizeValue'], message: 'belowCropArea' });
      }
    });

export type FarmFormValues = z.input<ReturnType<typeof makeSchema>>;

const GPS_ERROR_KEY: Record<GeolocationErrorKind, string> = {
  'not-supported': 'gpsNotSupported',
  denied: 'gpsDenied',
  unavailable: 'gpsUnavailable',
  timeout: 'gpsTimeout',
  'outside-india': 'gpsOutsideIndia',
};

export function FarmForm({
  defaultValues,
  submitLabel,
  isSubmitting,
  onSubmit,
  formError,
  allocatedAcres = null,
}: {
  defaultValues?: Partial<FarmInput>;
  submitLabel: string;
  isSubmitting: boolean;
  onSubmit: (values: FarmInput) => void;
  formError?: string | null;
  /** Acres already given to crops (edit mode); the size may not go below it. */
  allocatedAcres?: number | null;
}) {
  const { t } = useTranslation(['farm', 'agri', 'common']);
  const gps = useGeolocation();
  const schema = useMemo(() => makeSchema(allocatedAcres), [allocatedAcres]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FarmFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      state: defaultValues?.location?.state ?? '',
      district: defaultValues?.location?.district ?? '',
      village: defaultValues?.location?.village ?? '',
      lat: defaultValues?.location?.lat ?? '',
      lon: defaultValues?.location?.lon ?? '',
      sizeValue: defaultValues?.sizeValue ?? 1,
      sizeUnit: defaultValues?.sizeUnit ?? 'acre',
      soilType: defaultValues?.soilType ?? 'unknown',
      irrigationMethod: defaultValues?.irrigationMethod ?? 'unknown',
      notes: defaultValues?.notes ?? '',
    },
  });

  // A successful fix fills the two coordinate fields, which stay editable —
  // the farmer can still correct them, and the form does not become a
  // read-only consequence of a permission dialog.
  useEffect(() => {
    if (!gps.coordinates) return;
    setValue('lat', gps.coordinates.lat, { shouldValidate: true });
    setValue('lon', gps.coordinates.lon, { shouldValidate: true });
  }, [gps.coordinates, setValue]);

  const soilType = watch('soilType');

  const submit = handleSubmit((values) => {
    const parsed = schema.parse(values);
    const hasCoordinates = parsed.lat !== undefined && parsed.lon !== undefined;

    /**
     * A name the farmer never has to think about.
     *
     * "North Field" is a developer's mental model. A farmer thinks "मेरा खेत"
     * or names the field after where it is, so an empty name becomes the
     * village — or the district — and stays editable afterwards.
     */
    const name = parsed.name?.trim()
      ? parsed.name.trim()
      : (parsed.village?.trim() ?? '') || parsed.district.trim() || t('farm:defaultName');

    onSubmit({
      name,
      location: {
        ...(hasCoordinates ? { lat: parsed.lat, lon: parsed.lon } : {}),
        state: parsed.state,
        district: parsed.district,
        ...(parsed.village?.trim() ? { village: parsed.village.trim() } : {}),
        // 'gps' asserts a device measured this position, so it is only claimed
        // when the device actually did — a hand-typed coordinate is 'manual'.
        source: hasCoordinates && gps.coordinates ? 'gps' : 'manual',
      },
      sizeValue: parsed.sizeValue,
      sizeUnit: parsed.sizeUnit,
      soilType: parsed.soilType,
      irrigationMethod: parsed.irrigationMethod,
      ...(parsed.notes ? { notes: parsed.notes } : {}),
    });
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6" data-testid="farm-form">
      {formError && (
        <Notice tone="danger" data-testid="farm-form-error">
          {formError}
        </Notice>
      )}

      <fieldset className="space-y-4 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-semibold">{t('farm:locationHeading')}</legend>

        <div className="space-y-2">
          <Button
            variant="secondary"
            onClick={gps.locate}
            isLoading={gps.isLocating}
            leadingIcon={<IconLocation size={18} />}
            data-testid="farm-gps"
          >
            {gps.isLocating ? t('farm:gpsLocating') : t('farm:useGps')}
          </Button>

          {gps.error && (
            <Notice tone="warning" data-testid="farm-gps-error">
              {t(`farm:${GPS_ERROR_KEY[gps.error]}`)}
            </Notice>
          )}
          {gps.coordinates && !gps.error && (
            <Notice tone="info" data-testid="farm-gps-success">
              {t('farm:gpsSuccess')}
            </Notice>
          )}
        </div>

        {/*
          Always present, never gated behind a failed GPS attempt: the manual
          path is the primary one for anyone who refuses the permission or is
          standing in a shed with no signal.
        */}
        <p className="text-sm font-medium text-ink-700">{t('farm:manualHeading')}</p>

        <p className="text-xs text-ink-500">{t('farm:locationWhy')}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('farm:stateLabel')}
            placeholder={t('farm:statePlaceholder')}
            required
            autoComplete="address-level1"
            data-testid="farm-state"
            error={errors.state && t('common:validation.required')}
            {...register('state')}
          />
          <TextField
            label={t('farm:districtLabel')}
            placeholder={t('farm:districtPlaceholder')}
            required
            autoComplete="address-level2"
            data-testid="farm-district"
            error={errors.district && t('common:validation.required')}
            {...register('district')}
          />
        </div>

        <TextField
          label={t('farm:villageLabel')}
          placeholder={t('farm:villagePlaceholder')}
          autoComplete="address-level3"
          data-testid="farm-village"
          {...register('village')}
        />

        <details className="rounded-lg bg-canvas px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-ink-700">
            {t('farm:coordinatesHeading')}
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('farm:latLabel')}
              type="number"
              step="any"
              inputMode="decimal"
              data-testid="farm-lat"
              error={
                errors.lat &&
                (errors.lat.message === 'outsideIndia'
                  ? t('common:validation.outsideIndia')
                  : t('common:validation.required'))
              }
              {...register('lat')}
            />
            <TextField
              label={t('farm:lonLabel')}
              type="number"
              step="any"
              inputMode="decimal"
              data-testid="farm-lon"
              error={
                errors.lon &&
                (errors.lon.message === 'outsideIndia'
                  ? t('common:validation.outsideIndia')
                  : t('common:validation.required'))
              }
              {...register('lon')}
            />
          </div>
        </details>
      </fieldset>

      <TextField
        label={t('farm:nameLabel')}
        placeholder={t('farm:namePlaceholder')}
        hint={t('farm:nameOptionalHint')}
        data-testid="farm-name"
        {...register('name')}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('farm:sizeLabel')}
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          required
          data-testid="farm-size"
          error={
            errors.sizeValue &&
            (errors.sizeValue.message === 'belowCropArea'
              ? t('farm:sizeBelowCropArea')
              : t('common:validation.minValue', { min: 0.01 }))
          }
          {...register('sizeValue')}
        />
        <SelectField
          label={t('farm:sizeUnitLabel')}
          data-testid="farm-size-unit"
          {...register('sizeUnit')}
        >
          {LAND_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`common:unit.${unit}`)}
            </option>
          ))}
        </SelectField>
      </div>

      <SelectField
        label={t('farm:soilLabel')}
        data-testid="farm-soil"
        hint={soilType === 'unknown' ? t('farm:soilUnknownNudge') : undefined}
        {...register('soilType')}
      >
        {SOIL_TYPES.map((soil) => (
          <option key={soil} value={soil}>
            {t(`agri:soil.${soil}`)}
          </option>
        ))}
      </SelectField>

      <SelectField
        label={t('farm:irrigationLabel')}
        data-testid="farm-irrigation"
        {...register('irrigationMethod')}
      >
        {IRRIGATION_METHODS.map((method) => (
          <option key={method} value={method}>
            {t(`agri:irrigationMethod.${method}`)}
          </option>
        ))}
      </SelectField>

      <TextAreaField
        label={t('farm:notesLabel')}
        placeholder={t('farm:notesPlaceholder')}
        maxLength={500}
        data-testid="farm-notes"
        {...register('notes')}
      />

      <Button type="submit" size="lg" fullWidth isLoading={isSubmitting} data-testid="farm-submit">
        {submitLabel}
      </Button>
    </form>
  );
}
