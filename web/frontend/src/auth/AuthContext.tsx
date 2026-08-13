/**
 * Session state.
 *
 * One of the two small contexts ADR-014 permits (the other is language).
 * Everything else is server state and lives in React Query.
 *
 * ## Bootstrap
 *
 * On load the app does not know whether it is signed in: the access token was
 * only ever in memory, and that memory is gone. What survives is the
 * path-scoped httpOnly refresh cookie, so the first thing that happens is a
 * silent `POST /auth/refresh`. Until it answers, `status` is `bootstrapping`
 * and the guards hold — rendering the login page during that window would log
 * a valid session out on every refresh, which is the single most common way
 * this pattern is got wrong.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { authApi } from '@/api/endpoints';
import { refreshSession } from '@/api/client';
import { clearAccessToken, onSessionLost, setAccessToken } from '@/api/session';
import type { Language, User } from '@/api/types';

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** True while a refresh has fired but not yet resolved. */
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  login: (input: { email: string; password: string }) => Promise<User>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    language?: Language;
  }) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('bootstrapping');
  const [user, setUser] = useState<User | null>(null);
  const queryClient = useQueryClient();

  const endSession = useCallback(() => {
    clearAccessToken();
    setUser(null);
    setStatus('anonymous');
    // Cached server data belongs to the account that just left. Removing
    // rather than invalidating: an invalidate would refetch it, unauthenticated.
    queryClient.removeQueries();
  }, [queryClient]);

  useEffect(() => onSessionLost(endSession), [endSession]);

  /**
   * The bootstrap.
   *
   * ## Why there is no "already ran" ref here
   *
   * The obvious guard — a `useRef(false)` that returns early on the second
   * run — is wrong under StrictMode, and wrong in a way that hangs the whole
   * app. StrictMode mounts, unmounts and re-mounts in development: the first
   * run starts the request and registers its cleanup, the unmount fires that
   * cleanup and sets its `cancelled` flag, and the re-mount then hits the ref
   * and returns without starting anything. The only bootstrap in flight is one
   * whose result will be discarded, so `status` never leaves `bootstrapping`
   * and every screen sits on "Checking your session…" forever.
   *
   * De-duplication belongs one layer down instead, where it is already
   * correct: `refreshSession()` is single-flight, so the second run joins the
   * first request rather than issuing another. Each run keeps its own
   * `cancelled` flag and the surviving one applies the result.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const token = await refreshSession();

      if (!token) {
        if (!cancelled) {
          setUser(null);
          setStatus('anonymous');
        }
        return;
      }

      try {
        const { user: restored } = await authApi.me();
        if (cancelled) return;
        setUser(restored);
        setStatus('authenticated');
      } catch {
        // A token that refreshes but cannot identify itself is not a session.
        if (cancelled) return;
        clearAccessToken();
        setUser(null);
        setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback<AuthContextValue['login']>(
    async (input) => {
      const session = await authApi.login(input);
      setAccessToken(session.accessToken);
      // A previous account's cache must not survive into this one.
      queryClient.removeQueries();
      setUser(session.user);
      setStatus('authenticated');
      return session.user;
    },
    [queryClient],
  );

  const register = useCallback<AuthContextValue['register']>(
    async (input) => {
      const session = await authApi.register(input);
      setAccessToken(session.accessToken);
      queryClient.removeQueries();
      setUser(session.user);
      setStatus('authenticated');
      return session.user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The server-side revoke is best-effort: if it fails, the local session
      // still ends. Leaving the farmer signed in because a network call failed
      // would be the worse outcome on a shared phone.
    } finally {
      endSession();
    }
  }, [endSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isBootstrapping: status === 'bootstrapping',
      isAuthenticated: status === 'authenticated',
      login,
      register,
      logout,
    }),
    [status, user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
