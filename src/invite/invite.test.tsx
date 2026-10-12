import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { json, mockFetch } from '../test/utils';
import type { AuthSnapshot, AuthStatus } from '../auth/useAuth';
import type { Service } from '../types';
import { INVITE_STORAGE_KEY, captureInvite, readPendingInvite } from './invite';
import { INVITE_LOGIN_MESSAGE, useInviteFlow } from './useInviteFlow';

const notices = vi.hoisted(() => [] as { id: string; message: string; tone?: string }[]);
vi.mock('../shell/notice', () => ({
  NO_ACCESS_NOTICE: 'Нет доступа к сервису',
  showNotice: (id: string, message: string, tone?: string) => notices.push({ id, message, tone }),
}));

const BONDS: Service = { id: 'bonds', name: 'Bond Analytics', description: '', icon: 'chart-candle', path: '/bonds/', color: '#7048e8' };
const ME = {
  user: { id: 2, telegramId: 42, name: 'Анна', username: null, photoUrl: null, isAdmin: false, isOwner: false },
  apps: [{ id: 'bonds', anonymous: false, access: 'invite', granted: true }],
};

function setUrl(url: string) {
  history.replaceState(null, '', url);
}

beforeEach(() => {
  notices.length = 0;
  sessionStorage.clear();
  setUrl('/');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('captureInvite', () => {
  it('moves ?invite= into sessionStorage and cleans the URL, keeping other params and the hash', () => {
    setUrl('/?invite=kQ7v_X-9&utm=x#/bonds/positions');
    expect(captureInvite()).toBe('kQ7v_X-9');
    expect(window.location.search).toBe('?utm=x');
    expect(window.location.hash).toBe('#/bonds/positions');
    expect(sessionStorage.getItem(INVITE_STORAGE_KEY)).toBe('kQ7v_X-9');
  });

  it('survives a reload through sessionStorage', () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'abcd1234');
    expect(captureInvite()).toBe('abcd1234');
  });

  it('drops a malformed code from the URL without storing it', () => {
    setUrl('/?invite=%3Cscript%3E');
    expect(captureInvite()).toBeNull();
    expect(window.location.search).toBe('');
    expect(readPendingInvite()).toBeNull();
  });

  it('returns null without an invite', () => {
    expect(captureInvite()).toBeNull();
  });
});

function flow(status: AuthStatus, overrides: Partial<Parameters<typeof useInviteFlow>[0]> = {}) {
  const props = {
    authStatus: status,
    ready: true,
    services: [BONDS],
    requestLogin: vi.fn(),
    applyMe: vi.fn((me) => ({ status: 'authenticated', user: me.user, apps: me.apps }) as AuthSnapshot),
    refreshAuth: vi.fn(async () => ({ status: 'anonymous', user: null, apps: [] }) as AuthSnapshot),
    onAuthChanged: vi.fn(),
    openService: vi.fn(),
    ...overrides,
  };
  const hook = renderHook((p: typeof props) => useInviteFlow(p), { initialProps: props });
  return { props, hook };
}

describe('useInviteFlow', () => {
  it('signed out: asks to sign in once, then redeems after login and opens the service', async () => {
    setUrl('/?invite=code1234');
    const { calls } = mockFetch({
      'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: false, me: ME }),
    });
    const { props, hook } = flow('anonymous');
    expect(props.requestLogin).toHaveBeenCalledWith(INVITE_LOGIN_MESSAGE);
    hook.rerender({ ...props, authStatus: 'anonymous' });
    expect(props.requestLogin).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect(hook.result.current.pending).toBe(true);

    hook.rerender({ ...props, authStatus: 'authenticated' });
    await waitFor(() => expect(props.openService).toHaveBeenCalledWith(BONDS));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/api/invites/redeem', body: { code: 'code1234' } });
    expect(props.applyMe).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 2 }) }));
    expect(props.onAuthChanged).toHaveBeenCalledTimes(1);
    expect(notices.at(-1)?.message).toBe('Доступ к «Bond Analytics» открыт');
    expect(readPendingInvite()).toBeNull();
    expect(hook.result.current.pending).toBe(false);
  });

  it('waits for auth and the registry', () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'code1234');
    const { fetchMock } = mockFetch({});
    const { props, hook } = flow('loading');
    hook.rerender({ ...props, authStatus: 'authenticated', ready: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.requestLogin).not.toHaveBeenCalled();
  });

  it('already granted: says so and does not fail', async () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'code1234');
    mockFetch({ 'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: true, me: ME }) });
    const { props } = flow('authenticated');
    await waitFor(() => expect(props.openService).toHaveBeenCalled());
    expect(notices.at(-1)?.message).toBe('У вас уже есть доступ к «Bond Analytics»');
  });

  it.each([
    ['invite_expired', 'Срок действия приглашения истёк'],
    ['invite_exhausted', 'Приглашение уже использовано'],
    ['invite_not_found', 'Приглашение не найдено — возможно, его удалили'],
  ])('%s: error notice, code dropped, nothing opened', async (code, text) => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'code1234');
    mockFetch({ 'POST /auth/api/invites/redeem': () => json({ error: code }, 400) });
    const { props, hook } = flow('authenticated');
    await waitFor(() => expect(hook.result.current.pending).toBe(false));
    expect(notices.at(-1)).toMatchObject({ message: text, tone: 'error' });
    expect(props.openService).not.toHaveBeenCalled();
    expect(props.onAuthChanged).not.toHaveBeenCalled();
    expect(readPendingInvite()).toBeNull();
  });

  it('401 after refresh: re-reads /me and keeps the code for the login prompt', async () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'code1234');
    mockFetch({
      'POST /auth/api/invites/redeem': () => new Response('', { status: 401 }),
      'POST /auth/api/refresh': () => new Response('', { status: 401 }),
    });
    const { props, hook } = flow('authenticated');
    await waitFor(() => expect(props.refreshAuth).toHaveBeenCalled());
    expect(hook.result.current.pending).toBe(true);
    hook.rerender({ ...props, authStatus: 'anonymous' });
    await waitFor(() => expect(props.requestLogin).toHaveBeenCalledWith(INVITE_LOGIN_MESSAGE));
  });

  it('login-only invite (appId null) for a signed-in user: dropped quietly, nothing opened', async () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'K7PM-2XQ9-HD4T');
    mockFetch({ 'POST /auth/api/invites/redeem': () => ({ appId: null, alreadyGranted: true, me: ME }) });
    const { props, hook } = flow('authenticated');
    await waitFor(() => expect(hook.result.current.pending).toBe(false));
    expect(props.applyMe).toHaveBeenCalled();
    expect(props.openService).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
  });

  it('finish() drops the code without a redeem; adopt() of the same code (other spelling) is a no-op', async () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'K7PM-2XQ9-HD4T');
    const { fetchMock } = mockFetch({});
    const { props, hook } = flow('anonymous');
    act(() => hook.result.current.adopt('k7pm2xq9hd4t'));
    expect(hook.result.current.code).toBe('K7PM-2XQ9-HD4T');
    act(() => hook.result.current.finish());
    hook.rerender({ ...props, authStatus: 'authenticated' });
    expect(hook.result.current.pending).toBe(false);
    expect(readPendingInvite()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auth unavailable: drops the code with a notice', () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'code1234');
    const { hook } = flow('unavailable');
    expect(hook.result.current.pending).toBe(false);
    expect(notices.at(-1)?.tone).toBe('error');
  });

  it('cancel (login modal closed) drops the code', () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'code1234');
    const { hook } = flow('anonymous');
    act(() => hook.result.current.cancel());
    expect(hook.result.current.pending).toBe(false);
    expect(readPendingInvite()).toBeNull();
  });
});
