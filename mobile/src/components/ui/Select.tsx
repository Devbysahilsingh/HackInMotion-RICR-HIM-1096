/**
 * A single-choice picker, opened as a bottom sheet.
 *
 * Not a wheel picker and not a dropdown anchored to the control. The lists this
 * app has to offer are state, district, soil type and crop — dozens of options
 * each, read in Devanagari, chosen by someone holding the phone in one hand.
 * A sheet anchored to the bottom of the screen puts every row inside thumb
 * reach and gives each one a full `TOUCH_TARGET` of height, which a wheel does
 * not; a dropdown near the top of the screen would put half the options out of
 * reach entirely.
 *
 * `placeholder` is a prop rather than a default string because the wording is
 * the caller's — "Choose a district" and "Choose a crop" are not the same
 * sentence, and inventing one generic key here would put untranslated,
 * unverified copy on every form.
 */
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { PRESSED_OPACITY, TOUCH_TARGET, colors, radius, spacing } from '../../theme';
import { Field } from './Field';
import { IconCheck, IconChevronDown, IconClose } from './icons';
import { Text } from './Text';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectProps<T extends string> {
  label: string;
  options: readonly SelectOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** Shown on the closed control when nothing is chosen yet. */
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  hint,
  error,
  required,
  disabled = false,
  containerStyle,
  testID,
}: SelectProps<T>) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);

  return (
    <Field label={label} hint={hint} error={error} required={required} style={containerStyle}>
      {({ accessibilityLabel, accessibilityHint, invalid }) => (
        <>
          <Pressable
            onPress={() => setOpen(true)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={accessibilityHint}
            accessibilityValue={{ text: selected?.label }}
            accessibilityState={{ disabled, expanded: open }}
            testID={testID}
            style={({ pressed }) => [
              styles.trigger,
              invalid && styles.invalid,
              disabled && styles.disabled,
              pressed && !disabled && { opacity: PRESSED_OPACITY },
            ]}
          >
            <Text
              variant="body"
              color={selected ? 'ink900' : 'ink500'}
              numberOfLines={1}
              style={styles.triggerText}
            >
              {selected?.label ?? placeholder ?? ''}
            </Text>
            <IconChevronDown size={20} color={colors.ink500} />
          </Pressable>

          <Modal
            visible={open}
            transparent
            animationType="slide"
            onRequestClose={() => setOpen(false)}
          >
            {/*
              The backdrop dismisses but is not announced: a screen-reader user
              has the labelled close control and the system back gesture, and a
              full-screen "close" target would swallow the list behind it.
            */}
            <Pressable
              style={styles.backdrop}
              onPress={() => setOpen(false)}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text variant="subheading" accessibilityRole="header" style={styles.sheetTitle}>
                  {label}
                </Text>
                <Pressable
                  onPress={() => setOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('action.close')}
                  style={({ pressed }) => [styles.close, pressed && { opacity: PRESSED_OPACITY }]}
                >
                  <IconClose size={22} color={colors.ink700} />
                </Pressable>
              </View>

              <ScrollView>
                {options.map((option) => {
                  const isSelected = option.value === value;

                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={option.label}
                      accessibilityHint={option.description}
                      style={({ pressed }) => [
                        styles.option,
                        isSelected && styles.optionSelected,
                        pressed && { opacity: PRESSED_OPACITY },
                      ]}
                    >
                      <View style={styles.optionText}>
                        <Text variant={isSelected ? 'bodyStrong' : 'body'}>{option.label}</Text>
                        {option.description ? (
                          <Text variant="caption" color="ink500">
                            {option.description}
                          </Text>
                        ) : null}
                      </View>
                      {isSelected ? <IconCheck size={20} color={colors.brand600} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Modal>
        </>
      )}
    </Field>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  triggerText: { flex: 1 },
  invalid: { borderColor: colors.danger600, backgroundColor: colors.danger50 },
  disabled: { backgroundColor: colors.canvas },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.md,
  },
  sheetTitle: { flexShrink: 1 },
  close: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: TOUCH_TARGET + spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  optionSelected: { backgroundColor: colors.brand50 },
  optionText: { flex: 1, gap: 2 },
});
