/**
 * Published fertilizer guidance.
 *
 * Everything here is a number somebody else published, shown in the unit they
 * published it in, with the source named beneath it. Nothing on this screen
 * converts, rounds or recombines a figure, because the published figure is the
 * whole authority for it.
 *
 * Three pieces are unconditional — `fertilizerService.js` attaches them before
 * any early return, and they are rendered for the *uncovered* case too, which
 * is exactly when a farmer is most likely to go looking for a number somewhere
 * less careful: the disclaimer, the "general recommendation, not a
 * prescription" framing, and the soil-test nudge.
 *
 * ## The schedule shape, as the server actually sends it
 *
 * A step is `{stage, timing, fractionKey, note, window, isCurrent,
 * timingUnknown}`. Two things follow, and both are easy to get wrong:
 *
 * - **`fractionKey` is an i18n key; `timing` and `note` are not.** They are
 *   quoted source text in English ("30 DAS", "before 1st irrigation"), so they
 *   are shown as-is under a heading that says they are quoted rather than
 *   silently mixed into translated copy.
 * - **`stage` is a canonical identifier**, not a label, so it is never printed
 *   (rule 4). `fractionKey` already describes the application in words.
 * - `window.basis` is the same string as `timing`, so rendering the window
 *   separately would only repeat it.
 *
 * `timingUnknown` means the published timing could not be resolved to a day
 * range — a real state that has to be said out loud rather than left as a
 * blank slot.
 */
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type {
  FertilizerGuidance,
  FertilizerRecommendation,
  FertilizerScheduleStep,
  SourceRef,
} from '@shared/types/api';

import { EMPTY_VALUE } from '@shared/client/format';

import { translateMessageKey } from '../../i18n/messageKey';
import { colors, radius, spacing } from '../../theme';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { EmptyState, Notice } from '../ui/states';
import { Text } from '../ui/Text';

/** Bookkeeping fields `presentDose()` adds — not nutrients, never rendered as one. */
const DOSE_META = new Set(['unitUnknown', 'unitNoteKey']);

export function FertilizerGuidanceView({ guidance }: { guidance: FertilizerGuidance }) {
  const { t } = useTranslation(['fertilizer', 'common', 'agri', 'mobile']);

  if (!guidance.covered) {
    return (
      <View style={styles.stack}>
        <EmptyState title={translateMessageKey(t, guidance.reasonKey ?? 'fertilizer.notCovered')} />
        <Notice tone="info" testID="fertilizer-disclaimer">
          <Text variant="small" color="ink700">
            {translateMessageKey(t, guidance.disclaimerKey)}
          </Text>
        </Notice>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {guidance.stage || guidance.guidanceTypeKey ? (
        <View style={styles.chips}>
          {guidance.stage ? <Badge tone="brand">{t(`agri:stage.${guidance.stage}`)}</Badge> : null}
          {guidance.guidanceTypeKey ? (
            <Badge>{translateMessageKey(t, guidance.guidanceTypeKey)}</Badge>
          ) : null}
        </View>
      ) : null}

      {/*
        Doses still awaiting a check against the original publication. Surfaced,
        never hidden — a farmer reading a number is entitled to know which tier
        of confidence it sits in.
      */}
      {guidance.verificationPending && guidance.verificationNoteKey ? (
        <Notice tone="warning" testID="fertilizer-verification-pending">
          <Text variant="small" color="ink700">
            {translateMessageKey(t, guidance.verificationNoteKey)}
          </Text>
        </Notice>
      ) : null}

      {guidance.recommendations.map((recommendation, index) => (
        <RecommendationCard key={index} recommendation={recommendation} />
      ))}

      {guidance.limitationsKey ? (
        <Notice tone="info">
          <Text variant="small" color="ink700">
            {translateMessageKey(t, guidance.limitationsKey)}
          </Text>
        </Notice>
      ) : null}

      {guidance.soilTestCtaKey ? (
        <Notice tone="info" testID="fertilizer-soil-test-cta">
          <Text variant="small" color="ink700">
            {translateMessageKey(t, guidance.soilTestCtaKey)}
          </Text>
        </Notice>
      ) : null}

      <SourceList sources={guidance.sources} />

      {/* Mandatory, always last, never dismissible. */}
      <Notice tone="warning" testID="fertilizer-disclaimer">
        <Text variant="small" color="ink700">
          {translateMessageKey(t, guidance.disclaimerKey)}
        </Text>
      </Notice>
    </View>
  );
}

function RecommendationCard({ recommendation }: { recommendation: FertilizerRecommendation }) {
  const { t } = useTranslation(['fertilizer', 'common', 'mobile']);

  return (
    <Card testID="fertilizer-recommendation">
      <View style={styles.stack}>
        <View style={styles.chips}>
          <Badge tone="brand">
            {recommendation.basis === 'stcr_soil_test'
              ? t('fertilizer:basisSoilTest')
              : t('fertilizer:basisBlanket')}
          </Badge>
        </View>

        <Text variant="small" color="ink500">
          {recommendation.varietyClass
            ? t('fertilizer:varietyClassLabel', { varietyClass: recommendation.varietyClass })
            : t('fertilizer:varietyClassUnspecified')}
        </Text>

        <DoseTable title={t('fertilizer:npkHeading')} dose={recommendation.totalNpk} />
        <DoseTable title={t('fertilizer:organicsHeading')} dose={recommendation.organics} />
        <DoseTable
          title={t('fertilizer:micronutrientsHeading')}
          dose={recommendation.micronutrients}
        />

        {recommendation.schedule.length > 0 ? (
          <View style={styles.section}>
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('fertilizer:scheduleHeading')}
            </Text>
            {recommendation.schedule.map((step, index) => (
              <ScheduleRow key={index} step={step} />
            ))}
          </View>
        ) : null}

        <SourceList sources={[recommendation.source]} />
      </View>
    </Card>
  );
}

function ScheduleRow({ step }: { step: FertilizerScheduleStep }) {
  const { t } = useTranslation(['fertilizer', 'mobile']);

  const quoted = [step.timing, step.note].filter((value): value is string => Boolean(value));

  return (
    <View style={[styles.scheduleRow, step.isCurrent ? styles.scheduleCurrent : null]}>
      <View style={styles.scheduleHead}>
        <Text variant="body" style={styles.flexText}>
          {translateMessageKey(t, step.fractionKey)}
        </Text>
        {step.isCurrent ? <Badge tone="warn">{t('fertilizer:dueNow')}</Badge> : null}
      </View>

      {quoted.length > 0 ? (
        <View style={styles.quote}>
          <Text variant="caption" color="ink500">
            {t('mobile:fertilizer.quotedSourceHeading')}
          </Text>
          {quoted.map((line) => (
            <Text key={line} variant="small" color="ink700">
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {step.timingUnknown ? (
        <Text variant="caption" color="ink500">
          {t('mobile:fertilizer.timingUnknown')}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Doses rendered exactly as published — the key names the nutrient and the
 * value carries its own unit. A dose the source printed with no unit at all
 * says so instead of borrowing one.
 */
function DoseTable({ title, dose }: { title: string; dose: Record<string, unknown> | null }) {
  const { t } = useTranslation(['fertilizer', 'mobile']);

  const entries = dose
    ? Object.entries(dose).filter(([key, value]) => value != null && !DOSE_META.has(key))
    : [];
  if (entries.length === 0) return null;

  const unitNoteKey = typeof dose?.unitNoteKey === 'string' ? dose.unitNoteKey : null;

  return (
    <View style={styles.section}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>
      {entries.map(([nutrient, value]) => (
        <View key={nutrient} style={styles.doseRow}>
          <Text variant="small" color="ink500" numberOfLines={1} style={styles.flexText}>
            {nutrient}
          </Text>
          <Text variant="bodyStrong">{formatDoseValue(value)}</Text>
        </View>
      ))}
      {unitNoteKey ? (
        <Text variant="caption" color="ink500">
          {translateMessageKey(t, unitNoteKey)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A dose cell.
 *
 * The registry's published doses are `{value, unit}`, but the field is typed
 * loosely on the wire and the knowledge base is authored by hand, so an
 * unexpected shape is possible. The fallback deliberately does NOT stringify
 * the object: `{"n":40,"p":20}` on screen is developer output, and rule 8
 * exists to keep that away from a farmer. Primitive entries are rendered as
 * readable pairs instead, and anything stranger degrades to the same em dash
 * every other unknown value uses.
 */
function formatDoseValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_VALUE;

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const amount = record.value ?? record.amount;
    const unit = record.unit;
    if (amount !== undefined) return `${String(amount)}${unit ? ` ${String(unit)}` : ''}`;

    const pairs = Object.entries(record).filter(
      ([, entry]) => typeof entry === 'string' || typeof entry === 'number',
    );
    if (pairs.length > 0) {
      return pairs.map(([key, entry]) => `${key.toUpperCase()} ${String(entry)}`).join(' · ');
    }
    return EMPTY_VALUE;
  }

  return String(value);
}

/**
 * Attribution. URLs are printed rather than linked: opening a browser is a
 * navigation off the app on a connection that may not carry it, and the
 * citation is the point.
 */
export function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) return null;

  return (
    <View style={styles.sources} testID="source-list">
      {sources.map((source, index) => (
        <Text key={`${source.org}-${index}`} variant="caption" color="ink500">
          {[source.org, source.title, source.url].filter(Boolean).join(' — ')}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  section: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexText: { flexShrink: 1 },
  doseRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  scheduleRow: {
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  scheduleCurrent: { borderWidth: 1, borderColor: colors.priorityMedium },
  scheduleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  quote: {
    gap: 2,
    borderLeftWidth: 2,
    borderLeftColor: colors.line,
    paddingLeft: spacing.sm,
  },
  sources: { gap: 2 },
});
