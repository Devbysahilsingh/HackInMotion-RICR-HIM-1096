/**
 * The one button.
 *
 * Minimum height is `TOUCH_TARGET`, not padding, so a one-word label cannot
 * produce a control too small to hit with a work-worn thumb (accessibility.md).
 *
 * The loading state keeps the label where it was. When there is a leading icon
 * the spinner takes its place; when there is not, the spinner is absolutely
 * positioned in the left inset rather than inserted into the row — a button
 * that changes width or re-centres mid-press moves out from under the finger,
 * which on a touch surface is worse than on the web.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PRESSED_OPACITY, TOUCH_TARGET, colors, radius, spacing } from '../../theme';
import { Text, type TextColor, type TextVariant } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

interface VariantStyle {
  container: ViewStyle;
  label: TextColor;
  /** The spinner has no label of its own, so it borrows the label's colour. */
  tint: string;
}

const VARIANT: Record<ButtonVariant, VariantStyle> = {
  primary: {
    container: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
    label: 'inverse',
    tint: colors.surface,
  },
  secondary: {
    container: { backgroundColor: colors.surface, borderColor: colors.brand300 },
    label: 'brand600',
    tint: colors.brand600,
  },
  ghost: {
    container: { backgroundColor: 'transparent', borderColor: 'transparent' },
    label: 'ink700',
    tint: colors.ink700,
  },
  danger: {
    container: { backgroundColor: colors.danger600, borderColor: colors.danger600 },
    label: 'inverse',
    tint: colors.surface,
  },
};

const SIZE: Record<ButtonSize, { container: ViewStyle; text: TextVariant }> = {
  md: { container: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.lg }, text: 'bodyStrong' },
  lg: { container: { minHeight: 56, paddingHorizontal: spacing.xl }, text: 'subheading' },
};

export interface ButtonProps {
  children: ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the spinner and blocks presses. */
  loading?: boolean;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  fullWidth?: boolean;
  /** Only needed when the label alone does not identify the action. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leadingIcon,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const tone = VARIANT[variant];
  const scale = SIZE[size];
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        tone.container,
        scale.container,
        fullWidth && styles.fullWidth,
        pressed && !inert && { opacity: PRESSED_OPACITY },
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading && !leadingIcon ? (
        <View style={styles.spinnerInset} pointerEvents="none">
          <ActivityIndicator size="small" color={tone.tint} />
        </View>
      ) : null}

      {leadingIcon ? (
        <View style={styles.leading}>
          {loading ? <ActivityIndicator size="small" color={tone.tint} /> : leadingIcon}
        </View>
      ) : null}

      <Text variant={scale.text} color={tone.label} align="center">
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.6 },
  leading: { alignItems: 'center', justifyContent: 'center' },
  spinnerInset: {
    position: 'absolute',
    left: spacing.lg,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});
