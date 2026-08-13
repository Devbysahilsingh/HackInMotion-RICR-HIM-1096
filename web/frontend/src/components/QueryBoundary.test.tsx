import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '@/api/endpoints';
import { createTestQueryClient, renderWithProviders } from '@/test/render';
import { HttpResponse, http, server, url, ok } from '@/test/server';
import * as fixtures from '@/test/fixtures';
import { QueryBoundary } from './QueryBoundary';
import { EmptyState } from './ui/states';

/**
 * The QueryBoundary contract (docs/testing/frontend-testing.md:
 * "loading/empty/error/cached-banner rendering").
 *
 * This wrapper is what makes "no blank screens, by construction" true, so its
 * five states are tested directly rather than through a page that happens to
 * use it.
 */
function Subject({ enabledEmpty = false }: { enabledEmpty?: boolean }) {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: dashboardApi.get });

  return (
    <QueryBoundary
      query={query}
      isEmpty={enabledEmpty ? (data) => data.feed.length === 0 : undefined}
      empty={<EmptyState title="nothing here" />}
    >
      {(data) => <p>feed items: {data.feed.length}</p>}
    </QueryBoundary>
  );
}

describe('QueryBoundary', () => {
  it('shows a skeleton and one polite announcement while loading', async () => {
    renderWithProviders(<Subject />);

    const loading = screen.getByTestId('query-loading');
    const status = loading.querySelector('[role="status"]');
    expect(status).toHaveAttribute('aria-live', 'polite');

    // The skeletons themselves stay silent — one announcement, not fourteen.
    expect(loading.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);

    await screen.findByText(/feed items/);
  });

  it('renders the data state', async () => {
    renderWithProviders(<Subject />);
    expect(await screen.findByText('feed items: 2')).toBeInTheDocument();
  });

  it('renders the designed empty state, not a blank panel', async () => {
    server.use(
      http.get(url('/dashboard'), () => ok({ ...fixtures.dashboard, feed: [], cropCards: [] })),
    );

    renderWithProviders(<Subject enabledEmpty />);

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('nothing here')).toBeInTheDocument();
  });

  it('renders a localized error with a retry, never a status code', async () => {
    let attempts = 0;
    server.use(
      http.get(url('/dashboard'), () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { success: false, error: { code: 'INTERNAL_ERROR', messageKey: 'errors.internal' } },
            { status: 500 },
          );
        }
        return ok(fixtures.dashboard);
      }),
    );

    renderWithProviders(<Subject />);

    const error = await screen.findByTestId('error-state');
    expect(error).toHaveAttribute('role', 'alert');
    // The message is the translated string, not the code or the status.
    expect(error.textContent).not.toMatch(/INTERNAL_ERROR|500/);
    expect(error.textContent).toMatch(/Something went wrong/i);

    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('feed items: 2')).toBeInTheDocument();
  });

  /**
   * The branch worth the most: React Query keeps the last good data when a
   * background refetch fails, and throwing that away in favour of an error
   * page would be strictly worse for a farmer on a patchy connection.
   */
  it('keeps showing cached data behind a banner when a refetch fails', async () => {
    const queryClient = createTestQueryClient();
    renderWithProviders(<Subject />, { queryClient });

    expect(await screen.findByText('feed items: 2')).toBeInTheDocument();

    server.use(
      http.get(url('/dashboard'), () =>
        HttpResponse.json(
          { success: false, error: { code: 'INTERNAL_ERROR', messageKey: 'errors.internal' } },
          { status: 503 },
        ),
      ),
    );

    await queryClient.refetchQueries({ queryKey: ['dashboard'] });

    await waitFor(() => expect(screen.getByTestId('stale-banner')).toBeInTheDocument());
    // The data is still on screen — the banner is additive, not a replacement.
    expect(screen.getByText('feed items: 2')).toBeInTheDocument();
    expect(screen.queryByTestId('error-state')).toBeNull();
  });
});
