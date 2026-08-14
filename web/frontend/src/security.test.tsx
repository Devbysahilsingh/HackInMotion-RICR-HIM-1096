/**
 * Client-side security regressions (Phase 7).
 *
 * These are not feature tests. Each one pins an invariant that an ordinary,
 * well-meaning change could silently break — the kind that leaves every other
 * test green:
 *
 * 1. A citation URL from the API must not be able to become a `javascript:`
 *    href. React does not sanitise `href`; it renders the value verbatim.
 * 2. A hostile *data* value — a farm name, a district — must render as text.
 *    There is no server-rendered HTML here and no `dangerouslySetInnerHTML`, so
 *    this holds by construction today; the test is what makes it stay true.
 * 3. The access token must live in memory and nowhere a later script, a shared
 *    browser profile, a referrer header or a log line could pick it up.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { safeExternalUrl } from '@shared/client/url';

import { getAccessToken } from '@/api/session';
import { queryKeys } from '@/api/queryKeys';
import { useAuth } from '@/auth/AuthContext';
import { SourceList } from '@/components/domain/FertilizerGuidanceView';
import FarmListPage from '@/pages/farms/FarmListPage';
import { renderWithProviders, createTestQueryClient } from '@/test/render';
import * as fixtures from '@/test/fixtures';
import { http, ok, server, url } from '@/test/server';

// ── 1. Citation URLs ────────────────────────────────────────────────────────

describe('safeExternalUrl', () => {
  it('passes the two schemes a citation may legitimately use', () => {
    expect(safeExternalUrl('https://tnau.ac.in/early-blight')).toBe(
      'https://tnau.ac.in/early-blight',
    );
    expect(safeExternalUrl('http://icar.org.in/x')).toBe('http://icar.org.in/x');
  });

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    // Browsers strip control characters before dispatching, so a naive
    // `startsWith('javascript:')` check would pass this straight through.
    ['java\tscript:alert(1)'],
    ['java\nscript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:msgbox(1)'],
    ['blob:https://evil.test/1234'],
    ['file:///etc/passwd'],
    // Relative values are malformed citations, not links into this app.
    ['/farms/66b0000000000000000000b1'],
    ['//evil.test/phish'],
    [''],
    ['   '],
  ])('refuses %j', (value) => {
    expect(safeExternalUrl(value)).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl({ toString: () => 'https://evil.test' })).toBeNull();
  });
});

describe('SourceList · citation links', () => {
  it('links a real http(s) citation', () => {
    renderWithProviders(
      <SourceList
        sources={[{ org: 'TNAU', title: 'Early blight', url: 'https://tnau.ac.in/eb' }]}
      />,
    );

    const anchor = screen.getByRole('link', { name: /TNAU — Early blight/ });
    expect(anchor).toHaveAttribute('href', 'https://tnau.ac.in/eb');
    // An external tab must not hand the opener a window reference.
    expect(anchor).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('never emits a javascript: href, and keeps the citation readable', () => {
    renderWithProviders(
      <SourceList
        sources={[{ org: 'Evil', title: 'Click me', url: 'javascript:alert(document.cookie)' }]}
      />,
    );

    const list = screen.getByTestId('source-list');
    expect(list.querySelector('a')).toBeNull();

    // The URL is still shown — as text — so provenance is not silently lost.
    expect(list.textContent).toContain('Evil — Click me — javascript:alert(document.cookie)');

    // Belt and braces: no anchor anywhere in the document carries the scheme.
    for (const anchor of document.querySelectorAll('a')) {
      expect(anchor.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i);
    }
  });

  it('renders a citation with no URL at all as plain text', () => {
    renderWithProviders(<SourceList sources={[{ org: 'ICAR', title: 'Package of practices' }]} />);

    expect(screen.getByTestId('source-list').querySelector('a')).toBeNull();
    expect(screen.getByTestId('source-list').textContent).toContain('ICAR — Package of practices');
  });
});

// ── 2. Stored XSS round trip ────────────────────────────────────────────────

const XSS = '<img src=x onerror=alert(1)>';

describe('stored XSS · hostile data fields render as text', () => {
  it('renders a farm name and district containing markup as literal text', async () => {
    server.use(
      http.get(url('/farms'), () =>
        ok({
          farms: [
            {
              ...fixtures.farm,
              name: XSS,
              location: { ...fixtures.farm.location, district: XSS, state: '<script>x()</script>' },
            },
          ],
        }),
      ),
    );

    renderWithProviders(<FarmListPage />, { route: '/farms' });

    const item = await screen.findByTestId('farm-list-item');

    // The payload survived as *text*…
    expect(item.textContent).toContain(XSS);
    // …and produced no element. `img` would exist if the string had been parsed
    // as HTML; `onerror` would have fired on it.
    expect(item.querySelector('img')).toBeNull();
    expect(item.querySelector('script')).toBeNull();
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('does not let a hostile name reach an href', async () => {
    server.use(
      http.get(url('/farms'), () =>
        ok({ farms: [{ ...fixtures.farm, id: 'javascript:alert(1)', name: XSS }] }),
      ),
    );

    renderWithProviders(<FarmListPage />, { route: '/farms' });

    const item = await screen.findByTestId('farm-list-item');
    // react-router builds the target from the id; it must stay a path.
    expect(item.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i);
  });
});

// ── 3. Access-token custody ─────────────────────────────────────────────────

function LoginHarness() {
  const { login, logout, status } = useAuth();

  return (
    <div>
      <span data-testid="status">{status}</span>
      <button onClick={() => void login({ email: 'demo@example.com', password: 'pw' })}>
        sign in
      </button>
      <button onClick={() => void logout()}>sign out</button>
    </div>
  );
}

/** Every place a token could end up that is readable after the fact. */
function storageSnapshot(): string {
  const dump = (storage: Storage): string =>
    Object.keys(storage)
      .map((key) => `${key}=${storage.getItem(key) ?? ''}`)
      .join('\n');

  return [
    dump(window.localStorage),
    dump(window.sessionStorage),
    document.cookie,
    window.location.href,
  ].join('\n');
}

describe('access token custody', () => {
  it('is held in memory and written to no readable store', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );

    const user = userEvent.setup();
    renderWithProviders(<LoginHarness />);

    await user.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    const token = fixtures.session.accessToken;

    // It really is held — otherwise the assertions below pass vacuously.
    expect(getAccessToken()).toBe(token);
    expect(token.length).toBeGreaterThan(0);

    expect(storageSnapshot()).not.toContain(token);

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call) ?? '').not.toContain(token);
      }
    }
  });

  it('is dropped from memory on logout, along with the cached account data', async () => {
    const queryClient = createTestQueryClient();
    const user = userEvent.setup();

    renderWithProviders(<LoginHarness />, { queryClient });

    await user.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    // Stand in for anything the signed-in session had already fetched.
    queryClient.setQueryData(queryKeys.farms.list(), { farms: [fixtures.farm] });
    expect(queryClient.getQueryData(queryKeys.farms.list())).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

    expect(getAccessToken()).toBeNull();
    // A shared browser profile: the next farmer must not see the last one's farms.
    expect(queryClient.getQueryData(queryKeys.farms.list())).toBeUndefined();
    expect(storageSnapshot()).not.toContain(fixtures.session.accessToken);
  });

  it('keeps the refresh token out of the client entirely', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginHarness />);

    await user.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    // The web surface never touches the refresh token: it is set by the API as
    // a path-scoped httpOnly cookie, which script cannot read. The login
    // response carries one for the mobile client's benefit; the web client must
    // not have filed it anywhere.
    expect(storageSnapshot()).not.toContain(fixtures.session.refreshToken);
  });
});
