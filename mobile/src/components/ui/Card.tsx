/**
 * The surface every piece of content sits on.
 *
 * `onPress` is what decides whether this is a button: a card that merely holds
 * text must not announce itself as tappable, and a card that navigates must —
 * so the role and the press feedback are attached together rather than left to
 * each caller to remember.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PRESSED_OPACITY, colors, radius, shadow, spacing } from '../../theme';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  /** Off for cards that hold their own edge-to-edge content, e.g. an image. */
  padded?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({
  children,
  onPress,
  padded = true,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: CardProps) {
  const base = [styles.card, padded && styles.padded, style];

  if (!onPress) {
    return (
      <View style={base} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [...base, pressed && { opacity: PRESSED_OPACITY }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  padded: { padding: spacing.lg },
});
