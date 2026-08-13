import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { registryApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { LAND_UNITS, type CreateCropInput, type RegistrySummary } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState, Notice } from '@/components/ui/states';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber, localizedName, toDateInputValue } from '@/lib/format';
import { toAcres } from '@/lib/units';

/**
 * Sowing-date bounds, from `backend/src/config/constants.js`. A date outside
 * them makes the stage arithmetic nonsense, so the server rejects it; the form
 * bounds the picker so a typo is caught before the round trip.
 */
const SOWING_MAX_PAST_DAYS = 400;
const SOWING_MAX_FUTURE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

const makeSchema = (availableAcres: number | null) =>
  z
    .object({
      cropCode: z.string().trim().min(1),
      freeTextLabel: z.string().trim().max(60).optional(),
      sowingDate: z.string().min(1),
      variety: z.string().trim().max(60).optional(),
      areaValue: z.union([z.string(), z.number()]).optional(),
      areaUnit: z.enum(LAND_UNITS).optional(),
    })
    .superRefine((value, ctx) => {
      // `OTHER` is the registry's escape hatch: the API accepts an unknown code
      // only when the farmer supplies their own label for it (`resolveCropCode`).
      if (value.cropCode === 'OTHER' && !value.freeTextLabel) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['freeTextLabel'], message: 'required' });
      }

      // The land ledger, checked before the round trip. The server enforces the
      // same rule (`crop.areaExceedsFarm`), so this can only be kinder, never
      // more permissive: it refuses here with the remaining area named instead
      // of letting the farmer find out from a 422.
      const area = value.areaValue === '' || value.areaValue == null ? NaN : Number(value.areaValue);
      if (
        availableAcres != null &&
        Number.isFinite(area) &&
        area > 0 &&
        toAcres(area, value.areaUnit ?? 'acre') > availableAcres + 1e-9
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['areaValue'],
          message: 'exceeds_farm_area',
        });
      }
    });

type CropFormValues = z.input<ReturnType<typeof makeSchema>>;

export function CropForm({
  isSubmitting,
  onSubmit,
  formError,
  availableAcres = null,
}: {
  isSubmitting: boolean;
  onSubmit: (values: CreateCropInput) => void;
  formError?: string | null;
  /** Ground still open on the farm, in acres; null when unknown. */
  availableAcres?: number | null;
}) {
  const { t } = useTranslation(['crop', 'common', 'agri']);
  const { language } = useLanguage();

  const registryQuery = useQuery({
    queryKey: queryKeys.registry.list(),
    queryFn: registryApi.list,
    staleTime: STALE_TIME.registry,
  });

  const schema = useMemo(() => makeSchema(availableAcres), [availableAcres]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CropFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cropCode: '',
      freeTextLabel: '',
      sowingDate: toDateInputValue(new Date()),
      variety: '',
      areaValue: '',
      areaUnit: 'acre',
    },
  });

  const cropCode = watch('cropCode');
  const crops = registryQuery.data?.data.crops ?? [];

  const submit = handleSubmit((values) => {
    const parsed = schema.parse(values);
    const area =
      parsed.areaValue === '' || parsed.areaValue === undefined
        ? undefined
        : Number(parsed.areaValue);

    onSubmit({
      cropCode: parsed.cropCode,
      ...(parsed.cropCode === 'OTHER' && parsed.freeTextLabel
        ? { freeTextLabel: parsed.freeTextLabel }
        : {}),
      // The API coerces to a Date; an ISO day is unambiguous either way.
      sowingDate: new Date(`${parsed.sowingDate}T00:00:00`).toISOString(),
      ...(parsed.variety ? { variety: parsed.variety } : {}),
      ...(area && Number.isFinite(area) && area > 0
        ? { areaValue: area, areaUnit: parsed.areaUnit ?? 'acre' }
        : {}),
    });
  });

  const minDate = toDateInputValue(new Date(Date.now() - SOWING_MAX_PAST_DAYS * DAY_MS));
  const maxDate = toDateInputValue(new Date(Date.now() + SOWING_MAX_FUTURE_DAYS * DAY_MS));

  return (
    <form onSubmit={submit} noValidate className="space-y-5" data-testid="crop-form">
      {formError && (
        <Notice tone="danger" data-testid="crop-form-error">
          {formError}
        </Notice>
      )}

      {/*
        The crop picker is this form's one load-bearing fetch. When it fails,
        the select would otherwise render with only the placeholder and
        "Another crop" — which looks like the platform supports nothing. Say
        what happened and offer the retry instead.
      */}
      {registryQuery.isError && (
        <ErrorState
          message={t('crop:registryLoadError')}
          onRetry={() => void registryQuery.refetch()}
        />
      )}

      <SelectField
        label={t('crop:cropCodeLabel')}
        required
        data-testid="crop-code"
        disabled={registryQuery.isPending}
        error={errors.cropCode && t('common:validation.required')}
        {...register('cropCode')}
      >
        <option value="">{t('crop:cropCodePlaceholder')}</option>
        {groupBySupport(crops).map(([supportLevel, group]) => (
          <optgroup key={supportLevel} label={t(`agri:support.${supportLevel}`)}>
            {group.map((crop) => (
              <option key={crop.cropCode} value={crop.cropCode}>
                {localizedName(crop.names, language)?.text ?? crop.cropCode}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="OTHER">{t('crop:otherOption')}</option>
      </SelectField>

      {cropCode === 'OTHER' && (
        <>
          <TextField
            label={t('crop:freeTextLabel')}
            required
            maxLength={60}
            data-testid="crop-free-text"
            error={errors.freeTextLabel && t('common:validation.required')}
            {...register('freeTextLabel')}
          />
          {/*
            Said before the crop is created, not after: the platform's advice
            is registry-driven, and a crop outside it genuinely gets less.
          */}
          <Notice tone="warning">{t('crop:freeTextHint')}</Notice>
        </>
      )}

      <TextField
        label={t('crop:sowingDateLabel')}
        type="date"
        required
        min={minDate}
        max={maxDate}
        hint={t('crop:sowingDateHint', {
          past: SOWING_MAX_PAST_DAYS,
          future: SOWING_MAX_FUTURE_DAYS,
        })}
        data-testid="crop-sowing-date"
        error={errors.sowingDate && t('common:validation.required')}
        {...register('sowingDate')}
      />

      <TextField
        label={t('crop:varietyLabel')}
        placeholder={t('crop:varietyPlaceholder')}
        maxLength={60}
        data-testid="crop-variety"
        {...register('variety')}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('crop:areaLabel')}
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          data-testid="crop-area"
          hint={
            availableAcres != null
              ? t('crop:areaAvailable', {
                  amount: `${formatNumber(availableAcres, language, {
                    maximumFractionDigits: 2,
                  })} ${t('common:unit.acre')}`,
                })
              : undefined
          }
          error={errors.areaValue && t('crop:areaExceedsFarm')}
          {...register('areaValue')}
        />
        <SelectField label={t('crop:areaUnitLabel')} {...register('areaUnit')}>
          {LAND_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {t(`common:unit.${unit}`)}
            </option>
          ))}
        </SelectField>
      </div>

      <Button type="submit" size="lg" fullWidth isLoading={isSubmitting} data-testid="crop-submit">
        {t('crop:saveCta')}
      </Button>
    </form>
  );
}

/**
 * Groups the picker by how much the platform actually knows about each crop,
 * best-supported first. A farmer choosing between two crops deserves to see
 * that one of them will produce real advice and the other will not.
 */
function groupBySupport(crops: RegistrySummary[]): [string, RegistrySummary[]][] {
  const order = ['SPECIALIZED', 'GENERAL', 'LIMITED', 'UNSUPPORTED'];
  const groups = new Map<string, RegistrySummary[]>();

  for (const crop of crops) {
    const bucket = groups.get(crop.supportLevel) ?? [];
    bucket.push(crop);
    groups.set(crop.supportLevel, bucket);
  }

  return order
    .filter((level) => groups.has(level))
    .map((level) => [level, groups.get(level)!] as [string, RegistrySummary[]]);
}
