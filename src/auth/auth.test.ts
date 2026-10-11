import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getMe, loginTelegram, parseMeResponse, refreshSession, AuthUnavailableError, REFRESH_TIMEOUT_MS } from './api';
import { isAppLocked, useAuth } from './useAuth';
import { sanitizeReturnUrl } from './returnUrl';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Exactly what mvv42-auth serialises (`MeResponse(MeUser? User, IReadOnlyList<MeApp> Apps)`,
 * `MeUser(long Id, long TelegramId, string Name, string? Username, string? PhotoUrl, bool IsAdmin)`,
 * `MeApp(string Id, bool Anonymous, string Access, bool Granted)`, camelCase): ids are JSON numbers.
 */
const BACKEND_ME_AUTHED = {
  user: { id: 7, telegramId: 123456789, name: 'Max V', username: null, photoUrl: null, isAdmin: false },
  apps: [
    { id: 'cashpulse', anonymous: false, access: 'public', granted: true },
    { id: 'credit_calc', anonymous: true, access: 'public', granted: true },
    { id: 'bonds', anonymous: false, access: 'admin', granted: false },
  ],
};
const BACKEND_ME_ANON = {
  user: null,
  apps: [
    { id: 'cashpulse', anonymous: false, access: 'public', granted: false },
    { id: 'credit_calc', anonymous: true, access: 'public', granted: false },
    { id: 'bonds', anonymous: false, access: 'admin', granted: false },
  ],
};

describe('parseMeResponse (backend shape)', () => {
  it('accepts numeric ids and normalises them to strings', () => {
    const me = parseMeResponse(BACKEND_ME_AUTHED);
    expect(me?.user).toEqual({
      id: '7',
      telegramId: '123456789',
      name: 'Max V',
      username: null,
      photoUrl: null,
      isAdmin: false,
    });
    expect(me?.apps).toEqual(BACKEND_ME_AUTHED.apps);
  });

  it('accepts string ids and non-null optional fields', () => {
    const me = parseMeResponse({
      user: { id: '7', telegramId: '42', name: 'M', username: 'max', photoUrl: 'https://t.me/i/u.jpg', isAdmin: true },
      apps: [],
    });
    expect(me?.user).toMatchObject({ id: '7', telegramId: '42', username: 'max', isAdmin: true });
  });

  it('accepts the anonymous shape', () => {
    expect(parseMeResponse(BACKEND_ME_ANON)).toEqual(BACKEND_ME_ANON);
  });

  it.each([
    ['missing apps', { user: null }],
    ['user id missing', { user: { telegramId: 1, name: 'x', username: null, photoUrl: null, isAdmin: false }, apps: [] }],
    ['user id boolean', { user: { ...BACKEND_ME_AUTHED.user, id: true }, apps: [] }],
    ['name not a string', { user: { ...BACKEND_ME_AUTHED.user, name: 5 }, apps: [] }],
    ['isAdmin missing', { user: { ...BACKEND_ME_AUTHED.user, isAdmin: undefined }, apps: [] }],
    ['app granted missing', { user: null, apps: [{ id: 'a', anonymous: true, access: 'public' }] }],
    ['array body', []],
  ])('rejects %s', (_label, body) => {
    expect(parseMeResponse(body)).toBeNull();
  });
});

describe('loginTelegram', () => {
  it('parses the backend /telegram body (same as /me)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(BACKEND_ME_AUTHED)));
    const me = await loginTelegram({ id: 123456789, first_name: 'Max', auth_date: 1, hash: 'h' });
    expect(me.user?.id).toBe('7');
    expect(me.user?.telegramId).toBe('123456789');
  });
});

describe('getMe', () => {
  it('maps 404 to AuthUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    await expect(getMe()).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it('treats an HTML SPA fallback with 200 as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html>', { status: 200 })));
    await expect(getMe()).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it('accepts the exact backend payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(BACKEND_ME_AUTHED)));
    const me = await getMe();
    expect(me.user?.id).toBe('7');
  });

  it('sends same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user: null, apps: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await getMe();
    expect(fetchMock).toHaveBeenCalledWith('/auth/api/me', expect.objectContaining({ credentials: 'same-origin' }));
  });
});

describe('useAuth', () => {
  it('maps 404 → unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.user).toBeNull();
  });

  it('maps network errors → unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
  });

  it('maps user:null → anonymous, user → authenticated', async () => {
    const apps = [{ id: 'bonds', anonymous: false, access: 'admin', granted: false }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ user: null, apps })));
    const anon = renderHook(() => useAuth());
    await waitFor(() => expect(anon.result.current.status).toBe('anonymous'));
    expect(anon.result.current.apps).toEqual(apps);

    const user = { id: 11, telegramId: 42, name: 'Max', username: 'max', photoUrl: null, isAdmin: true };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ user, apps })));
    const authed = renderHook(() => useAuth());
    await waitFor(() => expect(authed.result.current.status).toBe('authenticated'));
    expect(authed.result.current.user).toEqual({ ...user, id: '11', telegramId: '42' });
  });
});

describe('isAppLocked', () => {
  const apps = [
    { id: 'open', anonymous: true, access: 'admin' as const, granted: false },
    { id: 'closed', anonymous: false, access: 'invite' as const, granted: false },
    { id: 'mine', anonymous: false, access: 'invite' as const, granted: true },
  ];
  it('never locks when auth is unavailable or loading', () => {
    expect(isAppLocked('unavailable', apps, 'closed')).toBe(false);
    expect(isAppLocked('loading', apps, 'closed')).toBe(false);
  });
  it('locks only !anonymous && !granted', () => {
    expect(isAppLocked('anonymous', apps, 'open')).toBe(false);
    expect(isAppLocked('anonymous', apps, 'closed')).toBe(true);
    expect(isAppLocked('authenticated', apps, 'mine')).toBe(false);
    expect(isAppLocked('authenticated', apps, 'unknown')).toBe(false);
  });
});

describe('refreshSession', () => {
  it('single-flights concurrent refreshes without navigator.locks', async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal('fetch', fetchMock);
    const a = refreshSession();
    const b = refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(new Response(null, { status: 200 }));
    expect(await a).toBe(true);
    expect(await b).toBe(true);
  });

  it('runs under the mvv42-refresh Web Lock when available', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<boolean>) => cb());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    expect(await refreshSession()).toBe(false);
    expect(request).toHaveBeenCalledWith('mvv42-refresh', expect.any(Function));
  });
});

describe('refreshSession timeout', () => {
  it('aborts a hung refresh after the timeout so the lock is released', async () => {
    vi.useFakeTimers();
    // Exercise the setTimeout fallback (engines without AbortSignal.timeout).
    const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
    onTestFinished(() => {
      if (original) Object.defineProperty(AbortSignal, 'timeout', original);
      vi.useRealTimers();
    });
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = refreshSession();
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(await result).toBe(false);
  });

  it('passes an AbortSignal to the refresh request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshSession()).toBe(true);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('sanitizeReturnUrl', () => {
  const origin = 'https://mvv42.ru';
  it.each([
    ['/cashpulse/operations', '/cashpulse/operations'],
    ['/bonds/?x=1#y', '/bonds/?x=1#y'],
    ['https://mvv42.ru/credit_calc/', '/credit_calc/'],
    ['/', '/'],
  ])('accepts %s', (input, expected) => {
    expect(sanitizeReturnUrl(input, origin)).toBe(expected);
  });

  it.each([
    null,
    '',
    '//evil.com/x',
    '/\\evil.com',
    '\\\\evil.com',
    'https://evil.com/',
    'javascript:alert(1)',
    'https://mvv42.ru//evil.com',
    'http://mvv42.ru/',
  ])('rejects %s', (input) => {
    expect(sanitizeReturnUrl(input, origin)).toBe('/');
  });
});
