import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import { isApiError } from '@/api/errors';
import { translateMessageKey } from '@/i18n/messageKey';
import { EmptyState, ErrorState, Notice } from '@/components/ui/states';
import { SkeletonList } from '@/components/ui/Skeleton';

/**
 * The one place a page's five states are decided.
 *
 * docs/frontend/ux-flows.md gives every screen the same contract — data,
 * skeleton-loading, designed-empty, designed-error with retry, and cached
 * rendering with a banner when the network fails but the cache holds — and
 * this wrapper is what makes "no blank screens, by construction" true rather
 * than a thing each page has to remember.
 *
 * The cached-over-error branch is the interesting one: React Query keeps the
 * last successful data on a background refetch failure, so when `data` exists
 * *and* `error` is set, the honest thing is to render the data with a banner
 * saying it is not fresh — not to throw away something useful in favour of an
 * error page (ux-flows.md: "show cached + banner over hard error, whenever
 * cache is present").
 */
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
      <div data-testid="query-loading">
        {/*
          One polite announcement for the whole region. The skeletons
          themselves are aria-hidden, so this is the only thing spoken.
        */}
        <span className="sr-only" role="status" aria-live="polite">
          {loadingLabel ?? t('state.loading')}
        </span>
        {loading ?? <SkeletonList />}
      </div>
    );
  }

  if (error && data === undefined) {
    return (
      <ErrorState
        message={
          isApiError(error)
            ? translateMessageKey(t, error.messageKey)
            : t('errors:unexpected', { ns: 'errors' })
        }
        onRetry={() => void refetch()}
      />
    );
  }

  if (data === undefined) {
    // Not pending, no error, no data. Nothing legitimate produces this, but a
    // silent white screen is exactly what this component exists to prevent.
    return <ErrorState message={t('state.error')} onRetry={() => void refetch()} />;
  }

  const showsStaleBanner = Boolean(error);

  if (isEmpty?.(data)) {
    return (
      <>
        {showsStaleBanner && <StaleBanner />}
        {empty ?? <EmptyState title={t('state.empty')} />}
      </>
    );
  }

  return (
    <>
      {showsStaleBanner && <StaleBanner onRetry={() => void refetch()} isRetrying={isFetching} />}
      {children(data)}
    </>
  );
}

function StaleBanner({ onRetry, isRetrying }: { onRetry?: () => void; isRetrying?: boolean }) {
  const { t } = useTranslation('common');

  return (
    <Notice tone="warning" className="mb-4" data-testid="stale-banner">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{navigator.onLine === false ? t('state.offline') : t('state.showingCached')}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="font-semibold underline underline-offset-2 disabled:opacity-60"
          >
            {t('action.retry')}
          </button>
        )}
      </div>
    </Notice>
  );
}
