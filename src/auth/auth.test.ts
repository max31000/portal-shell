import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getMe, refreshSession, AuthUnavailableError } from './api';
import { isAppLocked, useAuth } from './useAuth';
import { sanitizeReturnUrl } from './returnUrl';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
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

    const user = { id: 'u1', telegramId: '42', name: 'Max', username: 'max', photoUrl: null, isAdmin: true };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ user, apps })));
    const authed = renderHook(() => useAuth());
    await waitFor(() => expect(authed.result.current.status).toBe('authenticated'));
    expect(authed.result.current.user).toEqual(user);
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
