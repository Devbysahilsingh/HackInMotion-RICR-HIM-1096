/**
 * Token custody.
 *
 * The split matters and is the one place this client deliberately differs from
 * the web:
 *
 * - **Access token** — JS memory only, exactly as on the web. It is short-lived
 *   and re-derivable, so persisting it would add a theft surface and buy
 *   nothing.
 * - **Refresh token** — `expo-secure-store`, which is backed by the Android
 *   Keystore. Never AsyncStorage: the Query cache lives there, it is plain
 *   text in the app sandbox, and a rooted or backed-up device would give up a
 *   long-lived credential (docs/mobile/authentication.md).
 *
 * There is no cookie on this surface — React Native has no cookie jar we would
 * want to trust — so the refresh token travels in the request body, which the
 * API supports on every route that takes one (backend/src/routes/auth.js).
 *
 * Deliberately free of React: the axios interceptor needs these during a
 * request, which is outside any render.
 */
import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'him1096.refreshToken';

let accessToken: string | null = null;

export const getAccessToken = (): string | null => accessToken;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

/**
 * Reads the stored refresh token.
 *
 * A SecureStore failure is treated as "no token" rather than raised: the
 * Keystore can genuinely fail to unwrap after a device restore or a lock-screen
 * change, and the correct response to that is a fresh login, not a crash on
 * the splash screen.
 */
export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
    // Survives a reboot but is only readable once the device has been unlocked
    // at least once — the strictest option that still allows a cold start.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function clearRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // Already absent, or the store is unreadable. Either way there is nothing
    // left to clear and the caller is on its way to the auth stack.
  }
}

type SessionLostReason = 'refresh_failed' | 'logout';
type SessionLostListener = (reason: SessionLostReason) => void;

const sessionLostListeners = new Set<SessionLostListener>();

/**
 * Announces that the session is gone and cannot be recovered.
 *
 * Published as an event rather than a direct navigation because the failure is
 * discovered inside an interceptor, where there is no navigator. `AuthContext`
 * subscribes, drops its user, and the root navigator swaps to the auth stack.
 */
export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => {
    sessionLostListeners.delete(listener);
  };
}

export function emitSessionLost(reason: SessionLostReason): void {
  accessToken = null;
  for (const listener of sessionLostListeners) listener(reason);
}
