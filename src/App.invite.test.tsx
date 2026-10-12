/**
 * Closed registration + code-first login (specs 2026-10-12): the login modal steps, `/invites/check`, `X-Invite-Code`,
 * the device marker and the `?invite=` link flow together.
 */
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
    { id: 'bonds', name: 'Bond Analytics', description: '', icon: 'chart-candle', path: '/bonds/', color: '#7048e8', auth: 'shared' },
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
const MARKER = 'mvv42-has-account';

beforeEach(() => {
  stubDom();
  sessionStorage.clear();
  localStorage.clear();
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

const codeField = () => screen.getByLabelText('Код приглашения') as HTMLInputElement;
const inviteHeader = (c: RecordedCall) => c.headers.get('X-Invite-Code');
const telegramScripts = () => document.querySelectorAll('script[src*="telegram-widget"]');
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

describe('code-first login in the shell', () => {
  it('new user from a link: A auto-checks the code (no Telegram yet) → B → X-Invite-Code; `invite` → no redeem', async () => {
    history.replaceState(null, '', '/?invite=K7PM-2XQ9-HD4T');
    let releaseCheck: () => void = () => {};
    const checkGate = new Promise<void>((r) => (releaseCheck = r));
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/invites/check': async () => {
        await checkGate;
        return { valid: true, appId: 'bonds' };
      },
      'POST /auth/api/telegram': () => ({ ...SIGNED_IN, invite: { appId: 'bonds' } }),
      'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: true, me: SIGNED_IN }),
    });
    renderWithKit(<App />);
    await screen.findByText('Вход только по приглашению');
    expect(codeField().value).toBe('K7PM-2XQ9-HD4T');
    await waitFor(() => expect(find('POST', '/auth/api/invites/check')).toHaveLength(1));
    expect(find('POST', '/auth/api/invites/check')[0].body).toEqual({ code: 'K7PM2XQ9HD4T' });
    // While the check runs: still A, nothing from Telegram in the page.
    expect(telegramScripts()).toHaveLength(0);
    releaseCheck();
    expect(await screen.findByText('Код даёт доступ к «Bond Analytics»')).toBeTruthy();
    expect(telegramScripts()).toHaveLength(1);

    clickTelegram();
    expect(await screen.findByText('Доступ к «Bond Analytics» открыт')).toBeTruthy();
    const [login] = find('POST', '/auth/api/telegram');
    expect(inviteHeader(login)).toBe('K7PM2XQ9HD4T');
    expect(login.body).toEqual(PAYLOAD);
    // Post-login target: the invite's service (decision 9).
    await waitFor(() => expect(window.location.hash).toBe('#/bonds'));
    expect(sessionStorage.getItem('mvv42-invite')).toBeNull();
    expect(localStorage.getItem(MARKER)).toBe('1');
    await settle();
    expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(0);
    expect(find('POST', '/auth/api/invites/check')).toHaveLength(1);
  });

  it('existing user from a link (no `invite` in the answer): exactly one redeem', async () => {
    history.replaceState(null, '', '/?invite=K7PM-2XQ9-HD4T');
    localStorage.setItem(MARKER, '1');
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/invites/check': () => ({ valid: true, appId: 'bonds' }),
      'POST /auth/api/telegram': () => SIGNED_IN,
      'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: false, me: SIGNED_IN }),
    });
    renderWithKit(<App />);
    // The pending invite wins over the marker (decision 1).
    await screen.findByText('Код даёт доступ к «Bond Analytics»');
    clickTelegram();
    expect(await screen.findByText('Доступ к «Bond Analytics» открыт')).toBeTruthy();
    await settle();
    expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(1);
    expect(find('POST', '/auth/api/invites/redeem')[0].body).toEqual({ code: 'K7PM-2XQ9-HD4T' });
  });

  it('marker → C; invite_required → marker cleared, A; a checked code resends the same payload automatically', async () => {
    localStorage.setItem(MARKER, '1');
    let n = 0;
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/invites/check': () => ({ valid: true, appId: null }),
      'POST /auth/api/telegram': (call) =>
        ++n === 1 && !inviteHeader(call) ? json({ error: 'invite_required' }, 403) : { ...SIGNED_IN, invite: { appId: null } },
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Если аккаунта нет, вход не выполнится и данные не сохранятся.');
    clickTelegram();
    expect(await screen.findByText('Аккаунт не найден. Нужен код приглашения')).toBeTruthy();
    expect(localStorage.getItem(MARKER)).toBeNull();
    expect(inviteHeader(find('POST', '/auth/api/telegram')[0])).toBeNull();
    expect(telegramScripts()).toHaveLength(0);

    fireEvent.change(codeField(), { target: { value: 'авек-мнор-стх2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(await screen.findByText('Добро пожаловать')).toBeTruthy();
    const second = find('POST', '/auth/api/telegram')[1];
    expect(second.body).toEqual(PAYLOAD);
    expect(inviteHeader(second)).toBe('ABEKMH0PCTX2');
    expect(await screen.findByRole('button', { name: /^Аккаунт/ })).toBeTruthy();
    expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(0);
    expect(sessionStorage.getItem('mvv42-invite-draft')).toBeNull();
    expect(localStorage.getItem(MARKER)).toBe('1');
  });

  it('B: invite_expired from /telegram → A with the code and the error; re-check → B and an automatic resend', async () => {
    let n = 0;
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/invites/check': () => ({ valid: true, appId: null }),
      'POST /auth/api/telegram': () => (++n === 1 ? json({ error: 'invite_expired' }, 400) : { ...SIGNED_IN, invite: { appId: null } }),
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Вход только по приглашению');
    fireEvent.change(codeField(), { target: { value: 'K7PM-2XQ9-HD4T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await screen.findByText('Код для входа');
    clickTelegram();
    expect(await screen.findByText('Срок действия кода истёк')).toBeTruthy();
    expect(codeField().value).toBe('K7PM-2XQ9-HD4T');
    expect(telegramScripts()).toHaveLength(0);

    fireEvent.change(codeField(), { target: { value: 'ABCD-EFGH-JKMN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(await screen.findByText('Добро пожаловать')).toBeTruthy();
    const calls = find('POST', '/auth/api/telegram');
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual(PAYLOAD);
    expect(inviteHeader(calls[1])).toBe('ABCDEFGHJKMN');
  });

  it('429 on the check (nginx HTML) → the rate-limit text', async () => {
    mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/invites/check': () =>
        new Response('<html><body>429 Too Many Requests</body></html>', { status: 429, headers: { 'Content-Type': 'text/html' } }),
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Вход только по приглашению');
    fireEvent.change(codeField(), { target: { value: 'K7PM-2XQ9-HD4T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(await screen.findByText('Слишком много попыток — повторите через минуту')).toBeTruthy();
    expect(telegramScripts()).toHaveLength(0);
  });

  it('a draft typed before a reload is checked automatically and cleared after a successful login', async () => {
    sessionStorage.setItem('mvv42-invite-draft', 'k7pm 2xq9 hd4t');
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/invites/check': () => ({ valid: true, appId: null }),
      'POST /auth/api/telegram': () => ({ ...SIGNED_IN, invite: { appId: null } }),
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Код для входа');
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
      'POST /auth/api/invites/check': () => ({ valid: true, appId: 'bonds' }),
      'POST /auth/api/telegram': () => SIGNED_IN,
      'POST /auth/api/invites/redeem': () => ({ appId: 'bonds', alreadyGranted: true, me: SIGNED_IN }),
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    await screen.findByText('Вход только по приглашению');
    fireEvent.change(codeField(), { target: { value: 'K7PM-2XQ9-HD4T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await screen.findByText('Код принят');
    clickTelegram();
    await waitFor(() => expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(1));
    expect(find('POST', '/auth/api/invites/redeem')[0].body).toEqual({ code: 'K7PM2XQ9HD4T' });
    await settle();
    expect(screen.queryByText(/доступ к «Bond Analytics» (открыт|уже есть)/i)).toBeNull();
    expect(window.location.hash).not.toBe('#/bonds');
  });

  it('locked service: subtitle «Чтобы открыть …, войдите» over the fixed A text; it opens after sign-in', async () => {
    localStorage.setItem(MARKER, '1');
    mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/telegram': () => SIGNED_IN,
    });
    renderWithKit(<App />);
    const tile = (await screen.findByRole('heading', { name: 'Bond Analytics' })).closest('a') as HTMLAnchorElement;
    fireEvent.click(tile);
    expect(await screen.findByText('Чтобы открыть «Bond Analytics», войдите')).toBeTruthy();
    clickTelegram();
    await waitFor(() => expect(window.location.hash).toBe('#/bonds'));
  });

  it('a signed-in /me on boot sets the marker; sign-out keeps it', async () => {
    let signedIn = true;
    mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => (signedIn ? SIGNED_IN : ANON),
      'POST /auth/api/logout': () => {
        signedIn = false;
        return new Response(null, { status: 204 });
      },
    });
    renderWithKit(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Аккаунт/ }));
    expect(localStorage.getItem(MARKER)).toBe('1');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Выйти' }));
    expect(await screen.findByRole('button', { name: 'Войти' })).toBeTruthy();
    expect(localStorage.getItem(MARKER)).toBe('1');
    // Next sign-in opens straight on C.
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Если аккаунта нет, вход не выполнится и данные не сохранятся.')).toBeTruthy();
  });

  it('invite registration with an app wins over ?login=1&return= (decision 9)', async () => {
    history.replaceState(null, '', '/?login=1&return=/cashpulse/');
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace, href: window.location.href, search: window.location.search });
    mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => ANON,
      'POST /auth/api/invites/check': () => ({ valid: true, appId: 'bonds' }),
      'POST /auth/api/telegram': () => ({ ...SIGNED_IN, invite: { appId: 'bonds' } }),
    });
    renderWithKit(<App />);
    await screen.findByText('Вход только по приглашению');
    fireEvent.change(codeField(), { target: { value: 'K7PM-2XQ9-HD4T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await screen.findByText('Код даёт доступ к «Bond Analytics»');
    clickTelegram();
    expect(await screen.findByText('Доступ к «Bond Analytics» открыт')).toBeTruthy();
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('no Telegram on step A, whatever opens the modal', () => {
  it('?login=1 (standalone app asks for sign-in) → A without the widget script', async () => {
    history.replaceState(null, '', '/?login=1&return=/bonds/');
    mockFetch({ 'GET /registry.json': () => REGISTRY, 'GET /auth/api/me': () => ANON });
    renderWithKit(<App />);
    expect(await screen.findByText('Вход только по приглашению')).toBeTruthy();
    await settle();
    expect(telegramScripts()).toHaveLength(0);
    expect(document.querySelector('iframe[id^="telegram-login"]')).toBeNull();
  });

  it('AUTH_REQUIRED from a service with the session gone → A without the widget script', async () => {
    let signedIn = true;
    mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => (signedIn ? SIGNED_IN : ANON),
      'POST /auth/api/refresh': () => json({ error: 'invalid_refresh' }, 401),
    });
    history.replaceState(null, '', '/#/bonds');
    renderWithKit(<App />);
    await waitFor(() => expect(document.querySelector('iframe[src="/bonds/"]')).not.toBeNull());
    const frame = document.querySelector('iframe[src="/bonds/"]') as HTMLIFrameElement;
    signedIn = false;
    // The signed-in /me set the device marker (→ C); without it the modal must open on A.
    await waitFor(() => expect(localStorage.getItem(MARKER)).toBe('1'));
    localStorage.removeItem(MARKER);
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'AUTH_REQUIRED', serviceId: 'bonds' },
          origin: window.location.origin,
          source: frame.contentWindow,
        }),
      );
    });
    expect(await screen.findByText('Вход только по приглашению')).toBeTruthy();
    await settle();
    expect(telegramScripts()).toHaveLength(0);
  });
});
