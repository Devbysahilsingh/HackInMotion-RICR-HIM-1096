/**
 * The one place a screen's five states are decided.
 *
 * docs/frontend/ux-flows.md gives every screen the same contract — data,
 * skeleton-loading, designed-empty, designed-error with retry, and cached
 * rendering with a banner when the network fails but the cache holds — and this
 * wrapper is what makes "no blank screens, by construction" true rather than a
 * thing each screen has to remember. Deliberately the same component, the same
 * props and the same branch order as the web's
 * (web/frontend/src/components/QueryBoundary.tsx), so a screen ported between
 * surfaces behaves identically.
 *
 * The cached-over-error branch is the interesting one, and it matters more here
 * than on the web: React Query keeps the last successful data on a background
 * refetch failure, and on a rural connection that failure is the normal case.
 * When `data` exists *and* `error` is set, the honest thing is to render the
 * data with a banner saying it is not fresh — not to throw away something
 * useful in favour of an error page.
 *
 * One deliberate difference from the web: the banner does not distinguish
 * "offline" from "the update failed". `navigator.onLine` has no React Native
 * equivalent that is free, and claiming the farmer is offline when the server
 * merely returned a 500 would be a fabricated diagnosis (CLAUDE.md rule 7).
 * `state.showingCached` is true in both cases.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import { isApiError } from '@shared/client/errors';

import { translateMessageKey } from '../i18n/messageKey';
import { spacing } from '../theme';
import { SkeletonList } from './ui/Skeleton';
import { Button } from './ui/Button';
import { EmptyState, ErrorState, LoadingState, Notice } from './ui/states';
import { Text } from './ui/Text';

export interface QueryBoundaryProps<T> {
  query: UseQueryResult<T, unknown>;
  children: (data: T) => ReactNode;
  /** Decides "loaded, but there is nothing to show". */
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  /** A skeleton shaped like the real content. Defaults to a card list. */
  loading?: ReactNode;
  /** Extra label for the loading announcement, e.g. "Loading your fields". */
  loadingLabel?: string;
}

export function QueryBoundary<T>({
  query,
  children,
  isEmpty,
  empty,
  loading,
  loadingLabel,
}: QueryBoundaryProps<T>) {
  const { t } = useTranslation('common');

  const { data, error, isPending, isFetching, refetch } = query;

  if (isPending) {
    return (
      <LoadingState
        skeleton={loading ?? <SkeletonList />}
        label={loadingLabel}
        style={styles.block}
      />
    );
  }

  if (error && data === undefined) {
    return (
      <ErrorState
        message={
          isApiError(error) ? translateMessageKey(t, error.messageKey) : t('errors:unexpected')
        }
        onRetry={() => void refetch()}
      />
    );
  }

  if (data === undefined) {
    // Not pending, no error, no data. Nothing legitimate produces this, but a
    // silent blank screen is exactly what this component exists to prevent.
    return <ErrorState message={t('state.error')} onRetry={() => void refetch()} />;
  }

  const showsStaleBanner = Boolean(error);

  if (isEmpty?.(data)) {
    return (
      <View style={styles.block}>
        {showsStaleBanner ? <StaleBanner /> : null}
        {empty ?? <EmptyState title={t('state.empty')} />}
      </View>
    );
  }

  if (!showsStaleBanner) return <>{children(data)}</>;

  return (
    <View style={styles.block}>
      <StaleBanner onRetry={() => void refetch()} isRetrying={isFetching} />
      {children(data)}
    </View>
  );
}

function StaleBanner({ onRetry, isRetrying }: { onRetry?: () => void; isRetrying?: boolean }) {
  const { t } = useTranslation('common');

  return (
    <Notice tone="warning" testID="stale-banner">
      <View style={styles.banner}>
        <Text variant="small" color="ink700">
          {t('state.showingCached')}
        </Text>
        {onRetry ? (
          <Button variant="ghost" onPress={onRetry} loading={isRetrying}>
            {t('action.retry')}
          </Button>
        ) : null}
      </View>
    </Notice>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  banner: { gap: spacing.sm, alignItems: 'flex-start' },
});
