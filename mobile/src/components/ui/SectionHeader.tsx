/**
 * A titled block inside a screen.
 *
 * The title is marked as a header so a screen reader can jump between sections
 * — the mobile equivalent of the web's heading outline (accessibility.md:
 * "logical heading order").
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing } from '../../theme';
import { Text } from './Text';

export interface SectionHeaderProps {
  title: string;
  description?: string;
  /** A "view all" link, a filter, a count — anything trailing the title. */
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, description, action, style }: SectionHeaderProps) {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.row}>
        <Text variant="heading" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {action}
      </View>
      {description ? (
        <Text variant="small" color="ink500">
          {description}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: { flexShrink: 1 },
});
