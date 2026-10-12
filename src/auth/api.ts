/**
 * Thin client for mvv42-auth (`/auth/api/*`, spec §4.3 / §9).
 * Cookies are HttpOnly + SameSite=Strict; we only ever send them same-origin.
 */

import { ApiError, apiJson, type AppAccess, type AppAccessMode, type Me, type Mvv42User } from '@mvv42/kit/platform';

/** Wire types of `/auth/api/me` come from the kit (`Me`, `Mvv42User`, `AppAccess`). */
export type { AppAccess, Me, Mvv42User };
/** Alias used across the shell. */
export type AuthUser = Mvv42User;
export type MeResponse = Me;
export type AccessMode = AppAccessMode;

/** Object passed by the Telegram Login Widget to `data-onauth`. */
export interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export const AUTH_API = '/auth/api';

/** Auth service is not deployed / not reachable / answered with something that is not the auth API. */
export class AuthUnavailableError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message = 'Auth unavailable') {
    super(message);
    this.name = 'AuthUnavailableError';
    this.status = status;
  }
}

export class AuthRequestError extends Error {
  readonly status: number;
  /** `{ "error": "<code>" }` from the body (e.g. `invite_required`, `Replayed`), null if there was none. */
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON id: the backend sends `long` numbers (safe integers in practice); tolerate numeric strings too. */
function toId(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v)) return Number(v);
  return null;
}

function toNullableString(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : undefined;
}

function parseUser(v: unknown): Mvv42User | null | undefined {
  if (v === null) return null;
  if (!isRecord(v)) return undefined;
  const id = toId(v.id);
  const telegramId = toId(v.telegramId);
  const username = toNullableString(v.username);
  const photoUrl = toNullableString(v.photoUrl);
  if (id === null || telegramId === null || typeof v.name !== 'string') return undefined;
  if (username === undefined || photoUrl === undefined || typeof v.isAdmin !== 'boolean') return undefined;
  // `isOwner` arrived with the admin console; an older auth without it simply has no owner.
  if (v.isOwner !== undefined && typeof v.isOwner !== 'boolean') return undefined;
  return { id, telegramId, name: v.name, username, photoUrl, isAdmin: v.isAdmin, isOwner: v.isOwner === true };
}

function parseApp(v: unknown): AppAccess | undefined {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.access !== 'string') return undefined;
  if (typeof v.anonymous !== 'boolean' || typeof v.granted !== 'boolean') return undefined;
  // An unknown future mode is passed through; the shell only reads `anonymous` / `granted`.
  return { id: v.id, anonymous: v.anonymous, access: v.access as AppAccessMode, granted: v.granted };
}

/**
 * Validates and normalises the `/me` and `/telegram` body (`MeResponse` in mvv42-auth, camelCase JSON):
 * `{ user: MeUser | null, apps: { id, anonymous, access, granted }[] }` (kit `Me`). Returns null on any mismatch.
 */
export function parseMeResponse(v: unknown): MeResponse | null {
  if (!isRecord(v) || !Array.isArray(v.apps)) return null;
  const user = parseUser(v.user);
  if (user === undefined) return null;
  const apps: AppAccess[] = [];
  for (const a of v.apps) {
    const app = parseApp(a);
    if (!app) return null;
    apps.push(app);
  }
  return { user, apps };
}

/**
 * GET /auth/api/me. The server performs an implicit refresh when the access cookie is missing/expired
 * but the refresh cookie is valid (spec §9.4), so the shell never needs to refresh on boot.
 *
 * Anything other than a 200 with a well-formed JSON body — 404 before auth is deployed, the SPA
 * index.html fallback, network errors — throws AuthUnavailableError.
 */
export async function getMe(signal?: AbortSignal): Promise<MeResponse> {
  let res: Response;
  try {
    res = await fetch(`${AUTH_API}/me`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new AuthUnavailableError(null, 'Network error');
  }
  if (res.status !== 200) throw new AuthUnavailableError(res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AuthUnavailableError(res.status, 'Not JSON');
  }
  const me = parseMeResponse(body);
  if (!me) throw new AuthUnavailableError(res.status, 'Unexpected /me shape');
  return me;
}

async function post(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> =
    body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' };
  return fetch(`${AUTH_API}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Header carrying the invite code of a new user on `POST /telegram` (closed registration). */
export const INVITE_HEADER = 'X-Invite-Code';

export interface TelegramLogin {
  me: MeResponse;
  /**
   * Present only when this login registered a new user with an invite code (`appId` null = login-only invite).
   * Absent for known users — the code header is ignored for them.
   */
  invite: { appId: string | null } | null;
}

function parseLoginInvite(v: unknown): { appId: string | null } | null {
  if (!isRecord(v)) return null;
  if (v.appId === null || v.appId === undefined) return { appId: null };
  return typeof v.appId === 'string' ? { appId: v.appId } : null;
}

/**
 * POST /auth/api/telegram with the raw widget object (the HMAC covers only it) and, for a new user, the already
 * normalised ASCII invite code in `X-Invite-Code`. Returns the fresh `{user, apps}` and the `invite` marker.
 * Errors carry the server's `{error}` code (`invite_required`, `invite_*`, `Expired`, `Replayed`, `user_blocked`, …).
 */
export async function loginTelegram(data: TelegramAuthData, inviteCode?: string | null): Promise<TelegramLogin> {
  // A header value must be ASCII; a non-ASCII code would make fetch throw — such codes never leave the client.
  const extra = inviteCode && /^[!-~]+$/.test(inviteCode) ? { [INVITE_HEADER]: inviteCode } : undefined;
  const res = await post('/telegram', data, undefined, extra);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = isRecord(body) && typeof body.error === 'string' ? body.error : null;
    throw new AuthRequestError(res.status, `Login failed (${res.status})`, code);
  }
  const me = parseMeResponse(body);
  if (!me || !isRecord(body)) throw new AuthRequestError(res.status, 'Unexpected login response');
  return { me, invite: parseLoginInvite(body.invite) };
}

export async function logout(): Promise<void> {
  const res = await post('/logout');
  if (!res.ok && res.status !== 401) throw new AuthRequestError(res.status, `Logout failed (${res.status})`);
}

let inflightRefresh: Promise<boolean> | null = null;

export const REFRESH_TIMEOUT_MS = 10_000;

/** `AbortSignal.timeout` with a fallback for engines that lack it. */
function timeoutSignal(ms: number): { signal: AbortSignal; dispose: () => void } {
  if (typeof AbortSignal.timeout === 'function') return { signal: AbortSignal.timeout(ms), dispose: () => {} };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, dispose: () => clearTimeout(timer) };
}

/** Runs inside the lock; the timeout guarantees a hung request cannot hold the lock forever. */
async function doRefresh(): Promise<boolean> {
  const { signal, dispose } = timeoutSignal(REFRESH_TIMEOUT_MS);
  try {
    const res = await post('/refresh', undefined, signal);
    return res.ok;
  } catch {
    return false;
  } finally {
    dispose();
  }
}

/**
 * POST /auth/api/refresh, serialised across all same-origin tabs and iframes with
 * `navigator.locks` ('mvv42-refresh', spec §9.1) and de-duplicated in memory within this document
 * (also the fallback when Web Locks are unavailable). Resolves to whether the session is still valid.
 */
export function refreshSession(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const run: Promise<boolean> = locks?.request
    ? locks.request('mvv42-refresh', doRefresh).then((v) => v)
    : doRefresh();
  const flight = run.finally(() => {
    inflightRefresh = null;
  });
  inflightRefresh = flight;
  return flight;
}

export interface RedeemResult {
  /** null — a login-only invite (nothing to grant; always `alreadyGranted`). */
  appId: string | null;
  /** The user could already use the app (grant, public app, admin): no use was spent. */
  alreadyGranted: boolean;
  /** Fresh `/me` (the access cookie was re-issued with the new grant). */
  me: Me;
}

/**
 * POST /auth/api/invites/redeem `{ code }` (any signed-in user). Throws the kit's `ApiError`:
 * 400 `invite_not_found` / `invite_expired` / `invite_exhausted`, 401 when signed out (after one refresh).
 */
export async function redeemInvite(code: string): Promise<RedeemResult> {
  const body = await apiJson<unknown>(`${AUTH_API}/invites/redeem`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  const me = isRecord(body) ? parseMeResponse(body.me) : null;
  if (!isRecord(body) || !(typeof body.appId === 'string' || body.appId === null) || !me) {
    throw new ApiError(200, 'unexpected_response', 'Unexpected redeem response');
  }
  return { appId: body.appId as string | null, alreadyGranted: body.alreadyGranted === true, me };
}
