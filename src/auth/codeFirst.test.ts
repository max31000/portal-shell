/** Code-first login (spec 2026-10-12-code-first-login): `/invites/check` client and the device marker. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { AuthRequestError, checkInvite } from './api';
import { ACCOUNT_MARKER_KEY, clearAccountMarker, hasAccountMarker, setAccountMarker } from './accountMarker';
import { useAuth } from './useAuth';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('checkInvite', () => {
  it('POSTs the code as JSON and returns the app id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ valid: true, appId: 'bonds' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkInvite('K7PM2XQ9HD4T')).resolves.toEqual({ appId: 'bonds' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/auth/api/invites/check');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'K7PM2XQ9HD4T' });
    // No widget data, no invite header: the check carries nothing but the code.
    expect(new Headers(init.headers).has('X-Invite-Code')).toBe(false);
  });

  it('login-only code: appId null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ valid: true, appId: null })));
    await expect(checkInvite('K7PM2XQ9HD4T')).resolves.toEqual({ appId: null });
  });

  it.each(['invalid_invite_format', 'invite_not_found', 'invite_expired', 'invite_exhausted'])(
    '400 %s → AuthRequestError with that code',
    async (code) => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: code }, 400)));
      const error = await checkInvite('K7PM2XQ9HD4T').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuthRequestError);
      expect((error as AuthRequestError).status).toBe(400);
      expect((error as AuthRequestError).code).toBe(code);
    },
  );

  it('429 from nginx with an HTML body: recognised by status (no code)', async () => {
    const html = '<html><head><title>429 Too Many Requests</title></head><body>nginx</body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 429, headers: { 'Content-Type': 'text/html' } })));
    const error = (await checkInvite('K7PM2XQ9HD4T').catch((e: unknown) => e)) as AuthRequestError;
    expect(error).toBeInstanceOf(AuthRequestError);
    expect(error.status).toBe(429);
    expect(error.code).toBeNull();
  });

  it('an unexpected 200 body is an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ valid: false })));
    await expect(checkInvite('K7PM2XQ9HD4T')).rejects.toBeInstanceOf(AuthRequestError);
  });
});

describe('account marker', () => {
  it('set / read / clear, value is just «1»', () => {
    expect(hasAccountMarker()).toBe(false);
    setAccountMarker();
    expect(localStorage.getItem(ACCOUNT_MARKER_KEY)).toBe('1');
    expect(hasAccountMarker()).toBe(true);
    clearAccountMarker();
    expect(hasAccountMarker()).toBe(false);
  });

  it('only «1» counts', () => {
    localStorage.setItem(ACCOUNT_MARKER_KEY, 'yes');
    expect(hasAccountMarker()).toBe(false);
  });

  it('storage errors → no marker, nothing thrown', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => setAccountMarker()).not.toThrow();
    expect(() => clearAccountMarker()).not.toThrow();
    expect(hasAccountMarker()).toBe(false);
  });

  it('useAuth sets the marker when /me answers with a signed-in user (decision 2)', async () => {
    const user = { id: 7, telegramId: 1, name: 'Max', username: null, photoUrl: null, isAdmin: false, isOwner: false };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ user, apps: [] })));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(localStorage.getItem(ACCOUNT_MARKER_KEY)).toBe('1');
  });

  it('useAuth: anonymous /me sets nothing; sign-out keeps an existing marker', async () => {
    let signedIn = true;
    const user = { id: 7, telegramId: 1, name: 'Max', username: null, photoUrl: null, isAdmin: false, isOwner: false };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/logout')) {
          signedIn = false;
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ user: signedIn ? user : null, apps: [] });
      }),
    );
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    await result.current.logout();
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(localStorage.getItem(ACCOUNT_MARKER_KEY)).toBe('1');

    localStorage.clear();
    const anon = renderHook(() => useAuth());
    await waitFor(() => expect(anon.result.current.status).toBe('anonymous'));
    expect(localStorage.getItem(ACCOUNT_MARKER_KEY)).toBeNull();
  });
});
