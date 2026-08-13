/**
 * Today's watering verdict.
 *
 * Verdict-first: the answer is the heading, the amount is the number under it,
 * and the reasoning is one tap away. The engine's own i18n keys carry both the
 * headline and the body, so this component chooses no words.
 *
 * ## Every branch the engine can take has a design here
 *
 * `computeIrrigation.js` can answer in three shapes and this renders all three
 * rather than treating two of them as errors:
 *
 * 1. **A verdict.** `IRRIGATE_TODAY`, `IRRIGATE_IN_N_DAYS`,
 *    `WAIT_RAIN_EXPECTED`, `NO_IRRIGATION_NEEDED`, `MAINTAIN_WATER_LEVEL`.
 * 2. **`verdict: 'UNAVAILABLE'` with `hasVerdict: false`** — the inputs were
 *    missing (`NO_WEATHER`, `NO_FORECAST`, `CROP_NOT_ACTIVE`,
 *    `SOIL_RESERVOIR_UNKNOWN`, and `SIMPLIFIED_INTERVALS_NOT_SOURCED`, which is
 *    a real and common state: no knowledge file authors `simplifiedIntervals`,
 *    so a forecast without evapotranspiration has nothing to fall back on).
 * 3. **`verdict: null`** — the engine declined to reach one at all
 *    (`BEYOND_SEASON`, `KC_UNAVAILABLE`), sometimes with `harvestApproaching`.
 *    Composing a key from that null would ask i18next for
 *    `irrigation.titlenull` and print a raw identifier at a farmer, so it
 *    collapses to the UNAVAILABLE copy and the reason code carries the answer.
 *
 * ## The honesty labels are mandatory, not decorative
 *
 * `mode: 'simplified'` means the forecast carried no evapotranspiration and the
 * estimate is rough; `soilUncertaintyWide` means the soil's available-water
 * figure is a wide published range, so the arithmetic carries more uncertainty
 * than a single number suggests; and the freshness dot says how old the weather
 * behind the whole calculation is. Any of them missing would present a guess as
 * a measurement.
 *
 * Note there is **no top-level `soil` object** on this response — the soil
 * inputs live only in the `SOIL` step of `trace`, which `WhyTrace` shows.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatDayMonth, formatNumber } from '@shared/client/format';
import type { IrrigationAdvice } from '@shared/types/api';

import { translateMessageKey } from '../../i18n/messageKey';
import { useLanguage } from '../../store/LanguageContext';
import { colors, radius, spacing } from '../../theme';
import { Card } from '../ui/Card';
import { FreshnessDot } from '../ui/FreshnessDot';
import { Notice } from '../ui/states';
import { IconDroplet } from '../ui/icons';
import { Text } from '../ui/Text';
import { SpeakButton, WhyTrace } from './WhyTrace';

/** Tint per verdict. Colour is a second signal — the words carry the meaning. */
const VERDICT_TINT: Record<string, { fill: string; border: string }> = {
  IRRIGATE_TODAY: { fill: colors.priorityHighSoft, border: colors.priorityHigh },
  IRRIGATE_IN_N_DAYS: { fill: colors.priorityMediumSoft, border: colors.priorityMedium },
  WAIT_RAIN_EXPECTED: { fill: colors.brand50, border: colors.brand200 },
  NO_IRRIGATION_NEEDED: { fill: colors.brand50, border: colors.brand200 },
  MAINTAIN_WATER_LEVEL: { fill: colors.brand50, border: colors.brand200 },
  UNAVAILABLE: { fill: colors.canvas, border: colors.line },
};

export interface IrrigationVerdictCardProps {
  advice: IrrigationAdvice;
  /** The "record watering" control, supplied by the screen that owns it. */
  action?: ReactNode;
}

export function IrrigationVerdictCard({ advice, action }: IrrigationVerdictCardProps) {
  const { t } = useTranslation(['irrigation', 'common', 'mobile', 'agri']);
  const { language } = useLanguage();

  const verdict = advice.verdict ?? 'UNAVAILABLE';
  const tint = VERDICT_TINT[verdict] ?? VERDICT_TINT.UNAVAILABLE!;

  const params = {
    ...advice,
    days: advice.days ?? 0,
    amountMm: advice.amountMm ?? 0,
    amountLitersPerAcre: advice.amountLitersPerAcre ?? 0,
    rainMm: advice.rain?.mm ?? 0,
    date: advice.rain?.date ? formatDayMonth(advice.rain.date, language) : '',
  };

  const title = translateMessageKey(t, `irrigation.title${verdict}`, params);
  const body = translateMessageKey(t, `irrigation.body${verdict}`, params);

  // Every reason code the engine emits has a `reason*` string. An unmapped one
  // renders nothing rather than an identifier.
  const reason = advice.hasVerdict
    ? ''
    : t(`irrigation:reason${advice.reasonCode}`, { defaultValue: '' });

  return (
    <Card
      style={[styles.card, { backgroundColor: tint.fill, borderColor: tint.border }]}
      testID="irrigation-verdict"
    >
      <View style={styles.body}>
        <View style={styles.head}>
          <View style={styles.titleRow}>
            <IconDroplet size={22} color={colors.ink900} />
            <Text variant="heading" style={styles.flexText}>
              {title}
            </Text>
          </View>
          <SpeakButton text={[title, body, reason].filter(Boolean).join('. ')} />
        </View>

        <Text variant="body" color="ink700">
          {body}
        </Text>

        {reason ? (
          <Text variant="small" color="ink500" testID="irrigation-reason">
            {reason}
          </Text>
        ) : null}

        {advice.amountMm != null || advice.targetDepthCm != null || advice.depletionMm != null ? (
          <View style={styles.figures}>
            {advice.amountMm != null ? (
              <Figure
                label={t('irrigation:amountHeading')}
                value={`${formatNumber(advice.amountMm, language, { maximumFractionDigits: 1 })} ${t('common:unit.mm')}`}
              />
            ) : null}

            {advice.amountLitersPerAcre != null ? (
              <Figure
                label={t('common:unit.litresPerAcre')}
                value={formatNumber(advice.amountLitersPerAcre, language, {
                  maximumFractionDigits: 0,
                })}
              />
            ) : null}

            {advice.targetDepthCm != null ? (
              <Figure
                label={t('mobile:irrigation.targetDepthLabel')}
                value={`${formatNumber(advice.targetDepthCm, language)} ${t('common:unit.cm')}`}
              />
            ) : null}

            {advice.depletionMm != null ? (
              <Figure
                label={t('irrigation:depletionHeading')}
                value={`${formatNumber(advice.depletionMm, language, { maximumFractionDigits: 1 })} ${t('common:unit.mm')}`}
              />
            ) : null}
          </View>
        ) : null}

        {advice.nextCheckDays != null ? (
          <Text variant="small" color="ink700">
            {t('mobile:irrigation.nextCheckDays', { count: advice.nextCheckDays })}
          </Text>
        ) : null}

        {advice.harvestApproaching ? (
          <Notice tone="info">
            <Text variant="small" color="ink700">
              {t('mobile:irrigation.harvestApproaching')}
            </Text>
          </Notice>
        ) : null}

        {advice.splitAdvised ? (
          <Notice tone="warning">
            <Text variant="small" color="ink700">
              {t('irrigation:splitAdvised')}
            </Text>
          </Notice>
        ) : null}

        {advice.mode === 'simplified' ? (
          <Notice tone="warning" testID="irrigation-simplified">
            <Text variant="small" color="ink700">
              {t('irrigation:modeSimplified')}
            </Text>
          </Notice>
        ) : null}

        {advice.soilUncertaintyWide ? (
          <Notice tone="info" testID="irrigation-soil-uncertainty">
            <Text variant="small" color="ink700">
              {t('mobile:irrigation.soilUncertaintyWide')}
            </Text>
          </Notice>
        ) : null}

        <FreshnessDot
          status={advice.freshness.status}
          fetchedAt={advice.freshness.fetchedAt}
          ageHours={advice.freshness.ageHours}
          staleWarning={advice.freshness.staleWarning}
        />

        {action}

        <WhyTrace trace={advice.trace} />
      </View>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Text variant="caption" color="ink500">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  body: { gap: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flexText: { flexShrink: 1 },
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  figure: { gap: 2, minWidth: 120 },
});
