/**
 * Put a crop on a field.
 *
 * ## The land ledger, the half that matters most
 *
 * A crop may not claim more ground than the field has left. The farm detail
 * read gives both sides of that sum — the farm's own size and every crop
 * already on it — and `availableFarmAcres` reduces them with the same
 * conversion table `backend/src/utils/locationKey.js` uses, so the form and the
 * server cannot disagree about what a bigha is. The refusal here is not the
 * enforcement (the server answers `crop.areaExceedsFarm` regardless); it exists
 * so the farmer is told *how much is left* at the moment they type the number,
 * rather than reading a 422 afterwards. Until the farm read lands,
 * `availableAcres` is null and the check simply does not run.
 *
 * `areaUnit` is required whenever `areaValue` is given, because the server
 * requires it: an area without a unit is not a measurement, and the ledger
 * would have to guess what "3" means.
 *
 * ## Why the sowing date is three number fields
 *
 * No date-picker dependency (dependency-security.md: every dependency earns its
 * place). Three large numeric fields are bigger targets than any picker's
 * scroll wheel, work identically under a 1.3× font scale, and need no gesture
 * to discover. The accepted window mirrors `assertSowingDateInRange` in
 * `backend/src/services/cropService.js` exactly, anchor included.
 *
 * ## Why there is no status control
 *
 * There is nothing to control. `POST /farms/:id/crops` does not accept a
 * status — the server derives it from the sowing date (`planned` if the date is
 * in the future, `active` otherwise). The derived value is shown read-only, so
 * the farmer sees what will be recorded without being offered a choice the API
 * would ignore.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { formatNumber, localizedName } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import { availableFarmAcres, toAcres } from '@shared/client/units';
import {
  LAND_UNITS,
  type CreateCropInput,
  type CropStatus,
  type LandUnit,
  type RegistrySummary,
  type SupportLevel,
} from '@shared/types/api';

import { cropsApi, farmsApi, registryApi } from '../../api/endpoints';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Select, type SelectOption } from '../../components/ui/Select';
import { ErrorState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { useApiErrorMessage } from '../../hooks/useApiError';
import type { FarmStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { spacing } from '../../theme';

type Props = NativeStackScreenProps<FarmStackParamList, 'CropForm'>;

/** `backend/src/config/constants.js`. */
const SOWING_MAX_PAST_DAYS = 400;
const SOWING_MAX_FUTURE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

const VARIETY_MAX = 60;
const FREE_TEXT_MAX = 60;

/**
 * The registry's escape hatch: the API accepts a code it does not know only
 * when the farmer supplies their own label for it (`resolveCropCode`).
 */
const OTHER = 'OTHER';

/**
 * Best-supported first. A farmer choosing between two crops deserves to see
 * that one of them will produce real advice and the other will not.
 */
const SUPPORT_ORDER: SupportLevel[] = ['SPECIALIZED', 'GENERAL', 'LIMITED', 'UNSUPPORTED'];

type FieldName = 'cropCode' | 'freeTextLabel' | 'sowingDate' | 'areaValue';
type Errors = Partial<Record<FieldName, string>>;

/** Local midnight, and `null` for anything that is not a real calendar day. */
function parseSowingDate(day: string, month: string, year: string): Date | null {
  const d = Number(day.trim());
  const m = Number(month.trim());
  const y = Number(year.trim());

  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(y, m - 1, d);
  // JS rolls 31 February into March rather than rejecting it.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;

  return date;
}

export function CropFormScreen({ route, navigation }: Props) {
  const { farmId } = route.params;
  const { t } = useTranslation(['crop', 'common', 'agri', 'mobile']);
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();

  const today = useMemo(() => new Date(), []);

  const [cropCode, setCropCode] = useState('');
  const [freeTextLabel, setFreeTextLabel] = useState('');
  const [day, setDay] = useState(String(today.getDate()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [year, setYear] = useState(String(today.getFullYear()));
  const [variety, setVariety] = useState('');
  const [areaValue, setAreaValue] = useState('');
  const [areaUnit, setAreaUnit] = useState<LandUnit>('acre');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const clearError = (field: FieldName) =>
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));

  const registryQuery = useQuery({
    queryKey: queryKeys.registry.list(),
    queryFn: registryApi.list,
    staleTime: STALE_TIME.registry,
  });

  /**
   * The farm this crop is going onto: the context line under the title, and
   * the remaining-area figure the ledger validates against.
   */
  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(farmId),
    queryFn: () => farmsApi.get(farmId),
  });

  const availableAcres = farmQuery.data
    ? availableFarmAcres(farmQuery.data.farm, farmQuery.data.crops)
    : null;

  const availableLabel =
    availableAcres == null
      ? undefined
      : t('crop:areaAvailable', {
          amount: `${formatNumber(availableAcres, language, {
            maximumFractionDigits: 2,
          })} ${t('common:unit.acre')}`,
        });

  const crops = registryQuery.data?.data.crops;

  const cropOptions = useMemo<SelectOption<string>[]>(() => {
    const listed = [...(crops ?? [])].sort(
      (a, b) => supportRank(a) - supportRank(b) || codeOrder(a, b, language),
    );

    return [
      ...listed.map((crop) => ({
        value: crop.cropCode,
        label: localizedName(crop.names, language)?.text ?? crop.cropCode,
        // The picker has no group headers, so how much the platform actually
        // knows about each crop rides along on the row itself.
        description: t(`agri:support.${crop.supportLevel}`),
      })),
      { value: OTHER, label: t('crop:otherOption') },
    ];
  }, [crops, language, t]);

  const unitOptions = useMemo<SelectOption<LandUnit>[]>(
    () => LAND_UNITS.map((unit) => ({ value: unit, label: t(`common:unit.${unit}`) })),
    [t],
  );

  // A code the farmer picked before the registry finished loading cannot
  // happen, but a registry that reloads without the code they picked can —
  // clearing it is better than submitting a code that is no longer offered.
  useEffect(() => {
    if (!crops || !cropCode || cropCode === OTHER) return;
    if (!crops.some((crop) => crop.cropCode === cropCode)) setCropCode('');
  }, [crops, cropCode]);

  const sowingDate = parseSowingDate(day, month, year);

  /** What the server will record. Shown, not chosen — see the module comment. */
  const derivedStatus: CropStatus =
    sowingDate && sowingDate.getTime() > Date.now() ? 'planned' : 'active';

  const create = useMutation({
    mutationFn: (values: CreateCropInput) => cropsApi.create(farmId, values),
    onSuccess: ({ crop }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.all() });
      // A new crop changes the dashboard's card set and, after the next feed
      // job, its advice.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      navigation.replace('CropDetail', { cropId: crop.id });
    },
    onError: (error) => setFormError(toMessage(error)),
  });

  const submit = () => {
    const next: Errors = {};
    const label = freeTextLabel.trim();

    if (!cropCode) next.cropCode = t('common:validation.required');
    if (cropCode === OTHER && !label) next.freeTextLabel = t('common:validation.required');

    const now = Date.now();
    if (!sowingDate) {
      next.sowingDate = t('common:validation.required');
    } else if (
      sowingDate.getTime() < now - SOWING_MAX_PAST_DAYS * DAY_MS ||
      sowingDate.getTime() > now + SOWING_MAX_FUTURE_DAYS * DAY_MS
    ) {
      // The hint already states the window, so it doubles as the refusal.
      next.sowingDate = t('crop:sowingDateHint', {
        past: SOWING_MAX_PAST_DAYS,
        future: SOWING_MAX_FUTURE_DAYS,
      });
    }

    const rawArea = areaValue.trim();
    const area = rawArea === '' ? Number.NaN : Number(rawArea);
    const hasArea = Number.isFinite(area) && area > 0;

    if (rawArea !== '' && !hasArea) {
      next.areaValue = t('common:validation.minValue', { min: 0.01 });
    }

    // ── The land ledger ───────────────────────────────────────────────────
    if (availableAcres != null && hasArea && toAcres(area, areaUnit) > availableAcres + 1e-9) {
      next.areaValue = t('crop:areaExceedsFarm');
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (!sowingDate) return;

    setFormError(null);
    create.mutate({
      cropCode,
      ...(cropCode === OTHER && label ? { freeTextLabel: label } : {}),
      // The API coerces to a Date; an ISO instant is unambiguous either way.
      sowingDate: sowingDate.toISOString(),
      ...(variety.trim() ? { variety: variety.trim() } : {}),
      // areaUnit travels with areaValue or neither travels at all.
      ...(hasArea ? { areaValue: area, areaUnit } : {}),
    });
  };

  const farm = farmQuery.data?.farm;

  return (
    <Screen keyboardAvoiding edges={['left', 'right', 'bottom']}>
      {farm ? (
        <Text variant="small" color="ink500">
          {[farm.name, farm.location.district].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {formError ? (
        <Notice tone="danger" testID="crop-form-error">
          <Text variant="small" color="ink700">
            {formError}
          </Text>
        </Notice>
      ) : null}

      {/*
        The crop picker is this form's one load-bearing fetch. When it fails the
        sheet would otherwise offer only "Another crop", which reads as though
        the platform supports nothing at all.
      */}
      {registryQuery.isError ? (
        <ErrorState
          message={t('crop:registryLoadError')}
          onRetry={() => void registryQuery.refetch()}
          testID="crop-registry-error"
        />
      ) : null}

      <Select
        label={t('crop:cropCodeLabel')}
        options={cropOptions}
        value={cropCode || undefined}
        onChange={(value) => {
          setCropCode(value);
          clearError('cropCode');
        }}
        placeholder={t('crop:cropCodePlaceholder')}
        error={errors.cropCode}
        required
        disabled={registryQuery.isPending}
        testID="crop-code"
      />

      {cropCode === OTHER ? (
        <>
          <Input
            label={t('crop:freeTextLabel')}
            value={freeTextLabel}
            onChangeText={(value) => {
              setFreeTextLabel(value);
              clearError('freeTextLabel');
            }}
            error={errors.freeTextLabel}
            required
            maxLength={FREE_TEXT_MAX}
            testID="crop-free-text"
          />
          {/*
            Said before the crop is created, not after: the platform's advice is
            registry-driven, and a crop outside it genuinely gets less.
          */}
          <Notice tone="warning">
            <Text variant="small" color="ink700">
              {t('crop:freeTextHint')}
            </Text>
          </Notice>
        </>
      ) : null}

      <SectionHeader
        title={t('crop:sowingDateLabel')}
        description={t('crop:sowingDateHint', {
          past: SOWING_MAX_PAST_DAYS,
          future: SOWING_MAX_FUTURE_DAYS,
        })}
      />

      <View style={styles.dateRow}>
        <Input
          label={t('mobile:date.day')}
          value={day}
          onChangeText={(value) => {
            setDay(value);
            clearError('sowingDate');
          }}
          keyboardType="number-pad"
          maxLength={2}
          containerStyle={styles.datePart}
          testID="crop-sowing-day"
        />
        <Input
          label={t('mobile:date.month')}
          value={month}
          onChangeText={(value) => {
            setMonth(value);
            clearError('sowingDate');
          }}
          keyboardType="number-pad"
          maxLength={2}
          containerStyle={styles.datePart}
          testID="crop-sowing-month"
        />
        <Input
          label={t('mobile:date.year')}
          value={year}
          onChangeText={(value) => {
            setYear(value);
            clearError('sowingDate');
          }}
          keyboardType="number-pad"
          maxLength={4}
          containerStyle={styles.datePart}
          testID="crop-sowing-year"
        />
      </View>

      {errors.sowingDate ? (
        <Text
          variant="caption"
          color="danger600"
          accessibilityLiveRegion="polite"
          testID="crop-sowing-error"
        >
          {errors.sowingDate}
        </Text>
      ) : null}

      <View style={styles.status}>
        <Text variant="small" color="ink700">
          {t('crop:statusLabel')}
        </Text>
        <Badge tone="brand">{t(`agri:cropStatus.${derivedStatus}`)}</Badge>
      </View>

      <Input
        label={t('crop:varietyLabel')}
        value={variety}
        onChangeText={setVariety}
        placeholder={t('crop:varietyPlaceholder')}
        maxLength={VARIETY_MAX}
        testID="crop-variety"
      />

      <Input
        label={t('crop:areaLabel')}
        value={areaValue}
        onChangeText={(value) => {
          setAreaValue(value);
          clearError('areaValue');
        }}
        hint={availableLabel}
        error={errors.areaValue}
        keyboardType="decimal-pad"
        testID="crop-area"
      />

      <Select
        label={t('crop:areaUnitLabel')}
        options={unitOptions}
        value={areaUnit}
        onChange={(value) => {
          setAreaUnit(value);
          clearError('areaValue');
        }}
        // Required only in the sense the server means it: an area needs a unit.
        required={areaValue.trim() !== ''}
        testID="crop-area-unit"
      />

      <Button size="lg" fullWidth onPress={submit} loading={create.isPending} testID="crop-submit">
        {t('crop:saveCta')}
      </Button>
    </Screen>
  );
}

const supportRank = (crop: RegistrySummary): number => {
  const index = SUPPORT_ORDER.indexOf(crop.supportLevel);
  return index === -1 ? SUPPORT_ORDER.length : index;
};

const codeOrder = (a: RegistrySummary, b: RegistrySummary, language: 'en' | 'hi'): number =>
  (localizedName(a.names, language)?.text ?? a.cropCode).localeCompare(
    localizedName(b.names, language)?.text ?? b.cropCode,
  );

const styles = StyleSheet.create({
  dateRow: { flexDirection: 'row', gap: spacing.md },
  datePart: { flex: 1 },
  status: { gap: spacing.xs },
});
