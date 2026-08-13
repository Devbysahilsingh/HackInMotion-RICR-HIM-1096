/**
 * How sure the system is — and, load-bearingly, *what kind* of sureness it is.
 *
 * The API sends `confidence` as a number in every case, but the number means
 * three different things depending on `confidenceKind`, and drawing them the
 * same way would be the most quietly dishonest thing this screen could do:
 *
 * - `CALIBRATED` — a temperature-scaled probability from the local model. The
 *   only kind a percentage may be printed for, and the only one drawn as a
 *   continuous fill.
 * - `BAND` — the AI tier's HIGH/MEDIUM/LOW. The backend maps those onto
 *   0.85/0.65/0.4 so the value is comparable internally; `constants.js` says in
 *   as many words that they "are NOT measured probabilities and must never be
 *   presented as one". So: no percentage at all, and a three-step segmented
 *   track that looks like a category rather than a measurement.
 * - `MATCH_SCORE` — the rule engine's weighted symptom score. A proportion of
 *   the tags that matched, not a probability; shown as a proportion, outlined
 *   rather than filled, and labelled as what it is.
 *
 * Ported from web/frontend/src/components/domain/ConfidenceBar.tsx, with the
 * shapes added: the web leans on `confidenceNotProbability` alone, which reads
 * fine on a desktop but is easy to miss on a phone held in sunlight.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatNumber } from '@shared/client/format';

import { useLanguage } from '../../store/LanguageContext';
import { colors, radius, spacing } from '../../theme';
import { Text } from '../ui/Text';

export type ConfidenceKind = 'CALIBRATED' | 'BAND' | 'MATCH_SCORE';
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

/** The three steps a `BAND` can occupy, weakest first. */
const BAND_STEPS: readonly ConfidenceBand[] = ['LOW', 'MEDIUM', 'HIGH'];

export interface ConfidenceBarProps {
  confidence: number | null | undefined;
  kind: ConfidenceKind | string | null | undefined;
  band?: ConfidenceBand | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ConfidenceBar({
  confidence,
  kind,
  band = null,
  style,
  testID,
}: ConfidenceBarProps) {
  const { t } = useTranslation(['health', 'mobile', 'common']);
  const { language } = useLanguage();

  // Nothing to draw is better than a zero-width bar implying "no confidence",
  // which is a claim of its own.
  if (confidence == null && !band) return null;

  const fraction = Math.min(1, Math.max(0, confidence ?? 0));
  const isCalibrated = kind === 'CALIBRATED';
  const isBand = kind === 'BAND';
  const isMatchScore = kind === 'MATCH_SCORE';

  const percentText = `${formatNumber(fraction * 100, language, { maximumFractionDigits: 0 })}${t(
    'common:unit.percent',
  )}`;

  const value = isBand
    ? band
      ? t(`health:confidenceBand${band}`)
      : t('health:confidenceNotProbability')
    : percentText;

  const tint =
    fraction >= 0.75
      ? colors.brand600
      : fraction >= 0.5
        ? colors.priorityMedium
        : colors.priorityHigh;

  const kindNoteKey = isCalibrated
    ? 'mobile:result.confidenceKindCALIBRATED'
    : isBand
      ? 'mobile:result.confidenceKindBAND'
      : isMatchScore
        ? 'mobile:result.confidenceKindMATCH_SCORE'
        : null;

  const spoken = `${t('health:confidenceHeading')}: ${value}`;

  return (
    <View style={[styles.block, style]} testID={testID}>
      <View style={styles.headRow}>
        <Text variant="small" color="ink700" style={styles.headLabel}>
          {t('health:confidenceHeading')}
        </Text>
        <Text variant="bodyStrong" testID="confidence-value">
          {value}
        </Text>
      </View>

      {/*
        One announcement for the whole control. A screen reader stepping
        through a track and three segments separately would say nothing the
        value line has not already said.
      */}
      <View accessible accessibilityLabel={spoken} accessibilityRole="progressbar">
        {isBand ? (
          <View style={styles.segments}>
            {BAND_STEPS.map((step, index) => {
              const reached = band ? index <= BAND_STEPS.indexOf(band) : false;
              return (
                <View
                  key={step}
                  style={[styles.segment, reached ? { backgroundColor: tint } : null]}
                />
              );
            })}
          </View>
        ) : (
          <View style={[styles.track, isMatchScore ? styles.trackOutlined : null]}>
            <View
              style={[
                styles.fill,
                { width: `${fraction * 100}%` },
                isMatchScore
                  ? { backgroundColor: colors.brand200, borderColor: tint, borderWidth: 1 }
                  : { backgroundColor: tint },
              ]}
            />
          </View>
        )}
      </View>

      {/*
        Said out loud rather than implied by the absence of a number: a band is
        not a probability and a match score is not a diagnosis, and a farmer
        reading "medium" deserves to be told that is a category.
      */}
      {kindNoteKey ? (
        <Text variant="caption" color="ink500">
          {t(kindNoteKey)}
        </Text>
      ) : null}
      {!isCalibrated ? (
        <Text variant="caption" color="ink500">
          {t('health:confidenceNotProbability')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xs },
  headRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headLabel: { flexShrink: 1 },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  trackOutlined: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  fill: { height: '100%', borderRadius: radius.pill },
  segments: { flexDirection: 'row', gap: spacing.xs },
  segment: {
    flex: 1,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
});
