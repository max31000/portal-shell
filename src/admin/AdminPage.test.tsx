import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { json, mockFetch, noContent, renderWithKit, resetNotifications, stubDom } from '../test/utils';
import type { AuthUser } from '../auth/api';
import type { AuthStatus } from '../auth/useAuth';
import type { Service } from '../types';
import { AdminRoute } from './AdminRoute';
import type { AdminTab } from './route';

const OWNER: AuthUser = {
  id: 1,
  telegramId: 343631124,
  name: 'Макс',
  username: 'max',
  photoUrl: null,
  isAdmin: true,
  isOwner: true,
};

const SERVICES: Service[] = [
  { id: 'cashpulse', name: 'CashPulse', description: '', icon: 'chart-area-line', path: '/cashpulse/', color: '#228be6' },
  { id: 'bonds', name: 'Bond Analytics', description: '', icon: 'chart-candle', path: '/bonds/', color: '#7048e8' },
];

const APPS = [
  { id: 'bonds', name: 'Bond Analytics', anonymous: false, access: 'admin' },
  { id: 'cashpulse', name: 'CashPulse', anonymous: false, access: 'invite' },
];

/**
 * Finds an open Mantine modal by its title. `findByRole('dialog', { name })` computes accessible
 * names for the whole tree on every poll and times out on slow CI runners; a text lookup is cheap.
 */
async function findDialog(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, {}, { timeout: 10000 });
  const dialog = heading.closest<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error(`"${title}" is not inside a dialog`);
  return dialog;
}

function adminUser(over: Record<string, unknown>) {
  return {
    id: 2,
    telegramId: 512300441,
    name: 'Анна Смирнова',
    username: 'anna_s',
    photoUrl: null,
    isAdmin: false,
    isOwner: false,
    isBlocked: false,
    blockedAt: null,
    createdAt: '2026-09-01T10:00:00Z',
    lastLoginAt: '2026-10-11T18:02:00Z',
    activeSessions: 1,
    grants: [] as string[],
    ...over,
  };
}

const ANNA = adminUser({});
const ME_ROW = adminUser({ id: 1, telegramId: 343631124, name: 'Макс', username: 'max', isAdmin: true, isOwner: true });
const SESSION = {
  id: 41,
  createdAt: '2026-10-12T07:40:00Z',
  lastUsedAt: '2026-10-12T08:01:00Z',
  expiresAt: '2026-11-11T07:40:00Z',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36',
  ip: '91.204.12.7',
};
const LOGIN = {
  id: 120,
  at: '2026-10-12T07:40:00Z',
  userId: 2,
  telegramId: 512300441,
  userName: 'Анна Смирнова',
  ip: '91.204.12.7',
  userAgent: null,
  result: 'ok',
};
const OVERVIEW = {
  users: 2,
  activeSessions: 3,
  logins24h: 4,
  logins7d: 17,
  blocked: 1,
  apps: APPS.map((a) => ({ ...a, grantedUsers: 2 })),
};

function Harness({
  status = 'authenticated',
  user = OWNER,
  initial = 'overview',
  onHome = () => {},
}: {
  status?: AuthStatus;
  user?: AuthUser | null;
  initial?: AdminTab;
  onHome?: () => void;
}) {
  const [tab, setTab] = useState<AdminTab>(initial);
  return (
    <AdminRoute authStatus={status} user={user} tab={tab} onTabChange={setTab} services={SERVICES} onHome={onHome} />
  );
}

beforeEach(() => stubDom());
afterEach(() => {
  act(() => resetNotifications());
  vi.unstubAllGlobals();
});

describe('owner gating', () => {
  it('shows a 404 to a signed-in non-owner and never calls the admin API', () => {
    const { fetchMock } = mockFetch({});
    const onHome = vi.fn();
    renderWithKit(<Harness user={{ ...OWNER, isOwner: false }} onHome={onHome} />);
    expect(screen.getByText('Страница не найдена')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'На главную' }));
    expect(onHome).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a 404 to an anonymous visitor and to an admin who is not the owner', () => {
    mockFetch({});
    const { unmount } = renderWithKit(<Harness status="anonymous" user={null} />);
    expect(screen.getByText('Страница не найдена')).toBeTruthy();
    unmount();
    renderWithKit(<Harness user={{ ...OWNER, isOwner: false, isAdmin: true }} />);
    expect(screen.getByText('Страница не найдена')).toBeTruthy();
  });

  it('waits for /me before deciding', () => {
    mockFetch({});
    renderWithKit(<Harness status="loading" user={null} />);
    expect(screen.queryByText('Страница не найдена')).toBeNull();
    expect(screen.queryByText('Админка')).toBeNull();
  });
});

describe('overview', () => {
  it('renders metrics and services for the owner', async () => {
    mockFetch({ 'GET /auth/api/admin/overview': () => OVERVIEW });
    renderWithKit(<Harness />);
    expect(await screen.findByRole('heading', { name: 'Админка' })).toBeTruthy();
    expect(await screen.findByText('17')).toBeTruthy();
    expect(screen.getByText('1 заблокирован')).toBeTruthy();
    expect(screen.getAllByText('Bond Analytics').length).toBeGreaterThan(0);
    // An auth without closed registration has no `deniedUnregistered7d`: no such metric, no crash.
    expect(screen.queryByText('Попыток входа без приглашения (7 дн.)')).toBeNull();
  });

  it('shows sign-in attempts refused for lack of an invite', async () => {
    mockFetch({ 'GET /auth/api/admin/overview': () => ({ ...OVERVIEW, deniedUnregistered7d: 23 }) });
    renderWithKit(<Harness />);
    expect(await screen.findByText('Попыток входа без приглашения (7 дн.)')).toBeTruthy();
    expect(await screen.findByText('23')).toBeTruthy();
  });

  it('shows an error state with retry', async () => {
    let fail = true;
    mockFetch({
      'GET /auth/api/admin/overview': () => (fail ? json({ error: 'boom' }, 500) : OVERVIEW),
    });
    renderWithKit(<Harness />);
    expect(await screen.findByText('Не удалось загрузить обзор')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByText('17')).toBeTruthy();
  });
});

describe('users', () => {
  function usersRoutes(extra: Record<string, () => unknown> = {}) {
    let anna = { ...ANNA };
    const routes = {
      'GET /auth/api/admin/users': () => [ME_ROW, anna],
      'GET /auth/api/admin/apps': () => APPS,
      'GET /auth/api/admin/users/2': () => ({ user: anna, sessions: [SESSION], logins: [LOGIN] }),
      'GET /auth/api/admin/users/1': () => ({ user: ME_ROW, sessions: [], logins: [] }),
      'POST /auth/api/admin/grants': () => {
        anna = { ...anna, grants: ['cashpulse'] };
        return noContent();
      },
      'PUT /auth/api/admin/users/2/blocked': () => {
        anna = { ...anna, isBlocked: true, activeSessions: 0 };
        return noContent();
      },
      'DELETE /auth/api/admin/sessions/41': () => noContent(),
      ...extra,
    };
    return mockFetch(routes);
  }

  async function openAnna() {
    renderWithKit(<Harness initial="users" />);
    fireEvent.click(await screen.findByRole('row', { name: /Анна Смирнова/ }));
    return screen.findByRole('dialog');
  }

  it('lists users and filters by search', async () => {
    usersRoutes();
    renderWithKit(<Harness initial="users" />);
    expect(await screen.findByText('Анна Смирнова')).toBeTruthy();
    expect(screen.getByText('Владелец')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск пользователей' }), { target: { value: '@anna' } });
    expect(screen.queryByText('Макс')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Поиск пользователей' }), { target: { value: 'zzz' } });
    expect(screen.getByText('Никого не нашли')).toBeTruthy();
  });

  it('opens the drawer and grants a service', async () => {
    const { find } = usersRoutes();
    const dialog = await openAnna();
    const toggle = await within(dialog).findByRole('switch', { name: 'Грант: CashPulse' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(find('POST', '/auth/api/admin/grants')).toHaveLength(1));
    expect(find('POST', '/auth/api/admin/grants')[0].body).toEqual({ userId: 2, appId: 'cashpulse' });
    expect(await screen.findByText('Доступ к CashPulse выдан')).toBeTruthy();
    await waitFor(() =>
      expect((within(dialog).getByRole('switch', { name: 'Грант: CashPulse' }) as HTMLInputElement).checked).toBe(true),
    );
    // The list is reloaded too.
    expect(find('GET', '/auth/api/admin/users').length).toBeGreaterThanOrEqual(2);
  });

  it('revokes a grant with DELETE', async () => {
    const { find } = usersRoutes({
      'GET /auth/api/admin/users/2': () => ({ user: { ...ANNA, grants: ['bonds'] }, sessions: [], logins: [] }),
      'DELETE /auth/api/admin/grants/2/bonds': () => noContent(),
    });
    const dialog = await openAnna();
    fireEvent.click(await within(dialog).findByRole('switch', { name: 'Грант: Bond Analytics' }));
    await waitFor(() => expect(find('DELETE', '/auth/api/admin/grants/2/bonds')).toHaveLength(1));
  });

  it('blocks only after confirmation', async () => {
    const { find } = usersRoutes();
    const dialog = await openAnna();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Заблокировать' }));
    const confirm = await screen.findByRole('dialog', { name: 'Заблокировать пользователя?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Заблокировать пользователя?' })).toBeNull());
    expect(find('PUT', '/auth/api/admin/users/2/blocked')).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Заблокировать' }));
    const again = await screen.findByRole('dialog', { name: 'Заблокировать пользователя?' });
    fireEvent.click(within(again).getByRole('button', { name: 'Заблокировать' }));
    await waitFor(() => expect(find('PUT', '/auth/api/admin/users/2/blocked')).toHaveLength(1));
    expect(find('PUT', '/auth/api/admin/users/2/blocked')[0].body).toEqual({ blocked: true });
    expect(await within(dialog).findByRole('button', { name: 'Разблокировать' })).toBeTruthy();
  });

  it('revokes a single session after confirmation', async () => {
    const { find } = usersRoutes();
    const dialog = await openAnna();
    fireEvent.click(await within(dialog).findByRole('button', { name: /Отозвать сессию Chrome/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Отозвать сессию?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отозвать' }));
    await waitFor(() => expect(find('DELETE', '/auth/api/admin/sessions/41')).toHaveLength(1));
    expect(await screen.findByText('Сессия отозвана')).toBeTruthy();
  });

  it('shows a failure notification with the API error', async () => {
    usersRoutes({ 'POST /auth/api/admin/grants': () => json({ error: 'unknown_app' }, 400) });
    const dialog = await openAnna();
    fireEvent.click(await within(dialog).findByRole('switch', { name: 'Грант: CashPulse' }));
    expect(await screen.findByText('Сервис не найден')).toBeTruthy();
  });

  it('locks the admin flag and blocking for the owner', async () => {
    usersRoutes();
    renderWithKit(<Harness initial="users" />);
    fireEvent.click(await screen.findByRole('row', { name: /Макс/ }));
    const dialog = await screen.findByRole('dialog');
    const admin = await within(dialog).findByRole('switch', { name: 'Администратор' });
    expect((admin as HTMLInputElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: 'Заблокировать' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('services', () => {
  it('saves the access mode with PUT /apps/{id}', async () => {
    const { find } = mockFetch({
      'GET /auth/api/admin/overview': () => OVERVIEW,
      'PUT /auth/api/admin/apps/bonds': () => ({ ...APPS[0], anonymous: true }),
    });
    renderWithKit(<Harness initial="apps" />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Bond Analytics: доступен без входа' }));
    await waitFor(() => expect(find('PUT', '/auth/api/admin/apps/bonds')).toHaveLength(1));
    expect(find('PUT', '/auth/api/admin/apps/bonds')[0].body).toEqual({
      name: 'Bond Analytics',
      anonymous: true,
      access: 'admin',
    });
  });
});

describe('invites', () => {
  const INVITES = [
    {
      id: 7,
      appId: 'cashpulse',
      maxUses: 3,
      uses: 1,
      expiresAt: '2026-10-19T07:00:00Z',
      createdBy: 1,
      createdAt: '2026-10-12T07:00:00Z',
      status: 'active',
    },
    { id: 3, appId: 'bonds', maxUses: 1, uses: 1, expiresAt: null, createdBy: null, createdAt: '2026-09-20T07:00:00Z', status: 'exhausted' },
  ];
  const LOGIN_ONLY_INVITE = {
    id: 9,
    appId: null,
    maxUses: 5,
    uses: 2,
    expiresAt: '2026-10-19T07:00:00Z',
    createdBy: 1,
    createdAt: '2026-10-12T08:00:00Z',
    status: 'active',
  };

  it('lists a login-only invite (appId null) as «Только вход» and deletes it', async () => {
    const { find } = mockFetch({
      'GET /auth/api/admin/invites': () => [LOGIN_ONLY_INVITE, ...INVITES],
      'GET /auth/api/admin/apps': () => APPS,
      'DELETE /auth/api/admin/invites/9': () => noContent(),
    });
    renderWithKit(<Harness initial="invites" />);
    expect(await screen.findByText('Только вход')).toBeTruthy();
    expect(screen.getByText('2 / 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить инвайт #9' }));
    const confirm = await screen.findByRole('dialog', { name: 'Удалить инвайт?' });
    expect(within(confirm).getByText(/только вход/)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(find('DELETE', '/auth/api/admin/invites/9')).toHaveLength(1));
  });

  it('creates a login-only invite: appId null, code shown large with copy buttons', async () => {
    // jsdom has no scrollIntoView; the Select dropdown scrolls to the selected option.
    Element.prototype.scrollIntoView = vi.fn();
    const { find } = mockFetch({
      'GET /auth/api/admin/invites': () => INVITES,
      'GET /auth/api/admin/apps': () => APPS,
      'POST /auth/api/admin/invites': () => ({
        id: 10,
        code: 'K7PM-2XQ9-HD4T',
        appId: null,
        maxUses: 1,
        expiresAt: '2026-10-19T08:00:00Z',
      }),
    });
    renderWithKit(<Harness initial="invites" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Создать инвайт' }));
    const dialog = await findDialog('Новый инвайт');
    fireEvent.click(within(dialog).getAllByLabelText('Сервис')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Только вход' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(find('POST', '/auth/api/admin/invites')).toHaveLength(1));
    expect(find('POST', '/auth/api/admin/invites')[0].body).toEqual({ appId: null, maxUses: 1, expiresInHours: 168 });
    expect((await screen.findByTestId('invite-code', {}, { timeout: 5000 })).textContent).toBe('K7PM-2XQ9-HD4T');
    expect(screen.getByTestId('invite-link').textContent).toBe(`${window.location.origin}/?invite=K7PM-2XQ9-HD4T`);
    expect(screen.getByRole('button', { name: 'Копировать код' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Копировать ссылку' })).toBeTruthy();
    expect(screen.getByText(/Только вход · одно использование/)).toBeTruthy();
  });

  it('phones: stacked rows instead of the table, delete still works', async () => {
    stubDom(true); // every media query matches → compact layout
    mockFetch({ 'GET /auth/api/admin/invites': () => [LOGIN_ONLY_INVITE, ...INVITES], 'GET /auth/api/admin/apps': () => APPS });
    renderWithKit(<Harness initial="invites" />);
    const row = await screen.findByTestId('invite-row-9');
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(row).getByText('Только вход')).toBeTruthy();
    expect(within(row).getByText('Активен')).toBeTruthy();
    expect(within(row).getByText(/2 \/ 5 · до/)).toBeTruthy();
    expect(within(screen.getByTestId('invite-row-3')).getByText(/1 \/ 1 · бессрочно/)).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Удалить инвайт #9' })).toBeTruthy();
  });

  it('can create an invite when no services exist (login-only)', async () => {
    mockFetch({ 'GET /auth/api/admin/invites': () => [], 'GET /auth/api/admin/apps': () => [] });
    renderWithKit(<Harness initial="invites" />);
    const button = await screen.findByRole('button', { name: 'Создать инвайт' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it('lists invites with status and handles a non-expiring one', async () => {
    mockFetch({ 'GET /auth/api/admin/invites': () => INVITES, 'GET /auth/api/admin/apps': () => APPS });
    renderWithKit(<Harness initial="invites" />);
    expect(await screen.findByText('Активен')).toBeTruthy();
    expect(screen.getByText('Использован')).toBeTruthy();
    expect(screen.getByText('бессрочно')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('creates an invite and shows the link once', async () => {
    const { find } = mockFetch({
      'GET /auth/api/admin/invites': () => INVITES,
      'GET /auth/api/admin/apps': () => APPS,
      'POST /auth/api/admin/invites': () => ({
        id: 8,
        code: 'kQ7vX2mP9aLr4TzW',
        appId: 'cashpulse',
        maxUses: 1,
        expiresAt: '2026-10-19T08:00:00Z',
      }),
    });
    renderWithKit(<Harness initial="invites" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Создать инвайт' }));
    const dialog = await findDialog('Новый инвайт');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(find('POST', '/auth/api/admin/invites')).toHaveLength(1));
    // Defaults: the invite-mode app, 1 use, 7 days.
    expect(find('POST', '/auth/api/admin/invites')[0].body).toEqual({ appId: 'cashpulse', maxUses: 1, expiresInHours: 168 });
    const link = await screen.findByTestId('invite-link', {}, { timeout: 5000 });
    expect(link.textContent).toBe(`${window.location.origin}/?invite=kQ7vX2mP9aLr4TzW`);
    expect(screen.getByText('Код показывается один раз')).toBeTruthy();
    // A legacy-format code is shown as is.
    expect(screen.getByTestId('invite-code').textContent).toBe('kQ7vX2mP9aLr4TzW');
    expect(screen.getByRole('button', { name: 'Копировать код' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Копировать ссылку' })).toBeTruthy();
    // Not dismissible by Escape / outside click / a close button while the link is shown.
    const created = screen.getByRole('dialog', { name: 'Инвайт создан' });
    fireEvent.keyDown(created, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Инвайт создан' })).toBeTruthy();
    expect(within(created).queryByRole('button', { name: /close|закрыть/i })).toBeNull();
    expect(screen.getByTestId('invite-link')).toBeTruthy();
    // Closing forgets the code; reopening starts a fresh form.
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать инвайт' }));
    await findDialog('Новый инвайт');
    expect(screen.queryByTestId('invite-link')).toBeNull();
    expect(find('GET', '/auth/api/admin/invites').length).toBeGreaterThanOrEqual(2);
  });

  it('deletes after confirmation', async () => {
    const { find } = mockFetch({
      'GET /auth/api/admin/invites': () => INVITES,
      'GET /auth/api/admin/apps': () => APPS,
      'DELETE /auth/api/admin/invites/7': () => noContent(),
    });
    renderWithKit(<Harness initial="invites" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить инвайт #7' }));
    const confirm = await screen.findByRole('dialog', { name: 'Удалить инвайт?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(find('DELETE', '/auth/api/admin/invites/7')).toHaveLength(1));
    expect(await screen.findByText('Инвайт удалён')).toBeTruthy();
  });
});

describe('login journal', () => {
  it('pages with before = nextBefore until it is null', async () => {
    const { find } = mockFetch({
      'GET /auth/api/admin/logins?limit=50': () => ({ items: [LOGIN], nextBefore: 120 }),
      'GET /auth/api/admin/logins?limit=50&before=120': () => ({
        items: [{ ...LOGIN, id: 119, userId: null, telegramId: null, userName: null, result: 'invalid' }],
        nextBefore: null,
      }),
    });
    renderWithKit(<Harness initial="log" />);
    expect(await screen.findByText('Успех')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText('Неверная подпись')).toBeTruthy();
    expect(find('GET', '/auth/api/admin/logins?limit=50&before=120')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
    expect(screen.getByText('не проверен')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    mockFetch({ 'GET /auth/api/admin/logins?limit=50': () => ({ items: [], nextBefore: null }) });
    renderWithKit(<Harness initial="log" />);
    expect(await screen.findByText('Журнал пуст')).toBeTruthy();
  });
});

describe('tabs', () => {
  it('switches sections', async () => {
    mockFetch({
      'GET /auth/api/admin/overview': () => OVERVIEW,
      'GET /auth/api/admin/logins?limit=50': () => ({ items: [], nextBefore: null }),
    });
    renderWithKit(<Harness />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Журнал' }));
    expect(await screen.findByText('Журнал пуст')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Журнал' }).getAttribute('aria-selected')).toBe('true');
  });
});
