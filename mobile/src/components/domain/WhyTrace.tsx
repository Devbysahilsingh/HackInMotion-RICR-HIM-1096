/**
 * The explainability UI, and the read-aloud control that sits beside it.
 *
 * ## WhyTrace
 *
 * Engines are required to emit a trace with every verdict (R12: "no
 * recommendation without trace data"), and this is where that promise is
 * redeemed for a farmer: every number the engine used, grouped by the step
 * that used it. Deliberately the same behaviour as the web's
 * (web/frontend/src/components/domain/WhyTrace.tsx) so a trace checked on one
 * surface reads identically on the other.
 *
 * The trace is **not** typed per engine. Each engine names its own fields, and
 * a fixed schema here would have to be edited every time one of them learned a
 * new number — and would silently drop anything it did not know about. So this
 * walks whatever it is given.
 *
 * Field names stay in their engine spelling (`tawMm`, `rawMm`, `changePct7d`).
 * Translating a variable name would make the trace impossible to check against
 * the engine that produced it, and the plain-language version of the same
 * verdict is already on screen above it.
 *
 * ## SpeakButton
 *
 * Voice OUT, on the three surfaces docs/voice names as highest value: the
 * irrigation verdict, a weather risk, and a recommendation. It lives in this
 * file rather than in `components/ui/` because that directory is complete and
 * owned elsewhere for this phase — and because it belongs to the same idea as
 * the trace: both are how a farmer gets a verdict *explained* rather than just
 * displayed.
 *
 * Two conditions hide it entirely rather than disabling it: the farmer turned
 * read-aloud off in settings, or the handset has no voice for the active
 * language (docs/voice R2 — never offer a control that silently does nothing).
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatNumber } from '@shared/client/format';
import type { Language, TraceStep } from '@shared/types/api';

import { useLanguage } from '../../store/LanguageContext';
import { useAuth } from '../../store/AuthContext';
import { isLanguageAvailable, speak, stopSpeaking } from '../../services/voice';
import { PRESSED_OPACITY, TOUCH_TARGET, colors, radius, spacing } from '../../theme';
import { IconChevronDown, IconSpeaker, IconX } from '../ui/icons';
import { Text } from '../ui/Text';

/**
 * What a caller may hand `WhyTrace`.
 *
 * Wider than `TraceStep[]`, because the feed's own `data.trace` is
 * **polymorphic** and the API is entitled to be: an irrigation item carries the
 * engine's array of steps, while a weather-risk item carries `risk.data` — a
 * flat object of the numbers compared against a threshold. Both satisfy R12;
 * only one of them is an array.
 */
export type TraceInput = TraceStep[] | Record<string, unknown> | null | undefined;

export interface WhyTraceProps {
  trace: TraceInput;
  defaultOpen?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function WhyTrace({ trace, defaultOpen = false, style, testID }: WhyTraceProps) {
  const { t } = useTranslation('common');
  const { language } = useLanguage();
  const [open, setOpen] = useState(defaultOpen);

  const steps = normalizeTrace(trace);

  return (
    <View style={[styles.traceShell, style]} testID={testID}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="why-toggle"
        style={({ pressed }) => [styles.traceToggle, pressed && { opacity: PRESSED_OPACITY }]}
      >
        <Text variant="small" color="ink700" style={styles.flexText}>
          {open ? t('action.hideWhy') : t('action.showWhy')}
        </Text>
        <View style={open ? styles.chevronOpen : undefined}>
          <IconChevronDown size={20} color={colors.ink500} />
        </View>
      </Pressable>

      {open ? (
        <View style={styles.tracePanel} testID="why-trace">
          <Text variant="caption" color="ink500">
            {t('why.heading')}
          </Text>

          {steps.length === 0 ? (
            <Text variant="small" color="ink500">
              {t('why.noTrace')}
            </Text>
          ) : (
            steps.map((step, index) => (
              <TraceStepRow key={`${String(step.step)}-${index}`} step={step} language={language} />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Coerces whatever the API sent into a list of steps.
 *
 * An array passes through. A bare object becomes one step named `VALUES` — it
 * has no step name of its own, and inventing a specific-sounding one would
 * imply an engine phase that never existed. Anything else yields nothing, and
 * the component says so honestly.
 */
function normalizeTrace(trace: TraceInput): TraceStep[] {
  if (Array.isArray(trace)) return trace;
  if (trace && typeof trace === 'object' && Object.keys(trace).length > 0) {
    return [{ step: 'VALUES', ...trace }];
  }
  return [];
}

function TraceStepRow({ step, language }: { step: TraceStep; language: Language }) {
  const { step: name, ...fields } = step;
  const entries = Object.entries(fields);

  return (
    <View style={styles.traceStep}>
      <Text variant="caption" color="brand600">
        {String(name)}
      </Text>

      {entries.map(([key, value]) => (
        <View key={key} style={styles.traceRow}>
          <Text variant="caption" color="ink500" numberOfLines={1} style={styles.flexText}>
            {key}
          </Text>
          <Text variant="caption" color="ink900">
            {renderValue(value, language)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function renderValue(value: unknown, language: Language): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return formatNumber(value, language, { maximumFractionDigits: 3 });
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return '{…}';
  return String(value);
}

export interface SpeakButtonProps {
  /** Already-translated prose. Never a key, and never a raw enum. */
  text: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SpeakButton({ text, style, testID }: SpeakButtonProps) {
  const { t } = useTranslation('common');
  const { language } = useLanguage();
  const { user } = useAuth();

  // Null while we are still asking the engine. Rendering the control before
  // the answer arrives would flash a button that may not work.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const enabled = user?.voiceEnabled ?? true;

  useEffect(() => {
    // No point asking the engine for a control the farmer has switched off.
    if (!enabled) return;

    let cancelled = false;

    void isLanguageAvailable(language).then((canSpeak) => {
      if (!cancelled) setAvailable(canSpeak);
    });

    return () => {
      cancelled = true;
    };
  }, [language, enabled]);

  // Leaving a card mid-sentence should stop the sentence.
  useEffect(() => () => stopSpeaking(), []);

  if (!enabled || available !== true || !text.trim()) return null;

  const label = speaking ? t('action.stopSpeaking') : t('action.speak');

  return (
    <Pressable
      onPress={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
          return;
        }
        speak(text, {
          language,
          onStart: () => setSpeaking(true),
          onDone: () => setSpeaking(false),
          onError: () => setSpeaking(false),
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID ?? 'speak-button'}
      style={({ pressed }) => [styles.speak, pressed && { opacity: PRESSED_OPACITY }, style]}
    >
      {speaking ? (
        <IconX size={20} color={colors.brand600} />
      ) : (
        <IconSpeaker size={20} color={colors.brand600} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  traceShell: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  traceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
  },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  tracePanel: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    padding: spacing.md,
  },
  traceStep: {
    gap: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  traceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  flexText: { flexShrink: 1 },
  speak: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
});
