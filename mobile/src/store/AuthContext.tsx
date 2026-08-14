/**
 * Session state.
 *
 * Bootstrap, per docs/mobile/authentication.md: a refresh token in SecureStore
 * means a session can be resumed without asking for a password, so the app
 * opens on the dashboard rather than on a login form. Absent or refused, it
 * opens on the auth stack. Nothing here decides *navigation* — the root
 * navigator reads `status` and swaps stacks, which keeps the auth logic free
 * of navigator references.
 *
 * ## The offline cold start (RES-11)
 *
 * Destroying the stored refresh token is right when the API said no — the
 * token is spent — and catastrophic when the farmer merely has no signal: the
 * one credential that would have resumed the session is gone, and a device
 * holding a full persisted cache drops to a login form it cannot complete
 * without the network it does not have. docs/offline says the opposite in as
 * many words: "Expired access token offline → read-only cached mode with
 * banner, not a logout wipe."
 *
 * Two things now protect that, at different layers:
 *
 * 1. `api/client.ts` clears the refresh token only when the server actually
 *    answered and refused. A transport failure leaves it alone.
 * 2. Here, the refresh is not even attempted when NetInfo reports no internet.
 *    A stored token is taken as evidence that the persisted cache belongs to a
 *    real session, the app opens on it, and `sessionUnverified` says out loud
 *    that nothing has been checked with the server yet. When connectivity
 *    returns the refresh runs for real and the flag resolves either way.
 *
 * The residual gap is narrow and honest: a captive portal *does* answer with an
 * HTTP response, which is indistinguishable on the wire from the API saying no.
 * A farmer behind one will be signed out.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useIsRestoring, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@shared/client/queryKeys';
import type { Language, User } from '@shared/types/api';

import { authApi } from '../api/endpoints';
import { refreshSession } from '../api/client';
import { clearPersistedCache } from '../api/queryClient';
import {
  clearRefreshToken,
  getRefreshToken,
  onSessionLost,
  setAccessToken,
  setRefreshToken,
} from '../api/session';

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /**
   * True while the app is running on a stored session it has not been able to
   * check with the server — an offline cold start. Reads come from the
   * persisted cache and are labelled; writes are blocked by the offline guard
   * like every other write on a dead radio.
   */
  sessionUnverified: boolean;
  /** True once the farmer has been shown, and dismissed, the language screen. */
  login: (payload: { email: string; password: string }) => Promise<void>;
  register: (payload: {
    name: string;
    email: string;
    password: string;
    language?: Language;
  }) => Promise<void>;
  logout: () => Promise<void>;
  /** Applies a fresh user document after a settings write. */
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUserState] = useState<User | null>(null);
  const [sessionUnverified, setSessionUnverified] = useState(false);
  const queryClient = useQueryClient();
  const isRestoring = useIsRestoring();

  /**
   * The profile, kept in the Query cache rather than in a second store.
   *
   * It rides the persister that already writes the rest of the cache, it is
   * dropped by the same `queryClient.clear()` that logout runs for privacy on a
   * shared handset, and it is what lets an offline cold start greet the farmer
   * by name instead of by a blank header.
   */
  const cacheUser = useCallback(
    (next: User) => {
      setUserState(next);
      queryClient.setQueryData(queryKeys.session(), { user: next });
    },
    [queryClient],
  );

  /** Refresh, then read the profile. Null when the session is over. */
  const resumeOnline = useCallback(async (): Promise<User | null> => {
    const token = await refreshSession();
    if (!token) return null;
    const { user: me } = await authApi.me();
    return me;
  }, []);

  // Resume, once, on cold start. Held until the persister has rehydrated, so
  // the offline branch can see a cached profile rather than an empty cache.
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (isRestoring || bootstrapped.current) return;
    bootstrapped.current = true;

    let cancelled = false;

    void (async () => {
      const stored = await getRefreshToken();
      if (cancelled) return;

      if (!stored) {
        setStatus('anonymous');
        return;
      }

      const network = await NetInfo.fetch().catch(() => null);
      if (cancelled) return;

      const online = network ? (network.isInternetReachable ?? network.isConnected ?? false) : true;

      if (!online) {
        // RES-11. Nothing is sent, so nothing can be refused, so the stored
        // credential survives to be used when the signal comes back.
        const cached = queryClient.getQueryData<{ user: User }>(queryKeys.session());
        setUserState(cached?.user ?? null);
        setSessionUnverified(true);
        setStatus('authenticated');
        return;
      }

      try {
        const me = await resumeOnline();
        if (cancelled) return;

        if (!me) {
          setStatus('anonymous');
          return;
        }

        cacheUser(me);
        setSessionUnverified(false);
        setStatus('authenticated');
      } catch {
        // The refresh worked but the profile read did not — a transient
        // failure on a cold start. The access token is live, so this is a
        // session, not an anonymous device: it opens on the cache and says so
        // rather than sending the farmer back to a login form.
        if (cancelled) return;
        const cached = queryClient.getQueryData<{ user: User }>(queryKeys.session());
        setUserState(cached?.user ?? null);
        setSessionUnverified(true);
        setStatus('authenticated');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheUser, isRestoring, queryClient, resumeOnline]);

  /**
   * Settles an unverified session the moment the device can actually ask.
   *
   * Only mounted while the flag is set, so a normally-online app pays nothing
   * for it.
   */
  useEffect(() => {
    if (!sessionUnverified || status !== 'authenticated') return;

    let cancelled = false;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isInternetReachable ?? state.isConnected ?? false;
      if (!online || cancelled) return;

      void (async () => {
        try {
          const me = await resumeOnline();
          if (cancelled) return;

          if (!me) {
            // The server refused. Now — and only now — is the session over.
            setAccessToken(null);
            await clearRefreshToken();
            setUserState(null);
            setSessionUnverified(false);
            setStatus('anonymous');
            queryClient.clear();
            await clearPersistedCache();
            return;
          }

          cacheUser(me);
          setSessionUnverified(false);
        } catch {
          // Still unreachable. Stay exactly where we are and wait for the next
          // event; nothing here may destroy the credential.
        }
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cacheUser, queryClient, resumeOnline, sessionUnverified, status]);

  // The interceptor discovers a dead session mid-request; this is how that
  // reaches the UI.
  useEffect(
    () =>
      onSessionLost(() => {
        setUserState(null);
        setSessionUnverified(false);
        setStatus('anonymous');
        queryClient.clear();
        // Not awaited: this listener runs inside an interceptor and the UI must
        // swap to the auth stack now, not after a storage round-trip.
        void clearPersistedCache();
      }),
    [queryClient],
  );

  const adoptSession = useCallback(
    async (session: { user: User; accessToken: string; refreshToken: string }) => {
      setAccessToken(session.accessToken);
      await setRefreshToken(session.refreshToken);
      cacheUser(session.user);
      setSessionUnverified(false);
      setStatus('authenticated');
    },
    [cacheUser],
  );

  const login = useCallback(
    async (payload: { email: string; password: string }) => {
      await adoptSession(await authApi.login(payload));
    },
    [adoptSession],
  );

  const register = useCallback(
    async (payload: { name: string; email: string; password: string; language?: Language }) => {
      await adoptSession(await authApi.register(payload));
    },
    [adoptSession],
  );

  /**
   * Logout always ends locally signed out.
   *
   * `POST /auth/logout` sits behind `requireAuth`, so an expired access token
   * makes the server call 401 before it revokes anything. The interceptor will
   * usually rescue that with a refresh; when even that fails there is nothing
   * more this device can do, and refusing to log out would strand a farmer
   * inside an account on a shared handset. The local credential is destroyed
   * either way — a stranded server-side refresh token expires on its own.
   */
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Deliberately swallowed — see above.
    } finally {
      setAccessToken(null);
      await clearRefreshToken();
      setUserState(null);
      setSessionUnverified(false);
      setStatus('anonymous');
      // Privacy on a shared device: the persisted cache holds this farmer's
      // farms, prices, health history and profile. `clear()` handles the
      // in-memory copy; the on-disk copy needs deleting outright, because the
      // persister only rewrites it on a 2s throttle and a phone handed over —
      // or killed — inside that window would keep it.
      queryClient.clear();
      await clearPersistedCache();
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, sessionUnverified, login, register, logout, setUser: cacheUser }),
    [status, user, sessionUnverified, login, register, logout, cacheUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
