import { describe, expect, it } from 'vitest';
import { AUTH_CHANGED_MIN_INTERVAL_MS, decideAuthRequired } from './authRequired';
import type { AuthSnapshot } from '../auth/useAuth';
import type { AppAccess } from '../auth/api';

const user = { id: 7, telegramId: 123, name: 'Max', username: null, photoUrl: null, isAdmin: false, isOwner: false };
const apps: AppAccess[] = [
  { id: 'cashpulse', anonymous: false, access: 'public', granted: true },
  { id: 'bonds', anonymous: false, access: 'admin', granted: false },
];
const authed: AuthSnapshot = { status: 'authenticated', user, apps };
const anon: AuthSnapshot = { status: 'anonymous', user: null, apps: apps.map((a) => ({ ...a, granted: false })) };

describe('decideAuthRequired', () => {
  it('opens login when signed out after refresh', () => {
    expect(decideAuthRequired(authed, anon, 'cashpulse', 0, undefined)).toEqual({ kind: 'login' });
  });

  it('ignores when auth became unavailable', () => {
    const down: AuthSnapshot = { status: 'unavailable', user: null, apps: [] };
    expect(decideAuthRequired(authed, down, 'cashpulse', 0, undefined)).toEqual({ kind: 'ignore' });
  });

  it('posts AUTH_CHANGED when the session changed (even if recently posted)', () => {
    expect(decideAuthRequired(anon, authed, 'cashpulse', 1000, 999)).toEqual({ kind: 'authChanged' });
    const granted = { ...authed, apps: apps.map((a) => ({ ...a, granted: true })) };
    expect(decideAuthRequired(authed, granted, 'bonds', 1000, 999)).toEqual({ kind: 'authChanged' });
  });

  it('shows «no access» for an unchanged session on a locked app', () => {
    expect(decideAuthRequired(authed, authed, 'bonds', 0, undefined)).toEqual({ kind: 'noAccess' });
  });

  it('rate-limits AUTH_CHANGED for an unchanged session', () => {
    const t = 50_000;
    expect(decideAuthRequired(authed, authed, 'cashpulse', t, undefined)).toEqual({ kind: 'authChanged' });
    expect(decideAuthRequired(authed, authed, 'cashpulse', t, t - 1)).toEqual({ kind: 'ignore' });
    expect(decideAuthRequired(authed, authed, 'cashpulse', t, t - AUTH_CHANGED_MIN_INTERVAL_MS)).toEqual({
      kind: 'authChanged',
    });
  });
});
