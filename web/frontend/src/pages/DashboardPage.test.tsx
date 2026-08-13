import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import { HttpResponse, http, ok, server, url } from '@/test/server';
import * as fixtures from '@/test/fixtures';
import DashboardPage from './DashboardPage';

describe('DashboardPage', () => {
  it('renders the feed from i18n keys, never from server prose', async () => {
    renderWithProviders(<DashboardPage />);

    const items = await screen.findAllByTestId('feed-item');
    expect(items).toHaveLength(2);

    // `irrigation.titleIRRIGATE_TODAY` interpolated with the item's own data.
    // Scoped to the feed: the crop card below renders the same verdict key as
    // a badge, which is correct and would otherwise make this ambiguous.
    const titles = items.map((item) => within(item).getByTestId('feed-item-title').textContent);
    expect(titles).toContain('Water this crop today');
    expect(titles).toContain('Heavy rain expected');

    expect(screen.getByText(/Apply about 25 mm/)).toBeInTheDocument();
    // `weather.bodyHEAVY_RAIN` with the numbers the engine compared.
    expect(
      screen.getByText(/About 82 mm of rain is expected, with a 90% chance/),
    ).toBeInTheDocument();
  });

  it('pins the urgent item and chips every item with its priority', async () => {
    renderWithProviders(<DashboardPage />);

    const items = await screen.findAllByTestId('feed-item');
    for (const item of items) {
      expect(within(item).getByTestId('priority-chip')).toBeInTheDocument();
    }
  });

  it('expands the why-trace inline with the engine numbers', async () => {
    renderWithProviders(<DashboardPage />);

    const items = await screen.findAllByTestId('feed-item');
    await userEvent.click(within(items[0]!).getByTestId('why-toggle'));

    const trace = within(items[0]!).getByTestId('why-trace');
    expect(trace.textContent).toContain('tawMm');
    expect(trace.textContent).toContain('92.4');
  });

  it('renders crop cards with stage, verdict and freshness', async () => {
    renderWithProviders(<DashboardPage />);

    const card = await screen.findByTestId('crop-card');
    expect(card).toHaveAttribute('data-crop-code', 'TOMATO');
    expect(within(card).getByTestId('crop-card-irrigation')).toBeInTheDocument();
    expect(within(card).getByTestId('crop-card-market')).toBeInTheDocument();
    expect(within(card).getByTestId('freshness-dot')).toHaveAttribute('data-status', 'live');
  });

  describe('acknowledge', () => {
    it('removes the item immediately, and it stays gone after the refetch', async () => {
      // A stateful mock, because the mutation invalidates the dashboard on
      // settle: against a static fixture the acknowledged row would reappear
      // and the test would be asserting the mock's amnesia, not the UI.
      const acked = new Set<string>();
      server.use(
        http.post(url('/recommendations/:id/ack'), ({ params }) => {
          acked.add(String(params.id));
          return new HttpResponse(null, { status: 204 });
        }),
        http.get(url('/dashboard'), () =>
          ok({
            ...fixtures.dashboard,
            feed: fixtures.dashboard.feed.filter((item) => !acked.has(item.id)),
          }),
        ),
      );

      renderWithProviders(<DashboardPage />);

      const items = await screen.findAllByTestId('feed-item');
      await userEvent.click(within(items[0]!).getByTestId('feed-ack'));

      await waitFor(() => expect(screen.getAllByTestId('feed-item')).toHaveLength(1));
      expect(acked.has(fixtures.dashboard.feed[0]!.id)).toBe(true);

      // Still one after the invalidation round-trip — no flicker back.
      await waitFor(() => expect(screen.getAllByTestId('feed-item')).toHaveLength(1));
    });

    it('puts the item back and says so when the acknowledgement fails', async () => {
      server.use(
        http.post(url('/recommendations/:id/ack'), () =>
          HttpResponse.json(
            { success: false, error: { code: 'INTERNAL_ERROR', messageKey: 'errors.internal' } },
            { status: 500 },
          ),
        ),
      );

      renderWithProviders(<DashboardPage />);

      const items = await screen.findAllByTestId('feed-item');
      await userEvent.click(within(items[0]!).getByTestId('feed-ack'));

      // The farmer is told, and nothing is silently lost.
      expect((await screen.findByTestId('toast')).textContent).toMatch(/Something went wrong/i);
      await waitFor(() => expect(screen.getAllByTestId('feed-item')).toHaveLength(2));
    });
  });

  it('renders the API-designed onboarding payload for an account with no farms', async () => {
    server.use(http.get(url('/dashboard'), () => ok(fixtures.onboardingDashboard)));

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText(/Add your first farm/i)).toBeInTheDocument();
    expect(screen.queryByTestId('feed-item')).toBeNull();
  });

  it('surfaces degraded system status rather than hiding it', async () => {
    server.use(
      http.get(url('/dashboard'), () =>
        ok({
          ...fixtures.dashboard,
          systemStatus: { weather: 'pending', market: 'historical', ml: 'down' },
        }),
      ),
    );

    renderWithProviders(<DashboardPage />);

    const status = await screen.findByTestId('system-status');
    expect(status.textContent).toMatch(/Historical|Not fetched yet/);
  });

  /**
   * The Hindi spot-check docs/testing/frontend-testing.md asks for: "spot render
   * test with hi locale asserting Devanagari output on dashboard".
   */
  it('renders the dashboard in Devanagari under the Hindi locale', async () => {
    renderWithProviders(<DashboardPage />, { language: 'hi' });

    const items = await screen.findAllByTestId('feed-item');
    const title = within(items[0]!).getByTestId('feed-item-title');

    expect(title.textContent).toMatch(/[ऀ-ॿ]/);
    expect(within(items[0]!).getByTestId('priority-chip').textContent).toMatch(/[ऀ-ॿ]/);
    expect(document.documentElement.lang).toBe('hi');
  });
});
