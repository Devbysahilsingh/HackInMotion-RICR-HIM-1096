/**
 * Loading placeholders that mirror the layout they stand in for
 * (docs/frontend/ux-flows.md: "loading = skeleton mirroring layout"), so the
 * screen does not jump when the data lands.
 *
 * One animation drives every skeleton on screen. A list of eight cards is
 * roughly thirty of these, and thirty independent `Animated.loop`s on a budget
 * Android handset is measurable jank for an effect nobody is looking at — so
 * the pulse is a module-level value with a refcount, started by the first
 * skeleton to mount and stopped by the last to unmount. Native-driven, so it
 * never touches the JS thread while a fetch is in flight.
 *
 * Hidden from assistive technology: the surrounding boundary announces the
 * loading state once, and a screen reader reading out fourteen empty boxes
 * would be worse than silence.
 */
import { useEffect } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../../theme';

const DIM = 0.4;
const BRIGHT = 1;

const pulse = new Animated.Value(DIM);
let mounted = 0;
let loop: Animated.CompositeAnimation | null = null;

function usePulse(): Animated.Value {
  useEffect(() => {
    mounted += 1;

    if (mounted === 1) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: BRIGHT, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: DIM, duration: 700, useNativeDriver: true }),
        ]),
      );
      loop.start();
    }

    return () => {
      mounted -= 1;
      if (mounted === 0) {
        loop?.stop();
        loop = null;
        pulse.setValue(DIM);
      }
    };
  }, []);

  return pulse;
}

export interface SkeletonLineProps {
  /** A number is a fixed width in dp; a string is a percentage of the parent. */
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonLine({ width = '100%', height = 14, style }: SkeletonLineProps) {
  const opacity = usePulse();

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.line, { width, height, opacity }, style]}
    />
  );
}

export function SkeletonCard({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[styles.card, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.cardHead}>
        <SkeletonLine width={32} height={32} style={styles.avatar} />
        <SkeletonLine width="55%" height={16} />
      </View>
      <SkeletonLine height={12} style={styles.gap} />
      <SkeletonLine width="70%" height={12} style={styles.gapSmall} />
    </View>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { backgroundColor: colors.line, borderRadius: radius.sm },
  avatar: { borderRadius: radius.pill },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gap: { marginTop: spacing.lg },
  gapSmall: { marginTop: spacing.sm },
  list: { gap: spacing.md },
});
