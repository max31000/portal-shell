/**
 * Thin client for mvv42-auth (`/auth/api/*`, spec §4.3 / §9).
 * Cookies are HttpOnly + SameSite=Strict; we only ever send them same-origin.
 */

export type AccessMode = 'public' | 'invite' | 'admin';

export interface AuthUser {
  id: string;
  telegramId: string | number;
  name: string;
  username?: string | null;
  photoUrl?: string | null;
  isAdmin: boolean;
}

export interface AppAccess {
  id: string;
  anonymous: boolean;
  access: AccessMode;
  granted: boolean;
}

export interface MeResponse {
  user: AuthUser | null;
  apps: AppAccess[];
}

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
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthRequestError';
    this.status = status;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isMeResponse(v: unknown): v is MeResponse {
  if (!isRecord(v) || !Array.isArray(v.apps)) return false;
  if (v.user !== null && (!isRecord(v.user) || typeof v.user.id !== 'string')) return false;
  return v.apps.every((a) => isRecord(a) && typeof a.id === 'string');
}

function normalizeMe(v: MeResponse): MeResponse {
  return {
    user: v.user,
    apps: v.apps.map((a) => ({
      id: a.id,
      anonymous: !!a.anonymous,
      access: a.access,
      granted: !!a.granted,
    })),
  };
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
  if (!isMeResponse(body)) throw new AuthUnavailableError(res.status, 'Unexpected /me shape');
  return normalizeMe(body);
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${AUTH_API}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** POST /auth/api/telegram with the raw widget object. Returns the fresh `{user, apps}`. */
export async function loginTelegram(data: TelegramAuthData): Promise<MeResponse> {
  const res = await post('/telegram', data);
  if (!res.ok) throw new AuthRequestError(res.status, `Login failed (${res.status})`);
  const body: unknown = await res.json().catch(() => null);
  if (!isMeResponse(body)) throw new AuthRequestError(res.status, 'Unexpected login response');
  return normalizeMe(body);
}

export async function logout(): Promise<void> {
  const res = await post('/logout');
  if (!res.ok && res.status !== 401) throw new AuthRequestError(res.status, `Logout failed (${res.status})`);
}

let inflightRefresh: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  try {
    const res = await post('/refresh');
    return res.ok;
  } catch {
    return false;
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
