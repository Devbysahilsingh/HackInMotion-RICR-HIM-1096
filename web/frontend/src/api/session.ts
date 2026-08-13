/**
 * Access-token custody.
 *
 * The token lives in a module variable and nowhere else — not localStorage,
 * not sessionStorage, not a non-httpOnly cookie — so a script that manages to
 * run on the page cannot read it out of persistent storage after the fact
 * (docs/frontend/architecture.md: "access token in memory"). Durability across
 * a reload comes from the path-scoped httpOnly refresh cookie the API sets,
 * which script cannot read at all.
 *
 * This module is deliberately free of React: the axios interceptor needs the
 * token during a request, which is outside any render.
 */

let accessToken: string | null = null;

type SessionLostReason = 'refresh_failed' | 'logout';
type SessionLostListener = (reason: SessionLostReason) => void;

const sessionLostListeners = new Set<SessionLostListener>();

export const getAccessToken = (): string | null => accessToken;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const clearAccessToken = (): void => {
  accessToken = null;
};

/**
 * Announces that the session is gone and cannot be recovered.
 *
 * Published as an event rather than a direct navigation because the failure is
 * discovered inside an interceptor, where there is no router. `AuthContext`
 * subscribes and clears its state; the route guards then do the redirect and
 * preserve the intent URL.
 */
export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}

export function emitSessionLost(reason: SessionLostReason): void {
  accessToken = null;
  for (const listener of sessionLostListeners) listener(reason);
}
