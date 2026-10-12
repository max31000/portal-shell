import { useMemo, useState } from 'react';
import { Badge, Group, Skeleton, Table, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { EmptyState, ErrorState, Section, UserAvatar } from '@mvv42/kit';
import { IconSearch, IconUsers } from '@tabler/icons-react';
import type { Service } from '../types';
import { adminApi, type AdminApp, type AdminUser } from './api';
import { formatDateTime, formatRelative, plural } from './format';
import { UserDrawer } from './UserDrawer';
import { useResource } from './useResource';
import classes from './Admin.module.css';

interface UsersTabProps {
  services: Service[];
  currentUserId?: number;
}

function matches(user: AdminUser, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (!q) return true;
  return (
    user.name.toLowerCase().includes(q) ||
    (user.username ?? '').toLowerCase().includes(q) ||
    String(user.telegramId).includes(q)
  );
}

/** Owner / admin / blocked badges. */
export function UserBadges({ user }: { user: AdminUser }) {
  return (
    <>
      {user.isOwner && <Badge variant="outline" color="gray">Владелец</Badge>}
      {!user.isOwner && user.isAdmin && <Badge color="violet">Админ</Badge>}
      {user.isBlocked && <Badge color="red">Заблокирован</Badge>}
    </>
  );
}

function GrantBadges({ grants, apps }: { grants: string[]; apps: AdminApp[] }) {
  if (grants.length === 0) return <span className={classes.muted}>—</span>;
  return (
    <Group gap={4} wrap="nowrap">
      {grants.map((id) => (
        <Badge key={id} color="gray" variant="light">
          {apps.find((a) => a.id === id)?.name ?? id}
        </Badge>
      ))}
    </Group>
  );
}

async function loadUsers() {
  const [users, apps] = await Promise.all([adminApi.users(), adminApi.apps()]);
  return { users, apps };
}

export function UsersTab({ services, currentUserId }: UsersTabProps) {
  const { data, error, loading, reload } = useResource(loadUsers);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const compact = useMediaQuery('(max-width: 640px)');

  const users = useMemo(() => (data?.users ?? []).filter((u) => matches(u, query)), [data, query]);
  const apps = data?.apps ?? [];

  if (error && !data) return <ErrorState title="Не удалось загрузить пользователей" error={error} onRetry={() => void reload()} />;

  const total = data?.users.length ?? 0;

  let body;
  if (loading) {
    body = (
      <div style={{ padding: 'var(--mvv-sp-5)' }}>
        {[0, 1, 2].map((i) => (
          <Group key={i} gap="sm" mb="md" wrap="nowrap">
            <Skeleton height={32} circle />
            <Skeleton height={12} width="40%" />
          </Group>
        ))}
      </div>
    );
  } else if (total === 0) {
    body = <EmptyState icon={<IconUsers />} title="Пока никто не входил" description="Пользователи появятся после первого входа через Telegram." />;
  } else if (users.length === 0) {
    body = <EmptyState compact icon={<IconSearch />} title="Никого не нашли" description="Поиск идёт по имени, @username и Telegram ID." />;
  } else if (compact) {
    body = (
      <ul className={classes.list}>
        {users.map((u) => (
          <li key={u.id} className={classes.listItem}>
            <button type="button" className={classes.listButton} onClick={() => setOpenId(u.id)}>
              <UserAvatar user={u} size={36} />
              <span className={classes.listMain}>
                <span className={classes.whoText}>
                  <span className={classes.whoName}>
                    {u.name}
                    {u.telegramId === currentUserId && <span className={classes.muted}> · вы</span>}
                  </span>
                  <span className={classes.whoSub}>
                    {u.username ? `@${u.username} · ` : ''}
                    {formatRelative(u.lastLoginAt)}
                  </span>
                </span>
              </span>
              <span className={classes.listMeta}>
                <UserBadges user={u} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <Table className={classes.table}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Пользователь</Table.Th>
            <Table.Th>Telegram ID</Table.Th>
            <Table.Th>Последний вход</Table.Th>
            <Table.Th className={classes.num}>Сессии</Table.Th>
            <Table.Th>Гранты</Table.Th>
            <Table.Th>Статус</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr
              key={u.id}
              className={classes.row}
              tabIndex={0}
              aria-label={`${u.name}: открыть`}
              onClick={() => setOpenId(u.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenId(u.id);
                }
              }}
            >
              <Table.Td>
                <span className={classes.who}>
                  <UserAvatar user={u} size={32} />
                  <span className={classes.whoText}>
                    <span className={classes.whoName}>
                      {u.name}
                      {u.telegramId === currentUserId && <span className={classes.muted}> · вы</span>}
                    </span>
                    <span className={classes.whoSub}>{u.username ? `@${u.username}` : 'без username'}</span>
                  </span>
                </span>
              </Table.Td>
              <Table.Td className={classes.mono}>{u.telegramId}</Table.Td>
              <Table.Td title={formatDateTime(u.lastLoginAt)}>{formatRelative(u.lastLoginAt)}</Table.Td>
              <Table.Td className={classes.num}>{u.activeSessions}</Table.Td>
              <Table.Td>
                <GrantBadges grants={u.grants} apps={apps} />
              </Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  <UserBadges user={u} />
                  {!u.isOwner && !u.isAdmin && !u.isBlocked && <span className={classes.muted}>Активен</span>}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    );
  }

  return (
    <>
      <div className={classes.toolbar}>
        <TextInput
          className={classes.search}
          placeholder="Имя, @username или Telegram ID"
          aria-label="Поиск пользователей"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        {data && (
          <span className={classes.toolbarHint}>
            {total} {plural(total, 'пользователь', 'пользователя', 'пользователей')}
          </span>
        )}
      </div>

      <Section padding="none">{body}</Section>

      <UserDrawer
        userId={openId}
        apps={apps}
        services={services}
        currentUserId={currentUserId}
        onClose={() => setOpenId(null)}
        onChanged={() => void reload()}
      />
    </>
  );
}
