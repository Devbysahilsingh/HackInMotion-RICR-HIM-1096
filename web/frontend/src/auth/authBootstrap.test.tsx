import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { getAccessToken } from '@/api/session';
import { renderWithProviders } from '@/test/render';
import { HttpResponse, http, server, url, ok } from '@/test/server';
import * as fixtures from '@/test/fixtures';
import { RequireAuth, RequireGuest } from './guards';
import { PostAuthLanding } from './PostAuthLanding';

/**
 * Auth bootstrap (docs/testing/frontend-testing.md: "refresh-success →
 * dashboard; refresh-fail → login; 401-mid-session single-flight refresh").
 *
 * This is the behaviour a farmer notices most sharply: refreshing the browser
 * must not sign them out. The access token only ever lived in memory, so the
 * whole session hangs on the silent refresh below working — and on the guards
 * *waiting* for it instead of guessing while it is in flight.
 */
function TestApp() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<p>login screen</p>} />
      </Route>
      <Route element={<RequireAuth />}>
        {/*
          `RequireGuest` bounces an authenticated visitor to `/`, not straight
          to the dashboard, so the landing resolver has to be mounted here for
          this mini-app to mirror the real route tree. The default `/farms`
          handler returns one farm, so the resolver lands on the dashboard.
        */}
        <Route path="/" element={<PostAuthLanding />} />
        <Route path="/onboarding" element={<p>onboarding screen</p>} />
        <Route path="/dashboard" element={<p>dashboard screen</p>} />
      </Route>
    </Routes>
  );
}

describe('auth bootstrap', () => {
  it('holds the guard while the silent refresh is in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    server.use(
      http.post(url('/auth/refresh'), async () => {
        await gate;
        return ok({ accessToken: 'fresh', refreshToken: 'rotated' });
      }),
    );

    renderWithProviders(<TestApp />, { route: '/dashboard' });

    // Neither screen yet: the app genuinely does not know, and rendering
    // either one here would be a guess.
    expect(await screen.findByTestId('auth-bootstrapping')).toBeInTheDocument();
    expect(screen.queryByText('login screen')).toBeNull();
    expect(screen.queryByText('dashboard screen')).toBeNull();

    release();

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument();
  });

  it('restores the session on reload — a valid cookie keeps the farmer signed in', async () => {
    renderWithProviders(<TestApp />, { route: '/dashboard' });

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument();
    expect(getAccessToken()).toBe(fixtures.session.accessToken);
  });

  it('sends an anonymous visitor to login, preserving where they were going', async () => {
    server.use(
      http.post(url('/auth/refresh'), () =>
        HttpResponse.json(
          { success: false, error: { code: 'AUTHENTICATION_ERROR', messageKey: 'auth.invalidToken' } },
          { status: 401 },
        ),
      ),
    );

    renderWithProviders(<TestApp />, { route: '/dashboard' });

    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it('keeps a signed-in farmer off the login page', async () => {
    renderWithProviders(<TestApp />, { route: '/login' });

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument();
  });

  it('does not treat a refreshable-but-unidentifiable token as a session', async () => {
    server.use(
      http.get(url('/auth/me'), () =>
        HttpResponse.json(
          { success: false, error: { code: 'AUTHENTICATION_ERROR', messageKey: 'auth.invalidToken' } },
          { status: 401 },
        ),
      ),
    );

    renderWithProviders(<TestApp />, { route: '/dashboard' });

    expect(await screen.findByText('login screen')).toBeInTheDocument();
  });

  /**
   * The regression this file exists for.
   *
   * `main.tsx` renders inside `<StrictMode>`, which mounts, unmounts and
   * re-mounts every effect in development. An "already bootstrapped" ref
   * combined with a per-run `cancelled` flag leaves the app with exactly one
   * bootstrap in flight whose result is thrown away — the guard screen never
   * resolves and every route sits on "Checking your session…" forever.
   *
   * It was found by the Playwright run, not by this suite, because
   * `renderWithProviders` does not wrap in StrictMode. This test closes that
   * gap: it asserts both that the session still resolves under the double
   * mount, and that the double mount does not double-rotate the refresh token
   * (the API's reuse detector would kill the family if it did).
   */
  it('resolves under StrictMode double-mounting, with one refresh', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(url('/auth/refresh'), () => {
        refreshCalls += 1;
        return ok({ accessToken: 'fresh', refreshToken: 'rotated' });
      }),
    );

    renderWithProviders(
      <StrictMode>
        <TestApp />
      </StrictMode>,
      { route: '/dashboard' },
    );

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-bootstrapping')).toBeNull();
    expect(refreshCalls).toBe(1);
  });

  it('refreshes once for several concurrent 401s, then replays them', async () => {
    let refreshCalls = 0;
    let dashboardCalls = 0;

    server.use(
      http.post(url('/auth/refresh'), () => {
        refreshCalls += 1;
        return ok({ accessToken: `rotated-${refreshCalls}`, refreshToken: 'rotated' });
      }),
      http.get(url('/dashboard'), () => {
        dashboardCalls += 1;
        // The first three requests arrive with a token the server has already
        // rotated away; everything after the refresh succeeds.
        if (dashboardCalls <= 3) {
          return HttpResponse.json(
            {
              success: false,
              error: { code: 'AUTHENTICATION_ERROR', messageKey: 'auth.invalidToken' },
            },
            { status: 401 },
          );
        }
        return ok(fixtures.dashboard);
      }),
    );

    const { dashboardApi } = await import('@/api/endpoints');

    // The bootstrap refresh fires first; reset the counter so the assertion is
    // about the mid-session storm alone.
    renderWithProviders(<TestApp />, { route: '/dashboard' });
    await screen.findByText('dashboard screen');
    refreshCalls = 0;

    const results = await Promise.allSettled([
      dashboardApi.get(),
      dashboardApi.get(),
      dashboardApi.get(),
    ]);

    await waitFor(() => expect(refreshCalls).toBe(1));

    // Every one of them was replayed and succeeded — a rotated family would
    // otherwise have logged the farmer out for being on a slow connection.
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  });
});
