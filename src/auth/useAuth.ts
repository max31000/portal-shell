import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMe,
  loginTelegram,
  logout as apiLogout,
  type AppAccess,
  type AuthUser,
  type MeResponse,
  type TelegramAuthData,
} from './api';

export type AuthStatus = 'unavailable' | 'loading' | 'anonymous' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  apps: AppAccess[];
  login: (data: TelegramAuthData) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-read `/me` (the server refreshes the access cookie implicitly if needed). */
  refresh: () => Promise<void>;
}

interface Snapshot {
  status: AuthStatus;
  user: AuthUser | null;
  apps: AppAccess[];
}

function fromMe(me: MeResponse): Snapshot {
  return { status: me.user ? 'authenticated' : 'anonymous', user: me.user, apps: me.apps };
}

const UNAVAILABLE: Snapshot = { status: 'unavailable', user: null, apps: [] };

export function useAuth(): AuthState {
  const [snap, setSnap] = useState<Snapshot>({ status: 'loading', user: null, apps: [] });
  const mounted = useRef(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const me = await getMe(signal);
      if (mounted.current) setSnap(fromMe(me));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // AuthUnavailableError (404, HTML fallback, network) or anything unexpected: behave as a no-auth shell.
      if (mounted.current) setSnap(UNAVAILABLE);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => {
      mounted.current = false;
      ctrl.abort();
    };
  }, [load]);

  const login = useCallback(async (data: TelegramAuthData) => {
    const me = await loginTelegram(data);
    if (mounted.current) setSnap(fromMe(me));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      await load();
    }
  }, [load]);

  const refresh = useCallback(() => load(), [load]);

  return useMemo(
    () => ({ ...snap, login, logout, refresh }),
    [snap, login, logout, refresh],
  );
}

/** Lock rule (spec §9.6): only when auth is up, the app needs login, and the user has no access. */
export function isAppLocked(status: AuthStatus, apps: AppAccess[], serviceId: string): boolean {
  if (status !== 'anonymous' && status !== 'authenticated') return false;
  const app = apps.find((a) => a.id === serviceId);
  if (!app) return false;
  return !app.anonymous && !app.granted;
}
