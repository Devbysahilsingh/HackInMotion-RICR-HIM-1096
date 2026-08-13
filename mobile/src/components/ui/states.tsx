/**
 * The three states every data-bearing screen owes the farmer, and the inline
 * notice that carries the copy the product is *required* to show.
 *
 * ux-flows.md gives every screen the same contract — skeleton-loading,
 * designed-empty with a way forward, designed-error with a retry — and putting
 * them here is what makes "no blank screens, by construction" true rather than
 * a thing each screen has to remember.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@shared/client/errors';

import { translateMessageKey } from '../../i18n/messageKey';
import { colors, radius, spacing } from '../../theme';
import { Button } from './Button';
import { IconAlertTriangle, IconInfo, IconLeaf } from './icons';
import { Text } from './Text';

export interface LoadingStateProps {
  /** A skeleton shaped like the real content. Falls back to a spinner. */
  skeleton?: ReactNode;
  /** Overrides "Loading…" with something specific, e.g. "Checking the leaf…". */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function LoadingState({ skeleton, label, style }: LoadingStateProps) {
  const { t } = useTranslation('common');
  const text = label ?? t('state.loading');

  if (skeleton) {
    return (
      <View style={style}>
        {/*
          One polite announcement for the whole region — the skeletons
          themselves are removed from the accessibility tree, so this is the
          only thing spoken.
        */}
        <Text
          variant="caption"
          color="ink500"
          accessibilityLiveRegion="polite"
          style={styles.loadingLabel}
        >
          {text}
        </Text>
        {skeleton}
      </View>
    );
  }

  return (
    <View style={[styles.centered, style]} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.brand600} />
      <Text variant="small" color="ink500" align="center">
        {text}
      </Text>
    </View>
  );
}

/**
 * The designed empty state — guidance plus a way forward, never a blank panel
 * (ux-flows.md: "empty = designed guidance + CTA").
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  style,
  testID,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.empty, style]} testID={testID}>
      {icon ?? <IconLeaf size={32} color={colors.brand500} />}
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="small" color="ink500" align="center">
          {body}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

export interface ErrorStateProps {
  /**
   * Anything a query rejected with. An `ApiError` is rendered through its
   * `messageKey`; anything else falls back to the generic string, because a
   * farmer must never be shown a raw message or a bare key.
   */
  error?: unknown;
  /** Overrides the derived message where the caller knows better. */
  message?: string;
  title?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ErrorState({ error, message, title, onRetry, style, testID }: ErrorStateProps) {
  const { t } = useTranslation('common');

  const text =
    message ??
    (isApiError(error) ? translateMessageKey(t, error.messageKey) : t('errors:unexpected'));

  return (
    <View
      style={[styles.error, style]}
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      testID={testID}
    >
      <View style={styles.errorHead}>
        <IconAlertTriangle size={18} color={colors.danger600} />
        <Text variant="bodyStrong" color="danger600" style={styles.flexText}>
          {title ?? t('state.error')}
        </Text>
      </View>
      <Text variant="small" color="ink700">
        {text}
      </Text>
      {onRetry ? (
        <Button variant="secondary" onPress={onRetry}>
          {t('action.retry')}
        </Button>
      ) : null}
    </View>
  );
}

export type NoticeTone = 'info' | 'warning' | 'danger';

const NOTICE_TONE: Record<NoticeTone, { fill: string; border: string; tint: string }> = {
  info: { fill: colors.brand50, border: colors.brand200, tint: colors.brand800 },
  warning: {
    fill: colors.priorityMediumSoft,
    border: colors.priorityMedium,
    tint: colors.priorityMedium,
  },
  danger: { fill: colors.danger50, border: colors.danger600, tint: colors.danger600 },
};

/**
 * An inline notice. Carries the coverage notices, the stale-cache banner and
 * the mandatory fertilizer disclaimer — all content the product is required to
 * show rather than optional decoration, so it is never dismissible.
 */
export function Notice({
  tone = 'info',
  icon,
  children,
  style,
  testID,
}: {
  tone?: NoticeTone;
  icon?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const palette = NOTICE_TONE[tone];

  return (
    <View
      style={[styles.notice, { backgroundColor: palette.fill, borderColor: palette.border }, style]}
      testID={testID}
    >
      {icon ??
        (tone === 'info' ? (
          <IconInfo size={18} color={palette.tint} />
        ) : (
          <IconAlertTriangle size={18} color={palette.tint} />
        ))}
      <View style={styles.noticeBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  loadingLabel: { marginBottom: spacing.sm },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  error: {
    gap: spacing.md,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.danger600,
    borderRadius: radius.lg,
    backgroundColor: colors.danger50,
    padding: spacing.lg,
  },
  errorHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flexText: { flexShrink: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  noticeBody: { flex: 1 },
});
