/**
 * Farm create and edit, one screen.
 *
 * The validation mirrors `createFarmSchema` in `backend/src/routes/farms.js`
 * and the web's `FarmForm` — same bounds, same enums, same "half a coordinate
 * is not a location" rule — so the device refuses what the server would refuse,
 * in the farmer's own language, before spending a round trip on a connection
 * that may not have one to spare. The server still validates every field: this
 * is a courtesy, never the control.
 *
 * ## The land ledger, mirror half
 *
 * A farm may not shrink below the ground its crops already occupy. The server
 * enforces it (`farm.sizeBelowCropArea`); this screen computes the same figure
 * from the crops the detail endpoint returned, with the same
 * `allocatedCropAcres` helper the web uses and the same conversion table the
 * backend uses, so the two cannot disagree about what "3 bigha" is. The point
 * of checking here is not to be trusted — it is to *explain*, at the moment the
 * farmer types the number, instead of returning a 422 they have to interpret.
 * On create there is nothing allocated yet, so the check is simply absent
 * rather than defaulted to zero.
 *
 * ## Location
 *
 * The manual state/district path is the primary one and is always on screen.
 * GPS is an accelerator that fills two fields which stay editable afterwards —
 * every way it can fail (refused, services off, no fix, outside India) falls
 * through to typing, and none of them blocks the form.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { isApiError } from '@shared/client/errors';
import { queryKeys } from '@shared/client/queryKeys';
import { allocatedCropAcres, toAcres } from '@shared/client/units';
import {
  INDIA_BOUNDS,
  IRRIGATION_METHODS,
  LAND_UNITS,
  SOIL_TYPES,
  type FarmInput,
  type IrrigationMethod,
  type LandUnit,
  type SoilType,
} from '@shared/types/api';

import { farmsApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Select, type SelectOption } from '../../components/ui/Select';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { EmptyState, LoadingState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { IconLocation } from '../../components/ui/icons';
import { useApiErrorMessage } from '../../hooks/useApiError';
import { useGeolocation, type GeolocationErrorKind } from '../../hooks/useGeolocation';
import type { FarmStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';

type Props = NativeStackScreenProps<FarmStackParamList, 'FarmForm'>;

const MIN_SIZE = 0.01;
const NAME_MAX = 80;
const PLACE_MAX = 60;
const VILLAGE_MAX = 80;
const NOTES_MAX = 500;

/**
 * `denied` is missing on purpose: a refused permission is answered with the
 * mobile permission notice, which says what to do about it, rather than with
 * the web's generic sentence.
 */
const GPS_ERROR_KEY: Record<Exclude<GeolocationErrorKind, 'denied'>, string> = {
  unavailable: 'farm:gpsUnavailable',
  timeout: 'farm:gpsTimeout',
  'outside-india': 'farm:gpsOutsideIndia',
};

interface FormState {
  name: string;
  state: string;
  district: string;
  village: string;
  lat: string;
  lon: string;
  sizeValue: string;
  sizeUnit: LandUnit;
  soilType: SoilType;
  irrigationMethod: IrrigationMethod;
  notes: string;
}

type FieldName = 'state' | 'district' | 'lat' | 'lon' | 'sizeValue';
type Errors = Partial<Record<FieldName, string>>;

const EMPTY_FORM: FormState = {
  name: '',
  state: '',
  district: '',
  village: '',
  lat: '',
  lon: '',
  sizeValue: '1',
  sizeUnit: 'acre',
  soilType: 'unknown',
  irrigationMethod: 'unknown',
  notes: '',
};

/** `''` is "not given", which is not the same as `0` — hence not `Number('')`. */
const parseCoordinate = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export function FarmFormScreen({ route, navigation }: Props) {
  const { t } = useTranslation(['farm', 'common', 'agri', 'mobile', 'errors']);
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();
  const gps = useGeolocation();

  const farmId = route.params?.farmId;
  const isEdit = Boolean(farmId);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    if (key in errors) setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(farmId ?? ''),
    queryFn: () => farmsApi.get(farmId ?? ''),
    enabled: isEdit,
  });

  /*
   * Hydrate once. A second pass — after a background refetch, say — would
   * overwrite whatever the farmer had half-typed at the moment it landed.
   */
  const hydrated = useRef(false);
  useEffect(() => {
    const farm = farmQuery.data?.farm;
    if (!farm || hydrated.current) return;
    hydrated.current = true;

    setForm({
      name: farm.name,
      state: farm.location.state,
      district: farm.location.district,
      village: farm.location.village ?? '',
      lat: farm.location.lat == null ? '' : String(farm.location.lat),
      lon: farm.location.lon == null ? '' : String(farm.location.lon),
      sizeValue: String(farm.sizeValue),
      sizeUnit: farm.sizeUnit,
      soilType: farm.soilType,
      irrigationMethod: farm.irrigationMethod,
      notes: farm.notes ?? '',
    });
  }, [farmQuery.data]);

  // A fix fills the two fields and leaves them editable — the form must not
  // become a read-only consequence of a permission dialog.
  useEffect(() => {
    if (!gps.coordinates) return;
    setForm((previous) => ({
      ...previous,
      lat: String(gps.coordinates?.lat ?? previous.lat),
      lon: String(gps.coordinates?.lon ?? previous.lon),
    }));
    setErrors((previous) => ({ ...previous, lat: undefined, lon: undefined }));
  }, [gps.coordinates]);

  /**
   * The ledger figure. Null on create, and null until the detail read lands on
   * edit — in both cases the client check simply does not run, and the server
   * remains the enforcement point.
   */
  const allocatedAcres = useMemo(() => {
    if (!isEdit || !farmQuery.data) return null;
    return allocatedCropAcres(farmQuery.data.crops);
  }, [isEdit, farmQuery.data]);

  const save = useMutation({
    mutationFn: (values: FarmInput) =>
      farmId ? farmsApi.update(farmId, values) : farmsApi.create(values),
    onSuccess: ({ farm }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      // The dashboard swaps its onboarding payload for real content once a
      // first farm exists, and a moved farm sits in a different weather cell.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });

      if (farmId) navigation.goBack();
      else navigation.replace('FarmDetail', { farmId: farm.id });
    },
    onError: (error) => setFormError(toMessage(error)),
  });

  const submit = () => {
    const next: Errors = {};

    const state = form.state.trim();
    const district = form.district.trim();
    const village = form.village.trim();
    const name = form.name.trim();
    const notes = form.notes.trim();

    if (!state) next.state = t('common:validation.required');
    if (!district) next.district = t('common:validation.required');

    const size = Number(form.sizeValue.trim());
    const sizeValid = Number.isFinite(size) && size >= MIN_SIZE;
    if (!sizeValid) next.sizeValue = t('common:validation.minValue', { min: MIN_SIZE });

    const lat = parseCoordinate(form.lat);
    const lon = parseCoordinate(form.lon);
    const hasLat = lat !== undefined && !Number.isNaN(lat);
    const hasLon = lon !== undefined && !Number.isNaN(lon);

    if (lat !== undefined && Number.isNaN(lat)) next.lat = t('common:validation.number');
    if (lon !== undefined && Number.isNaN(lon)) next.lon = t('common:validation.number');

    // Half a coordinate is not a location — the server says so too.
    if (!next.lat && !next.lon && hasLat !== hasLon) {
      if (hasLat) next.lon = t('common:validation.required');
      else next.lat = t('common:validation.required');
    }

    if (hasLat && (lat < INDIA_BOUNDS.minLat || lat > INDIA_BOUNDS.maxLat)) {
      next.lat = t('common:validation.outsideIndia');
    }
    if (hasLon && (lon < INDIA_BOUNDS.minLon || lon > INDIA_BOUNDS.maxLon)) {
      next.lon = t('common:validation.outsideIndia');
    }

    // ── The land ledger, mirror half ──────────────────────────────────────
    if (
      allocatedAcres != null &&
      sizeValid &&
      toAcres(size, form.sizeUnit) + 1e-9 < allocatedAcres
    ) {
      next.sizeValue = t('farm:sizeBelowCropArea');
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const hasCoordinates = hasLat && hasLon;

    setFormError(null);
    save.mutate({
      /*
       * A name the farmer never has to think about. "North Field" is a
       * developer's mental model; an empty name becomes the village, then the
       * district, and stays editable afterwards.
       */
      name: name || village || district || t('farm:defaultName'),
      location: {
        ...(hasCoordinates ? { lat, lon } : {}),
        state,
        district,
        ...(village ? { village } : {}),
        // 'gps' asserts that a device measured this position, so it is only
        // claimed when the device actually did. A typed coordinate is manual.
        source: hasCoordinates && gps.coordinates ? 'gps' : 'manual',
      },
      sizeValue: size,
      sizeUnit: form.sizeUnit,
      soilType: form.soilType,
      irrigationMethod: form.irrigationMethod,
      ...(notes ? { notes } : {}),
    });
  };

  const unitOptions = useMemo<SelectOption<LandUnit>[]>(
    () => LAND_UNITS.map((unit) => ({ value: unit, label: t(`common:unit.${unit}`) })),
    [t],
  );
  const soilOptions = useMemo<SelectOption<SoilType>[]>(
    () => SOIL_TYPES.map((soil) => ({ value: soil, label: t(`agri:soil.${soil}`) })),
    [t],
  );
  const irrigationOptions = useMemo<SelectOption<IrrigationMethod>[]>(
    () =>
      IRRIGATION_METHODS.map((method) => ({
        value: method,
        label: t(`agri:irrigationMethod.${method}`),
      })),
    [t],
  );

  // Ownership failures are 404 by design (docs/security): a farm that belongs
  // to someone else is indistinguishable from one that does not exist, and it
  // is presented that way rather than as something that went wrong.
  if (isEdit && isApiError(farmQuery.error) && farmQuery.error.status === 404) {
    return (
      <Screen>
        <EmptyState
          title={t('errors:notFound')}
          action={
            <Button variant="secondary" onPress={() => navigation.goBack()}>
              {t('common:action.back')}
            </Button>
          }
          testID="farm-form-not-found"
        />
      </Screen>
    );
  }

  if (isEdit && farmQuery.isPending) {
    return (
      <Screen>
        <LoadingState skeleton={<SkeletonCard />} />
      </Screen>
    );
  }

  if (isEdit && farmQuery.data === undefined) {
    return (
      <Screen>
        <EmptyState
          title={t('common:state.error')}
          action={
            <Button variant="secondary" onPress={() => void farmQuery.refetch()}>
              {t('common:action.retry')}
            </Button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen keyboardAvoiding edges={['left', 'right', 'bottom']}>
      {formError ? (
        <Notice tone="danger" testID="farm-form-error">
          <Text variant="small" color="ink700">
            {formError}
          </Text>
        </Notice>
      ) : null}

      <SectionHeader title={t('farm:locationHeading')} description={t('farm:locationWhy')} />

      {/*
        The rationale is on screen *before* the OS sheet appears, which is what
        docs/mobile asks for: a permission dialog that arrives unexplained is
        the one a farmer refuses.
      */}
      <View style={styles.permission}>
        <Text variant="bodyStrong">{t('mobile:permission.locationTitle')}</Text>
        <Text variant="small" color="ink700">
          {t('mobile:permission.locationBody')}
        </Text>
        <Button
          variant="secondary"
          onPress={gps.locate}
          loading={gps.isLocating}
          leadingIcon={<IconLocation size={18} color={colors.brand600} />}
          testID="farm-gps"
        >
          {gps.isLocating ? t('farm:gpsLocating') : t('mobile:permission.locationCta')}
        </Button>
      </View>

      {gps.error === 'denied' ? (
        <Notice tone="warning" testID="farm-gps-denied">
          <View style={styles.noticeBody}>
            <Text variant="bodyStrong" color="ink700">
              {t('mobile:permission.locationDeniedTitle')}
            </Text>
            <Text variant="small" color="ink700">
              {t('mobile:permission.locationDeniedBody')}
            </Text>
            {gps.mustOpenSettings ? (
              <Button variant="ghost" onPress={() => void Linking.openSettings()}>
                {t('mobile:permission.openSettings')}
              </Button>
            ) : null}
          </View>
        </Notice>
      ) : null}

      {gps.error && gps.error !== 'denied' ? (
        <Notice tone="warning" testID="farm-gps-error">
          <Text variant="small" color="ink700">
            {t(GPS_ERROR_KEY[gps.error])}
          </Text>
        </Notice>
      ) : null}

      {gps.coordinates && !gps.error ? (
        <Notice tone="info" testID="farm-gps-success">
          <Text variant="small" color="ink700">
            {t('farm:gpsSuccess')}
          </Text>
        </Notice>
      ) : null}

      <Text variant="bodyStrong">{t('farm:manualHeading')}</Text>

      <Input
        label={t('farm:stateLabel')}
        value={form.state}
        onChangeText={(value) => set('state', value)}
        placeholder={t('farm:statePlaceholder')}
        error={errors.state}
        required
        maxLength={PLACE_MAX}
        testID="farm-state"
      />

      <Input
        label={t('farm:districtLabel')}
        value={form.district}
        onChangeText={(value) => set('district', value)}
        placeholder={t('farm:districtPlaceholder')}
        error={errors.district}
        required
        maxLength={PLACE_MAX}
        testID="farm-district"
      />

      <Input
        label={t('farm:villageLabel')}
        value={form.village}
        onChangeText={(value) => set('village', value)}
        placeholder={t('farm:villagePlaceholder')}
        maxLength={VILLAGE_MAX}
        testID="farm-village"
      />

      <SectionHeader title={t('farm:coordinatesHeading')} />

      <Input
        label={t('farm:latLabel')}
        value={form.lat}
        onChangeText={(value) => set('lat', value)}
        error={errors.lat}
        keyboardType="decimal-pad"
        testID="farm-lat"
      />

      <Input
        label={t('farm:lonLabel')}
        value={form.lon}
        onChangeText={(value) => set('lon', value)}
        error={errors.lon}
        keyboardType="decimal-pad"
        testID="farm-lon"
      />

      <SectionHeader title={t('farm:detailTitle')} />

      <Input
        label={t('farm:nameLabel')}
        value={form.name}
        onChangeText={(value) => set('name', value)}
        placeholder={t('farm:namePlaceholder')}
        hint={t('farm:nameOptionalHint')}
        maxLength={NAME_MAX}
        testID="farm-name"
      />

      <Input
        label={t('farm:sizeLabel')}
        value={form.sizeValue}
        onChangeText={(value) => set('sizeValue', value)}
        error={errors.sizeValue}
        required
        keyboardType="decimal-pad"
        testID="farm-size"
      />

      <Select
        label={t('farm:sizeUnitLabel')}
        options={unitOptions}
        value={form.sizeUnit}
        onChange={(value) => set('sizeUnit', value)}
        required
        testID="farm-size-unit"
      />

      <Select
        label={t('farm:soilLabel')}
        options={soilOptions}
        value={form.soilType}
        onChange={(value) => set('soilType', value)}
        hint={form.soilType === 'unknown' ? t('farm:soilUnknownNudge') : undefined}
        testID="farm-soil"
      />

      <Select
        label={t('farm:irrigationLabel')}
        options={irrigationOptions}
        value={form.irrigationMethod}
        onChange={(value) => set('irrigationMethod', value)}
        testID="farm-irrigation"
      />

      <Input
        label={t('farm:notesLabel')}
        value={form.notes}
        onChangeText={(value) => set('notes', value)}
        placeholder={t('farm:notesPlaceholder')}
        multiline
        maxLength={NOTES_MAX}
        testID="farm-notes"
      />

      <Button size="lg" fullWidth onPress={submit} loading={save.isPending} testID="farm-submit">
        {isEdit ? t('farm:saveCta') : t('farm:createCta')}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  permission: { gap: spacing.sm },
  noticeBody: { gap: spacing.sm, alignItems: 'flex-start' },
});
