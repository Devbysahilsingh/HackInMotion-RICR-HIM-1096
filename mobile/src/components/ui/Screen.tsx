/**
 * The page scaffold.
 *
 * Every screen sits on this so the canvas colour, the safe-area inset and the
 * pull-to-refresh gesture are decided once. Pull-to-refresh matters more here
 * than the web's retry button does: on a rural connection the common failure is
 * a stale cache rather than a hard error, and the gesture is the thing a farmer
 * will reach for without being told.
 *
 * `keyboardAvoiding` is opt-in rather than always-on. It costs a layout pass on
 * every scroll for screens that have no text input, and Android's own
 * `adjustResize` already handles the simple cases — so it is switched on by the
 * form screens that actually need it.
 */
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '../../theme';

export interface ScreenProps {
  children: ReactNode;
  /** Off for screens that own a `FlatList`, which must scroll itself. */
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  keyboardAvoiding?: boolean;
  /**
   * Bottom is excluded by default: a tab bar or a sticky action row already
   * owns that inset, and padding it twice leaves a dead band above the gesture
   * pill. Screens with neither pass it explicitly.
   */
  edges?: readonly Edge[];
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  keyboardAvoiding = false,
  edges = ['top', 'left', 'right'],
  contentContainerStyle,
  style,
  testID,
}: ScreenProps) {
  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.brand600]}
            tintColor={colors.brand600}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.content, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]} testID={testID}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
});
