/**
 * A neutral label. Unlike `PriorityChip` this carries no ranked meaning, so it
 * is safe for a status word, a count, or a tag.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../../theme';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'brand' | 'danger' | 'warn';

const TONE: Record<BadgeTone, { container: ViewStyle; text: string }> = {
  neutral: {
    container: { backgroundColor: colors.canvas, borderColor: colors.line },
    text: colors.ink700,
  },
  brand: {
    container: { backgroundColor: colors.brand50, borderColor: colors.brand200 },
    text: colors.brand700,
  },
  danger: {
    container: { backgroundColor: colors.danger50, borderColor: colors.danger600 },
    text: colors.danger600,
  },
  warn: {
    container: { backgroundColor: colors.priorityMediumSoft, borderColor: colors.priorityMedium },
    text: colors.priorityMedium,
  },
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Badge({ children, tone = 'neutral', icon, style, testID }: BadgeProps) {
  const palette = TONE[tone];

  return (
    <View style={[styles.badge, palette.container, style]} testID={testID}>
      {icon}
      <Text variant="caption" style={{ color: palette.text }}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
