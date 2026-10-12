import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { mockFetch, renderWithKit, resetNotifications, stubDom } from './test/utils';
import App from './App';

const REGISTRY = {
  version: 1,
  services: [
    { id: 'cashpulse', name: 'CashPulse', description: 'Прогноз', icon: 'chart-area-line', path: '/cashpulse/', color: '#228be6' },
    { id: 'bonds', name: 'Bond Analytics', description: 'Облигации', icon: 'chart-candle', path: '/bonds/', color: '#7048e8' },
  ],
};
const APPS = [
  { id: 'cashpulse', anonymous: false, access: 'public', granted: true },
  { id: 'bonds', anonymous: false, access: 'invite', granted: false },
];

function me(isOwner: boolean) {
  return {
    user: { id: 1, telegramId: 343631124, name: 'Макс Водопьянов', username: 'max', photoUrl: null, isAdmin: true, isOwner },
    apps: APPS,
  };
}

function routes(owner: boolean, extra: Record<string, () => unknown> = {}) {
  return mockFetch({
    'GET /registry.json': () => REGISTRY,
    'GET /auth/api/me': () => me(owner),
    'GET /auth/api/admin/overview': () => ({ users: 1, activeSessions: 1, logins24h: 0, logins7d: 0, blocked: 0, apps: [] }),
    ...extra,
  });
}

beforeEach(() => {
  stubDom();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  act(() => resetNotifications());
  vi.unstubAllGlobals();
});

async function openLauncher() {
  fireEvent.click(await screen.findByRole('button', { name: 'Сервисы' }));
  return screen.getByRole('menu', { name: 'Сервисы' });
}

describe('admin entry points', () => {
  it('owner: launcher tile and user-menu item open #/admin', async () => {
    routes(true);
    renderWithKit(<App />);
    await screen.findByRole('button', { name: /^Аккаунт/ });
    const menu = await openLauncher();
    const tile = within(menu).getByRole('menuitem', { name: /Админка/ });
    fireEvent.click(tile);
    expect(window.location.hash).toBe('#/admin');
    expect(await screen.findByRole('heading', { name: 'Админка' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Аккаунт/ }));
    expect(await screen.findByRole('menuitem', { name: 'Админка' })).toBeTruthy();
  });

  it('non-owner: no tile, no menu item, #/admin is a 404', async () => {
    const { calls } = routes(false);
    history.replaceState(null, '', '/#/admin');
    renderWithKit(<App />);
    expect(await screen.findByText('Страница не найдена')).toBeTruthy();
    expect(screen.queryByText('Админка')).toBeNull();
    expect(document.title).toBe('mvv42');
    const menu = await openLauncher();
    expect(within(menu).queryByRole('menuitem', { name: /Админка/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^Аккаунт/ }));
    await screen.findByRole('menuitem', { name: 'Выйти' });
    expect(screen.queryByRole('menuitem', { name: 'Админка' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/auth/api/admin'))).toBe(false);
  });

  it('deep link #/admin/log opens that tab for the owner', async () => {
    routes(true, { 'GET /auth/api/admin/logins?limit=50': () => ({ items: [], nextBefore: null }) });
    history.replaceState(null, '', '/#/admin/log');
    renderWithKit(<App />);
    expect(await screen.findByText('Журнал пуст')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Обзор' }));
    await waitFor(() => expect(window.location.hash).toBe('#/admin'));
  });
});

describe('invite link', () => {
  it('signed in: redeems, notifies and opens the service', async () => {
    history.replaceState(null, '', '/?invite=kQ7vX2mP9aLr4TzW');
    const { find } = routes(false, {
      'POST /auth/api/invites/redeem': () => ({
        appId: 'bonds',
        alreadyGranted: false,
        me: { ...me(false), apps: APPS.map((a) => ({ ...a, granted: true })) },
      }),
    });
    renderWithKit(<App />);
    expect(window.location.search).toBe('');
    await waitFor(() => expect(find('POST', '/auth/api/invites/redeem')).toHaveLength(1));
    expect(find('POST', '/auth/api/invites/redeem')[0].body).toEqual({ code: 'kQ7vX2mP9aLr4TzW' });
    expect(await screen.findByText('Доступ к «Bond Analytics» открыт')).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe('#/bonds'));
  });

  it('signed out: opens sign-in with the invite hint', async () => {
    history.replaceState(null, '', '/?invite=kQ7vX2mP9aLr4TzW');
    mockFetch({ 'GET /registry.json': () => REGISTRY, 'GET /auth/api/me': () => ({ user: null, apps: APPS }) });
    renderWithKit(<App />);
    expect(await screen.findByText('Войдите, чтобы принять приглашение.')).toBeTruthy();
    expect(sessionStorage.getItem('mvv42-invite')).toBe('kQ7vX2mP9aLr4TzW');
  });
});

function goHash(hash: string) {
  act(() => {
    history.pushState(null, '', `/${hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

describe('navigation and auth loss', () => {
  it('back/forward between #/admin/<tab> and a service', async () => {
    routes(true, {
      'GET /auth/api/admin/logins?limit=50': () => ({ items: [], nextBefore: null }),
      'GET /auth/api/admin/users': () => [],
      'GET /auth/api/admin/apps': () => [],
    });
    history.replaceState(null, '', '/#/admin/log');
    renderWithKit(<App />);
    expect(await screen.findByText('Журнал пуст')).toBeTruthy();

    goHash('#/bonds');
    await waitFor(() => expect(document.querySelector('iframe')?.getAttribute('src')).toBe('/bonds/'));
    expect(screen.queryByRole('heading', { name: 'Админка' })).toBeNull();
    expect(document.title).toBe('Bond Analytics · mvv42');

    goHash('#/admin/users');
    expect(await screen.findByText('Пока никто не входил')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Пользователи' }).getAttribute('aria-selected')).toBe('true');
  });

  it('401 inside the console re-reads /me and falls back to sign-in', async () => {
    let meCalls = 0;
    const { find } = mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => (meCalls++ === 0 ? me(true) : { user: null, apps: APPS }),
      'GET /auth/api/admin/overview': () => new Response('', { status: 401 }),
      'POST /auth/api/refresh': () => new Response('', { status: 401 }),
    });
    history.replaceState(null, '', '/#/admin');
    renderWithKit(<App />);
    expect(await screen.findByText('Вход в mvv42')).toBeTruthy();
    expect(find('GET', '/auth/api/me').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('heading', { name: 'Админка' })).toBeNull();
  });

  it('403 inside the console (no longer the owner) shows the 404 view', async () => {
    let meCalls = 0;
    mockFetch({
      'GET /registry.json': () => REGISTRY,
      'GET /auth/api/me': () => me(meCalls++ === 0),
      'GET /auth/api/admin/overview': () => new Response('', { status: 403 }),
    });
    history.replaceState(null, '', '/#/admin');
    renderWithKit(<App />);
    expect(await screen.findByText('Страница не найдена')).toBeTruthy();
  });

  it('hides reserved registry ids', async () => {
    mockFetch({
      'GET /registry.json': () => ({ ...REGISTRY, services: [...REGISTRY.services, { ...REGISTRY.services[0], id: 'admin', name: 'Fake admin' }] }),
      'GET /auth/api/me': () => me(false),
    });
    renderWithKit(<App />);
    expect(await screen.findByText('Bond Analytics')).toBeTruthy();
    expect(screen.queryByText('Fake admin')).toBeNull();
  });
});

describe('invite link and the frame', () => {
  it('redeem posts AUTH_CHANGED to the open service frame', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    history.replaceState(null, '', '/?invite=kQ7vX2mP9aLr4TzW#/cashpulse');
    routes(false, {
      'POST /auth/api/invites/redeem': async () => {
        await gate;
        return { appId: 'nope', alreadyGranted: true, me: me(false) };
      },
    });
    renderWithKit(<App />);
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    release();
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'AUTH_CHANGED' }, window.location.origin));
  });

  it('closing a sign-in opened for another reason keeps the pending invite', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    history.replaceState(null, '', '/?invite=kQ7vX2mP9aLr4TzW');
    mockFetch({
      'GET /registry.json': async () => {
        await gate;
        return REGISTRY;
      },
      'GET /auth/api/me': () => ({ user: null, apps: APPS }),
    });
    renderWithKit(<App />);
    // Registry still loading → the invite flow waits; the visitor opens sign-in on their own.
    fireEvent.click(await screen.findByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Один аккаунт Telegram для всех сервисов.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(sessionStorage.getItem('mvv42-invite')).toBe('kQ7vX2mP9aLr4TzW');
    release();
    expect(await screen.findByText('Войдите, чтобы принять приглашение.')).toBeTruthy();
    // Closing the invite's own prompt drops it.
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(sessionStorage.getItem('mvv42-invite')).toBeNull());
  });
});
