/**
 * A single-line text control wearing the `Field` shell.
 *
 * The height floor is `TOUCH_TARGET` rather than padding, for the same reason
 * `Button` uses it: a field a farmer cannot reliably tap into is a field they
 * cannot fill in.
 */
import {
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { TOUCH_TARGET, colors, radius, spacing, typography } from '../../theme';
import { Field } from './Field';

export interface InputProps extends Omit<TextInputProps, 'accessibilityLabel' | 'style'> {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Grows the control for addresses and free text. */
  multiline?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export function Input({
  label,
  hint,
  error,
  required,
  multiline,
  containerStyle,
  ...rest
}: InputProps) {
  return (
    <Field label={label} hint={hint} error={error} required={required} style={containerStyle}>
      {({ accessibilityLabel, accessibilityHint, invalid }) => (
        <TextInput
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          multiline={multiline}
          placeholderTextColor={colors.ink500}
          style={[
            styles.input,
            multiline && styles.multiline,
            invalid && styles.invalid,
            rest.editable === false && styles.readOnly,
          ]}
          {...rest}
        />
      )}
    </Field>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink900,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
  },
  multiline: { minHeight: TOUCH_TARGET * 2, textAlignVertical: 'top' },
  invalid: { borderColor: colors.danger600, backgroundColor: colors.danger50 },
  readOnly: { backgroundColor: colors.canvas, color: colors.ink500 },
});
