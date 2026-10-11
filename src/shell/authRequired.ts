import { isAppLocked, type AuthSnapshot } from '../auth/useAuth';

/** At most one AUTH_CHANGED per service in this window when the session did not actually change. */
export const AUTH_CHANGED_MIN_INTERVAL_MS = 10_000;

export type AuthRequiredAction =
  /** Signed out after refresh → open the login modal. */
  | { kind: 'login' }
  /** Session/user/access changed → tell the service to re-read `/me`. */
  | { kind: 'authChanged' }
  /** Signed in, nothing changed, and the service is not accessible → «Нет доступа к сервису». */
  | { kind: 'noAccess' }
  /** Nothing to do (auth unavailable, or an AUTH_CHANGED was sent to this service too recently). */
  | { kind: 'ignore' };

/** Identity of what a service can observe through `/me`: user, admin flag and per-app grants. */
export function authFingerprint(s: Pick<AuthSnapshot, 'status' | 'user' | 'apps'>): string {
  const apps = s.apps.map((a) => `${a.id}:${a.anonymous ? 1 : 0}${a.granted ? 1 : 0}`).join(',');
  return `${s.status}|${s.user?.id ?? ''}|${s.user?.isAdmin ? 1 : 0}|${apps}`;
}

/**
 * What to do with `AUTH_REQUIRED` from `serviceId`, given the auth state before and after
 * `refreshSession()` + re-reading `/me`. `lastAuthChangedAt` is when AUTH_CHANGED was last posted to
 * that service (undefined if never). Never answers an unchanged session with AUTH_CHANGED more than
 * once per interval, so a service that keeps getting 401 cannot make the shell loop.
 */
export function decideAuthRequired(
  before: Pick<AuthSnapshot, 'status' | 'user' | 'apps'>,
  after: Pick<AuthSnapshot, 'status' | 'user' | 'apps'>,
  serviceId: string,
  now: number,
  lastAuthChangedAt: number | undefined,
): AuthRequiredAction {
  if (after.status === 'anonymous') return { kind: 'login' };
  if (after.status !== 'authenticated') return { kind: 'ignore' };
  if (authFingerprint(before) !== authFingerprint(after)) return { kind: 'authChanged' };
  if (isAppLocked(after.status, after.apps, serviceId)) return { kind: 'noAccess' };
  if (lastAuthChangedAt !== undefined && now - lastAuthChangedAt < AUTH_CHANGED_MIN_INTERVAL_MS) {
    return { kind: 'ignore' };
  }
  return { kind: 'authChanged' };
}
