import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@mvv42/kit/platform';
import { json, mockFetch, noContent } from '../test/utils';
import { adminApi, inviteLink } from './api';
import { errorText } from './format';

afterEach(() => {
  vi.unstubAllGlobals();
});

const USER = {
  id: 2,
  telegramId: 512300441,
  name: 'Анна',
  username: 'anna',
  photoUrl: null,
  isAdmin: false,
  isOwner: false,
  isBlocked: false,
  blockedAt: null,
  createdAt: '2026-09-01T10:00:00Z',
  lastLoginAt: null,
  activeSessions: 1,
  grants: ['bonds'],
};

describe('adminApi (contract addendum A)', () => {
  it.each([
    ['overview', () => adminApi.overview(), 'GET', '/auth/api/admin/overview', undefined],
    ['users', () => adminApi.users(), 'GET', '/auth/api/admin/users', undefined],
    ['user', () => adminApi.user(2), 'GET', '/auth/api/admin/users/2', undefined],
    ['setAdmin', () => adminApi.setAdmin(2, true), 'PUT', '/auth/api/admin/users/2/admin', { isAdmin: true }],
    ['setBlocked', () => adminApi.setBlocked(2, false), 'PUT', '/auth/api/admin/users/2/blocked', { blocked: false }],
    ['revokeSessions', () => adminApi.revokeSessions(2), 'POST', '/auth/api/admin/users/2/revoke-sessions', undefined],
    ['revokeSession', () => adminApi.revokeSession(41), 'DELETE', '/auth/api/admin/sessions/41', undefined],
    ['logins default', () => adminApi.logins(), 'GET', '/auth/api/admin/logins', undefined],
    ['logins paged', () => adminApi.logins({ limit: 50, before: 115 }), 'GET', '/auth/api/admin/logins?limit=50&before=115', undefined],
    ['logins null before', () => adminApi.logins({ limit: 50, before: null }), 'GET', '/auth/api/admin/logins?limit=50', undefined],
    ['apps', () => adminApi.apps(), 'GET', '/auth/api/admin/apps', undefined],
    [
      'saveApp',
      () => adminApi.saveApp('bonds', { name: 'Bonds', anonymous: false, access: 'invite' }),
      'PUT',
      '/auth/api/admin/apps/bonds',
      { name: 'Bonds', anonymous: false, access: 'invite' },
    ],
    ['deleteApp', () => adminApi.deleteApp('x'), 'DELETE', '/auth/api/admin/apps/x', undefined],
    ['grants all', () => adminApi.grants(), 'GET', '/auth/api/admin/grants', undefined],
    ['grants by user', () => adminApi.grants(2), 'GET', '/auth/api/admin/grants?userId=2', undefined],
    ['grant', () => adminApi.grant(2, 'bonds'), 'POST', '/auth/api/admin/grants', { userId: 2, appId: 'bonds' }],
    ['revokeGrant', () => adminApi.revokeGrant(2, 'credit_calc'), 'DELETE', '/auth/api/admin/grants/2/credit_calc', undefined],
    ['invites', () => adminApi.invites(), 'GET', '/auth/api/admin/invites', undefined],
    [
      'createInvite defaults',
      () => adminApi.createInvite({ appId: 'bonds' }),
      'POST',
      '/auth/api/admin/invites',
      { appId: 'bonds', maxUses: 1, expiresInHours: 168 },
    ],
    [
      'createInvite custom',
      () => adminApi.createInvite({ appId: 'bonds', maxUses: 5, expiresInHours: 24 }),
      'POST',
      '/auth/api/admin/invites',
      { appId: 'bonds', maxUses: 5, expiresInHours: 24 },
    ],
    [
      'createInvite login-only',
      () => adminApi.createInvite({ appId: null }),
      'POST',
      '/auth/api/admin/invites',
      { appId: null, maxUses: 1, expiresInHours: 168 },
    ],
    ['deleteInvite', () => adminApi.deleteInvite(7), 'DELETE', '/auth/api/admin/invites/7', undefined],
  ])('%s → %s %s', async (_name, call, method, path, body) => {
    const { calls } = mockFetch({ [`${method} ${path}`]: () => (method === 'GET' ? json([]) : noContent()) });
    await call();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe(method);
    expect(calls[0].path).toBe(path);
    expect(calls[0].body).toEqual(body);
    if (body !== undefined) expect(calls[0].headers.get('Content-Type')).toBe('application/json');
  });

  it('sends cookies same-origin and resolves undefined for 204', async () => {
    const { fetchMock } = mockFetch({ 'PUT /auth/api/admin/users/2/admin': () => noContent() });
    await expect(adminApi.setAdmin(2, false)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', method: 'PUT' });
  });

  it('returns typed bodies', async () => {
    mockFetch({
      'GET /auth/api/admin/users/2': () => ({ user: USER, sessions: [], logins: [] }),
      'GET /auth/api/admin/logins?limit=2': () => ({ items: [], nextBefore: null }),
    });
    const detail = await adminApi.user(2);
    expect(detail.user.grants).toEqual(['bonds']);
    expect((await adminApi.logins({ limit: 2 })).nextBefore).toBeNull();
  });

  it.each([
    ['PUT /auth/api/admin/users/1/blocked', () => adminApi.setBlocked(1, true), 400, 'cannot_block_owner', 'Владельца нельзя заблокировать'],
    ['PUT /auth/api/admin/users/1/admin', () => adminApi.setAdmin(1, false), 400, 'cannot_change_owner', 'Права владельца не меняются'],
    ['GET /auth/api/admin/users/9', () => adminApi.user(9), 404, 'user_not_found', 'Пользователь не найден'],
    ['DELETE /auth/api/admin/sessions/9', () => adminApi.revokeSession(9), 404, 'session_not_found', 'Сессия не найдена'],
    ['DELETE /auth/api/admin/invites/9', () => adminApi.deleteInvite(9), 404, 'invite_not_found', 'Инвайт не найден'],
    ['GET /auth/api/admin/logins?limit=0', () => adminApi.logins({ limit: 0 }), 400, 'invalid_limit', 'Неверный размер страницы'],
    ['GET /auth/api/admin/logins?before=-1', () => adminApi.logins({ before: -1 }), 400, 'invalid_before', 'Неверная позиция журнала'],
  ])('%s → ApiError %s', async (route, call, status, code, text) => {
    mockFetch({ [route]: () => json({ error: code }, status) });
    const error = await call().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
    expect(errorText(error)).toBe(text);
  });

  it('403 with an empty body (not the owner) is an ApiError without code', async () => {
    mockFetch({ 'GET /auth/api/admin/users': () => new Response('', { status: 403 }) });
    const error = await adminApi.users().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 403, code: null });
    expect(errorText(error)).toBe('Нет доступа');
  });

  it('401 refreshes once and retries', async () => {
    let n = 0;
    const { calls } = mockFetch({
      'GET /auth/api/admin/overview': () => (n++ === 0 ? new Response('', { status: 401 }) : json({ users: 1 })),
      'POST /auth/api/refresh': () => noContent(),
    });
    await expect(adminApi.overview()).resolves.toMatchObject({ users: 1 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /auth/api/admin/overview',
      'POST /auth/api/refresh',
      'GET /auth/api/admin/overview',
    ]);
  });

  it('builds the invite link on the shell origin', () => {
    expect(inviteLink('kQ7v_x-9', 'https://mvv42.ru')).toBe('https://mvv42.ru/?invite=kQ7v_x-9');
  });
});
