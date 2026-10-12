/**
 * Typed client of the mvv42-auth admin API (`/auth/api/admin`, policy `owner`) — contract addendum A of the
 * round-2 plan + `mvv42-auth/docs/api.md`. Every call goes through the kit's `apiJson` (cookies, one refresh
 * on 401, `ApiError { status, code }` on non-2xx, `undefined` for 204). Unsafe methods are same-origin
 * `fetch`es, so the browser adds the `Origin` header the auth CSRF check requires.
 */
import { apiJson as kitApiJson, isApiError } from '@mvv42/kit/platform';

let authLostHandler: (() => void) | null = null;

/**
 * Called when an admin request ends in 401 (session gone after the kit's refresh) or 403 (no longer the owner):
 * the shell re-reads `/me`, so the route falls back to the sign-in modal / 404. Returns an unsubscribe.
 */
export function onAdminAuthLost(handler: () => void): () => void {
  authLostHandler = handler;
  return () => {
    if (authLostHandler === handler) authLostHandler = null;
  };
}

async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  try {
    return await kitApiJson<T>(input, init);
  } catch (error) {
    if (isApiError(error) && (error.status === 401 || error.status === 403)) authLostHandler?.();
    throw error;
  }
}

export const ADMIN_API = '/auth/api/admin';

export type AccessMode = 'public' | 'invite' | 'admin';
export type LoginResult = 'ok' | 'denied_blocked' | 'invalid' | 'replayed';
export type InviteStatus = 'active' | 'expired' | 'exhausted';

export interface AdminUser {
  id: number;
  telegramId: number;
  name: string;
  username: string | null;
  photoUrl: string | null;
  /** Effective: `users.is_admin` or owner. */
  isAdmin: boolean;
  isOwner: boolean;
  isBlocked: boolean;
  blockedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** Not revoked and not expired. */
  activeSessions: number;
  /** Explicit grants (app ids), sorted. */
  grants: string[];
}

export interface AdminSession {
  id: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
}

export interface LoginEvent {
  id: number;
  at: string;
  userId: number | null;
  telegramId: number | null;
  userName: string | null;
  ip: string | null;
  userAgent: string | null;
  result: LoginResult;
}

export interface AdminApp {
  id: string;
  name: string;
  anonymous: boolean;
  access: AccessMode;
}

export interface OverviewApp extends AdminApp {
  /** Non-blocked users that may use the app (same rule as `granted` in `/me`). */
  grantedUsers: number;
}

export interface AdminOverview {
  users: number;
  activeSessions: number;
  /** Successful logins over the last 24 h / 7 days. */
  logins24h: number;
  logins7d: number;
  blocked: number;
  apps: OverviewApp[];
}

export interface AdminUserDetail {
  user: AdminUser;
  /** Active sessions, newest first. */
  sessions: AdminSession[];
  /** Last 50 login attempts, newest first. */
  logins: LoginEvent[];
}

export interface LoginsPage {
  items: LoginEvent[];
  /** Pass as `before` for the next (older) page; `null` = no more. */
  nextBefore: number | null;
}

export interface AdminGrant {
  userId: number;
  appId: string;
  createdAt: string;
}

export interface AdminInvite {
  id: number;
  appId: string;
  maxUses: number;
  uses: number;
  /** Always set by the API; `null` only for hand-made rows (never expires). */
  expiresAt: string | null;
  createdBy: number | null;
  createdAt: string;
  /** `exhausted` wins over `expired`. */
  status: InviteStatus;
}

export interface CreateInviteInput {
  appId: string;
  /** 1…1000, default 1. */
  maxUses?: number;
  /** 1…8760, default 168 (7 days). */
  expiresInHours?: number;
}

export interface CreatedInvite {
  id: number;
  /** Plain code — returned once, only its SHA-256 is stored. */
  code: string;
  appId: string;
  maxUses: number;
  expiresAt: string;
}

export interface AppInput {
  name: string;
  anonymous: boolean;
  access: AccessMode;
}

/** Error codes of the admin API (`{ "error": "<code>" }`). */
export type AdminErrorCode =
  | 'user_not_found'
  | 'session_not_found'
  | 'invite_not_found'
  | 'cannot_block_owner'
  | 'cannot_change_owner'
  | 'invalid_limit'
  | 'invalid_before'
  | 'invalid_app_id'
  | 'invalid_name'
  | 'invalid_access'
  | 'unknown_user'
  | 'unknown_app'
  | 'invalid_max_uses'
  | 'invalid_expiry'
  | 'origin_not_allowed';

const seg = (v: string | number) => encodeURIComponent(String(v));

function send(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<void> {
  return apiJson<void>(ADMIN_API + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const adminApi = {
  overview: () => apiJson<AdminOverview>(`${ADMIN_API}/overview`),

  users: () => apiJson<AdminUser[]>(`${ADMIN_API}/users`),
  user: (id: number) => apiJson<AdminUserDetail>(`${ADMIN_API}/users/${seg(id)}`),
  /** 400 `cannot_change_owner` for the owner. */
  setAdmin: (id: number, isAdmin: boolean) => send('PUT', `/users/${seg(id)}/admin`, { isAdmin }),
  /** Blocking revokes every session; 400 `cannot_block_owner`. */
  setBlocked: (id: number, blocked: boolean) => send('PUT', `/users/${seg(id)}/blocked`, { blocked }),
  revokeSessions: (id: number) => send('POST', `/users/${seg(id)}/revoke-sessions`),
  revokeSession: (sessionId: number) => send('DELETE', `/sessions/${seg(sessionId)}`),

  /** Newest first; `limit` 1…500 (server default 100), `before` = previous page's `nextBefore`. */
  logins: (params: { limit?: number; before?: number | null } = {}) => {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set('limit', String(params.limit));
    if (params.before !== undefined && params.before !== null) q.set('before', String(params.before));
    const qs = q.toString();
    return apiJson<LoginsPage>(`${ADMIN_API}/logins${qs ? `?${qs}` : ''}`);
  },

  apps: () => apiJson<AdminApp[]>(`${ADMIN_API}/apps`),
  /** Upsert; returns the saved app. */
  saveApp: (id: string, input: AppInput) =>
    apiJson<AdminApp>(`${ADMIN_API}/apps/${seg(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteApp: (id: string) => send('DELETE', `/apps/${seg(id)}`),

  grants: (userId?: number) =>
    apiJson<AdminGrant[]>(`${ADMIN_API}/grants${userId === undefined ? '' : `?userId=${seg(userId)}`}`),
  grant: (userId: number, appId: string) => send('POST', '/grants', { userId, appId }),
  revokeGrant: (userId: number, appId: string) => send('DELETE', `/grants/${seg(userId)}/${seg(appId)}`),

  invites: () => apiJson<AdminInvite[]>(`${ADMIN_API}/invites`),
  createInvite: (input: CreateInviteInput) =>
    apiJson<CreatedInvite>(`${ADMIN_API}/invites`, {
      method: 'POST',
      body: JSON.stringify({ maxUses: 1, expiresInHours: 168, ...input }),
    }),
  deleteInvite: (id: number) => send('DELETE', `/invites/${seg(id)}`),
};

/** Link the shell turns into a redeem (`/?invite=<code>`, spec §10.10). */
export function inviteLink(code: string, origin: string = window.location.origin): string {
  return `${origin}/?invite=${encodeURIComponent(code)}`;
}
