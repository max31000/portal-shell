import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMe,
  logout as apiLogout,
  type AppAccess,
  type AuthUser,
  type MeResponse,
} from './api';
import { setAccountMarker } from './accountMarker';

export type AuthStatus = 'unavailable' | 'loading' | 'anonymous' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  apps: AppAccess[];
  /** Always re-reads `/me` afterwards; rejects (after that) if the logout request failed. */
  logout: () => Promise<void>;
  /** Re-read `/me` (the server refreshes the access cookie implicitly if needed). Resolves to the new snapshot. */
  refresh: () => Promise<AuthSnapshot>;
  /** Adopt a `/me` body obtained elsewhere (the `/telegram` login in App, the invite redeem response). */
  apply: (me: MeResponse) => AuthSnapshot;
}

export interface AuthSnapshot {
  status: AuthStatus;
  user: AuthUser | null;
  apps: AppAccess[];
}

function fromMe(me: MeResponse): AuthSnapshot {
  return { status: me.user ? 'authenticated' : 'anonymous', user: me.user, apps: me.apps };
}

const UNAVAILABLE: AuthSnapshot = { status: 'unavailable', user: null, apps: [] };

export function useAuth(): AuthState {
  const [snap, setSnap] = useState<AuthSnapshot>({ status: 'loading', user: null, apps: [] });
  const mounted = useRef(true);

  const load = useCallback(async (signal?: AbortSignal): Promise<AuthSnapshot> => {
    let next: AuthSnapshot;
    try {
      next = fromMe(await getMe(signal));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // AuthUnavailableError (404, HTML fallback, network) or anything unexpected: behave as a no-auth shell.
      next = UNAVAILABLE;
    }
    if (mounted.current) setSnap(next);
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();
    load(ctrl.signal).catch(() => {});
    return () => {
      mounted.current = false;
      ctrl.abort();
    };
  }, [load]);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      await load().catch(() => {});
    }
  }, [load]);

  // Device marker (code-first login, decision 2): every signed-in `/me` — boot, refresh, the login response —
  // marks this browser as «has an account», so existing users get it on their first visit after the rollout.
  useEffect(() => {
    if (snap.status === 'authenticated') setAccountMarker();
  }, [snap.status]);

  const refresh = useCallback(() => load(), [load]);

  const apply = useCallback((me: MeResponse) => {
    const next = fromMe(me);
    if (mounted.current) setSnap(next);
    return next;
  }, []);

  return useMemo(
    () => ({ ...snap, logout, refresh, apply }),
    [snap, logout, refresh, apply],
  );
}

/**
 * Lock rule (spec §9.6): only when auth is up, the service is on shared auth (registry `auth: "shared"`),
 * the app needs login, and the user has no access. Services still on their own login are never locked.
 */
export function isAppLocked(
  status: AuthStatus,
  apps: AppAccess[],
  service: { id: string; auth?: 'shared' },
): boolean {
  if (status !== 'anonymous' && status !== 'authenticated') return false;
  if (service.auth !== 'shared') return false;
  const app = apps.find((a) => a.id === service.id);
  if (!app) return false;
  return !app.anonymous && !app.granted;
}
