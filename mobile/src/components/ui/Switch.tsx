/**
 * A labelled toggle — the consent switch, the read-aloud setting.
 *
 * The whole row is the control rather than the thumb alone: the native switch
 * is about 30dp tall, well under `TOUCH_TARGET`, and a farmer aiming at it on a
 * dusty screen would miss. The inner `Switch` is therefore taken out of the
 * accessibility tree and the row carries the `switch` role and the checked
 * state, so it is announced once and hit anywhere.
 */
import { Pressable, StyleSheet, Switch as RNSwitch, View } from 'react-native';

import { TOUCH_TARGET, colors, spacing } from '../../theme';
import { Text } from './Text';

export interface SwitchProps {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

export function Switch({
  label,
  hint,
  value,
  onValueChange,
  disabled = false,
  testID,
}: SwitchProps) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled }}
      testID={testID}
      style={[styles.row, disabled && styles.disabled]}
    >
      <View style={styles.text}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" color="ink500">
            {hint}
          </Text>
        ) : null}
      </View>
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        trackColor={{ false: colors.line, true: colors.brand300 }}
        thumbColor={value ? colors.brand600 : colors.surface}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.sm,
  },
  disabled: { opacity: 0.6 },
  text: { flex: 1, gap: 2 },
});
