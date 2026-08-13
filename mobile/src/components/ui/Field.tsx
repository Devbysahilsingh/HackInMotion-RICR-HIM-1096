/**
 * Label, control, hint and error as one unit.
 *
 * The wiring is the point. React Native has no `htmlFor` and no
 * `aria-describedby`, so the association the web gets from the DOM has to be
 * carried by hand: the shell composes the label, the hint, the required marker
 * and the error into the `accessibilityLabel`/`accessibilityHint` pair that the
 * control then adopts. A screen-reader user therefore hears *why* a field was
 * rejected rather than only that it was — and because every control in the app
 * goes through here, that is not something each form has to remember
 * (accessibility.md: "labeled inputs").
 *
 * `required` is spoken through `common:validation.required` rather than the
 * asterisk. The asterisk is a sighted convention; read aloud it is "star".
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { spacing } from '../../theme';
import { Text } from './Text';

export interface FieldState {
  accessibilityLabel: string;
  accessibilityHint: string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (state: FieldState) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Field({ label, hint, error, required = false, children, style }: FieldProps) {
  const { t } = useTranslation('common');

  const accessibilityHint =
    [required ? t('validation.required') : null, hint, error].filter(Boolean).join(' ') ||
    undefined;

  return (
    <View style={[styles.field, style]}>
      <View style={styles.labelRow}>
        <Text variant="small" color="ink700" style={styles.labelText}>
          {label}
        </Text>
        {required ? (
          <Text
            variant="small"
            color="danger600"
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            *
          </Text>
        ) : null}
      </View>

      {children({ accessibilityLabel: label, accessibilityHint, invalid: Boolean(error) })}

      {hint ? (
        <Text variant="caption" color="ink500">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" color="danger600" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  labelText: { flexShrink: 1 },
});
