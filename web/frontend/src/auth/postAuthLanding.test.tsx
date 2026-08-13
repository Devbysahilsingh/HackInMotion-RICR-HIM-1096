import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { renderWithProviders } from '@/test/render';
import { http, ok, server, url } from '@/test/server';
import * as fixtures from '@/test/fixtures';
import { RequireAuth, RequireGuest } from './guards';
import { PostAuthLanding } from './PostAuthLanding';

/**
 * Where a farmer lands after authenticating.
 *
 * ## The regression this file exists for
 *
 * `RequireGuest` sent every authenticated visitor to `/dashboard`, while
 * `RegisterPage` separately called `navigate('/onboarding')`. Both fired on the
 * same state change; the guard won, and a brand-new account was dropped on the
 * dashboard's empty state instead of onboarding. The two requirements are:
 *
 *   new account (no farms)        -> /onboarding
 *   returning account (has farms) -> /dashboard
 *
 * Both are asserted below, plus the guard redirect that used to hardcode the
 * answer, so neither direction can silently regress.
 */
function TestApp() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<p>login screen</p>} />
        <Route path="/register" element={<p>register screen</p>} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<PostAuthLanding />} />
        <Route path="/onboarding" element={<p>onboarding screen</p>} />
        <Route path="/dashboard" element={<p>dashboard screen</p>} />
        <Route path="/farms" element={<p>farms screen</p>} />
      </Route>
    </Routes>
  );
}

/** The account has no field yet — the brand-new-registration case. */
const noFarms = () => server.use(http.get(url('/farms'), () => ok({ farms: [] })));
/** The account already has a field — the returning-farmer case. */
const withFarms = () => server.use(http.get(url('/farms'), () => ok({ farms: [fixtures.farm] })));

describe('post-authentication landing', () => {
  it('sends a brand-new account to onboarding, not the dashboard', async () => {
    noFarms();

    renderWithProviders(<TestApp />, { route: '/' });

    expect(await screen.findByText('onboarding screen')).toBeInTheDocument();
    expect(screen.queryByText('dashboard screen')).toBeNull();
  });

  it('sends a returning account with a field to the dashboard', async () => {
    withFarms();

    renderWithProviders(<TestApp />, { route: '/' });

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument();
    expect(screen.queryByText('onboarding screen')).toBeNull();
  });

  it('bounces an already-signed-in farmer off /register through the resolver', async () => {
    // This is the exact path that used to break: the guard fired on the
    // register screen and hardcoded `/dashboard`.
    noFarms();

    renderWithProviders(<TestApp />, { route: '/register' });

    expect(await screen.findByText('onboarding screen')).toBeInTheDocument();
  });

  it('bounces an already-signed-in farmer off /login to the dashboard when they have a field', async () => {
    withFarms();

    renderWithProviders(<TestApp />, { route: '/login' });

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument();
  });

  it('falls through to the dashboard rather than trapping the farmer when the lookup fails', async () => {
    server.use(
      http.get(url('/farms'), () =>
        Response.json(
          { success: false, error: { code: 'INTERNAL_ERROR', messageKey: 'errors.internal' } },
          { status: 500 },
        ),
      ),
    );

    renderWithProviders(<TestApp />, { route: '/' });

    expect(await screen.findByText('dashboard screen')).toBeInTheDocument();
  });
});
