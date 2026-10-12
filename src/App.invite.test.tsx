/** Closed registration (spec 2026-10-12): the login modal, `X-Invite-Code` and the `?invite=` link flow together. */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { json, mockFetch, renderWithKit, resetNotifications, stubDom, type RecordedCall } from './test/utils';
import type { TelegramAuthData } from './auth/api';
import App from './App';

const REGISTRY = {
  version: 1,
  services: [
    { id: 'cashpulse', name: 'CashPulse', description: '', icon: 'chart-area-line', path: '/cashpulse/', color: '#228be6' },
    { id: 'bonds', name: 'Bond Analytics', description: '', icon: 'chart-candle', path: '/bonds/', color: '#7048e8' },
  ],
};
const APPS = [
  { id: 'cashpulse', anonymous: false, access: 'public', granted: true },
  { id: 'bonds', anonymous: false, access: 'invite', granted: false },
];
const ANON = { user: null, apps: APPS };
const USER = { id: 5, telegramId: 4242, name: 'Аня', username: null, photoUrl: null, isAdmin: false, isOwner: false };
const SIGNED_IN = { user: USER, apps: APPS.map((a) => ({ ...a, granted: true })) };
const PAYLOAD: TelegramAuthData = { id: 4242, first_name: 'Аня', auth_date: 1_760_000_000, hash: 'abc' };

beforeEach(() => {
  stubDom();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  act(() => resetNotifications());
  vi.unstubAllGlobals();
});

function clickTelegram(payload: TelegramAuthData = PAYLOAD) {
  const cb = window.__mvv42OnTelegramAuth;
  if (!cb) throw new Error('widget callback not registered');
  act(() => cb(payload));
}

const codeField = () => screen.getByLabelText('Код приглашения (для новых пользователей)') as HTMLInputElement;
const inviteHeader = (c: RecordedCall) => c.headers.get('X-Invite-Code');

describe('invite link + closed registration', () => {
  it('new user from a link: code prefilled, sent as X-Invite-Code; `invite` in the answer → no second redeem', async () => {
    history.replaceState(null, '', '/?invite=K7PM-2XQ9-HD4T');
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/telegram': () => ({ ...SIGNED_IN, invite: { appId: 'bonds' } }),
      'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: true, me: SIGNED_IN }),
    });
    renderWithKit(<App />);
    expect(await screen.findByText('Войдите, чтобы принять приглашение.')).toBeTruthy();
    expect(codeField().value).toBe('K7PM-2XQ9-HD4T');
    clickTelegram();
    expect(await screen.findByText('Доступ к «Bond Analytics» открыт')).toBeTruthy();
    const [login] = find('POST', '/auth/api/telegram');
    expect(inviteHeader(login)).toBe('K7PM2XQ9HD4T');
    expect(login.body).toEqual(PAYLOAD);
    await waitFor(() => expect(window.location.hash).toBe('#/bonds'));
    expect(sessionStorage.getItem('mvv42-invite')).toBeNull();
    // Give the invite flow a chance to (wrongly) redeem the consumed code.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(0);
  });

  it('existing user from a link (no `invite` in the answer): exactly one redeem', async () => {
    history.replaceState(null, '', '/?invite=K7PM-2XQ9-HD4T');
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/telegram': () => SIGNED_IN,
      'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: false, me: SIGNED_IN }),
    });
    renderWithKit(<App />);
    await screen.findByText('Войдите, чтобы принять приглашение.');
    clickTelegram();
    expect(await screen.findByText('Доступ к «Bond Analytics» открыт')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(1);
    expect(find('POST', '/auth/api/invites/redeem')[0].body).toEqual({ code: 'K7PM-2XQ9-HD4T' });
  });

  it('invite_required → code typed → «Продолжить» resends the same payload with the header → «Добро пожаловать»', async () => {
    let n = 0;
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/telegram': (call) =>
        ++n === 1 && !inviteHeader(call) ? json({ error: 'invite_required' }, 403) : { ...SIGNED_IN, invite: { appId: null } },
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Вход только по приглашению');
    clickTelegram();
    expect(await screen.findByText(/Новым пользователям нужен код приглашения/)).toBeTruthy();
    expect(inviteHeader(find('POST', '/auth/api/telegram')[0])).toBeNull();
    fireEvent.change(codeField(), { target: { value: 'авек-мнор-стх2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(await screen.findByText('Добро пожаловать')).toBeTruthy();
    const second = find('POST', '/auth/api/telegram')[1];
    expect(second.body).toEqual(PAYLOAD);
    expect(inviteHeader(second)).toBe('ABEKMH0PCTX2');
    expect(await screen.findByRole('button', { name: /^Аккаунт/ })).toBeTruthy();
    expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(0);
    expect(sessionStorage.getItem('mvv42-invite-draft')).toBeNull();
  });

  it('a draft typed before a reload prefills the field and is cleared after a successful login', async () => {
    sessionStorage.setItem('mvv42-invite-draft', 'k7pm 2xq9 hd4t');
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/telegram': () => ({ ...SIGNED_IN, invite: { appId: null } }),
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Вход только по приглашению');
    expect(codeField().value).toBe('k7pm 2xq9 hd4t');
    clickTelegram();
    expect(await screen.findByText('Добро пожаловать')).toBeTruthy();
    expect(inviteHeader(find('POST', '/auth/api/telegram')[0])).toBe('K7PM2XQ9HD4T');
    expect(sessionStorage.getItem('mvv42-invite-draft')).toBeNull();
    expect(sessionStorage.getItem('mvv42-invite')).toBeNull();
    for (const store of [sessionStorage, localStorage])
      for (let i = 0; i < store.length; i++) expect(store.getItem(store.key(i) as string)).not.toContain(PAYLOAD.hash);
  });

  it('known user who typed a code: quiet redeem; «already granted» shows nothing', async () => {
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/telegram': () => SIGNED_IN,
      'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: true, me: SIGNED_IN }),
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Вход только по приглашению');
    fireEvent.change(codeField(), { target: { value: 'K7PM-2XQ9-HD4T' } });
    clickTelegram();
    await waitFor(() => expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(1));
    expect(find('POST', '/auth/api/invites/redeem')[0].body).toEqual({ code: 'K7PM2XQ9HD4T' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText(/доступ к «Bond Analytics»/i)).toBeNull();
    expect(window.location.hash).not.toBe('#/bonds');
  });

  it('known user who typed a code for a new service: grant notice and the service opens', async () => {
    mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/telegram': () => SIGNED_IN,
      'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: false, me: SIGNED_IN }),
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Вход только по приглашению');
    fireEvent.change(codeField(), { target: { value: 'K7PM-2XQ9-HD4T' } });
    clickTelegram();
    expect(await screen.findByText('Доступ к «Bond Analytics» открыт')).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#/bonds'));
  });
});
