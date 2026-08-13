/**
 * Feed priority, rendered as icon + colour + **text**.
 *
 * Never colour-alone (accessibility.md). The three signals are deliberately
 * redundant: the shape distinguishes the four levels in greyscale, the label
 * distinguishes them for a screen reader, and the colour is what makes a
 * CRITICAL row findable at a glance in sunlight. Removing any one of the three
 * still leaves the chip readable — that redundancy is the point.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Priority } from '@shared/types/api';

import { colors, radius, spacing } from '../../theme';
import { IconAlertCircle, IconAlertTriangle, IconClock, IconInfo } from './icons';
import { Text } from './Text';

const STYLE: Record<Priority, { fill: string; tint: string; Icon: typeof IconInfo }> = {
  CRITICAL: {
    fill: colors.priorityCriticalSoft,
    tint: colors.priorityCritical,
    Icon: IconAlertTriangle,
  },
  HIGH: { fill: colors.priorityHighSoft, tint: colors.priorityHigh, Icon: IconAlertCircle },
  MEDIUM: { fill: colors.priorityMediumSoft, tint: colors.priorityMedium, Icon: IconClock },
  INFO: { fill: colors.priorityInfoSoft, tint: colors.priorityInfo, Icon: IconInfo },
};

export interface PriorityChipProps {
  priority: Priority;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PriorityChip({ priority, style, testID }: PriorityChipProps) {
  const { t } = useTranslation('common');
  const chip = STYLE[priority] ?? STYLE.INFO;
  const { Icon } = chip;

  return (
    <View
      style={[styles.chip, { backgroundColor: chip.fill, borderColor: chip.tint }, style]}
      testID={testID}
    >
      <Icon size={14} color={chip.tint} />
      <Text variant="caption" style={{ color: chip.tint }}>
        {t(`priority.${priority}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
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
