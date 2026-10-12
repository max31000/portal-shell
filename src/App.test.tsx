import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { notifications } from '@mantine/notifications';
import { mockFetch, renderWithKit, stubDom } from './test/utils';
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
  act(() => {
    notifications.clean();
    notifications.cleanQueue();
  });
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
