import { useState } from 'react';
import { ActionIcon, Badge, Button, Drawer, Group, Skeleton, Stack, Switch, Text, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { EmptyState, ErrorState, Section, UserAvatar } from '@mvv42/kit';
import { IconBan, IconDeviceDesktop, IconLock, IconLockOpen, IconLogout, IconTrash } from '@tabler/icons-react';
import type { Service } from '../types';
import { adminApi, type AdminApp, type AdminUser } from './api';
import { AppLabel } from './AppLabel';
import { ACCESS_LABEL, LOGIN_RESULT, describeUserAgent, formatDate, formatDateTime, formatRelative } from './format';
import { mutate, useConfirm } from './feedback';
import { useResource } from './useResource';
import { UserBadges } from './UsersTab';
import classes from './Admin.module.css';

interface UserDrawerProps {
  /** `null` = closed. */
  userId: number | null;
  apps: AdminApp[];
  services: Service[];
  onClose: () => void;
  /** Something changed — reload the list. */
  onChanged: () => void;
}

/** What a grant switch means for this user beyond the explicit grant. */
function implicitAccess(app: AdminApp, user: AdminUser): string | null {
  if (app.access === 'public') return 'грант не нужен';
  if (user.isAdmin) return 'есть доступ как у админа';
  if (app.access === 'admin') return 'грант не откроет — нужен флаг админа';
  return null;
}

export function UserDrawer({ userId, apps, services, onClose, onChanged }: UserDrawerProps) {
  const compact = useMediaQuery('(max-width: 640px)');
  const [lastId, setLastId] = useState(userId);
  if (userId !== null && userId !== lastId) setLastId(userId);
  // Keep the last user rendered while the drawer animates out.
  const shownId = userId ?? lastId;

  return (
    <Drawer
      opened={userId !== null}
      onClose={onClose}
      position="right"
      size={compact ? '100%' : 520}
      title="Пользователь"
      zIndex={300}
    >
      {shownId !== null && (
        <UserDetail key={shownId} userId={shownId} apps={apps} services={services} onChanged={onChanged} />
      )}
    </Drawer>
  );
}

function UserDetail({
  userId,
  apps,
  services,
  onChanged,
}: {
  userId: number;
  apps: AdminApp[];
  services: Service[];
  onChanged: () => void;
}) {
  const { data, error, loading, reload } = useResource(() => adminApi.user(userId), userId);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, confirm] = useConfirm();

  if (error && !data) return <ErrorState title="Не удалось загрузить пользователя" error={error} onRetry={() => void reload()} />;
  if (loading || !data) return <DetailSkeleton />;

  const { user, sessions, logins } = data;

  async function run(key: string, action: () => Promise<unknown>, success: string, failure: string) {
    setBusy(key);
    const ok = await mutate(action, success, failure);
    setBusy(null);
    await reload();
    if (ok) onChanged();
  }

  const toggleGrant = (app: AdminApp, on: boolean) =>
    run(
      `grant:${app.id}`,
      () => (on ? adminApi.grant(user.id, app.id) : adminApi.revokeGrant(user.id, app.id)),
      on ? `Доступ к ${app.name} выдан` : `Грант на ${app.name} снят`,
      'Не удалось изменить доступ',
    );

  const toggleAdmin = (on: boolean) =>
    run(
      'admin',
      () => adminApi.setAdmin(user.id, on),
      on ? `${user.name} — администратор` : `${user.name} больше не администратор`,
      'Не удалось изменить права',
    );

  const toggleBlock = async () => {
    const blocking = !user.isBlocked;
    const ok = await confirm(
      blocking
        ? {
            title: 'Заблокировать пользователя?',
            message: `${user.name} будет разлогинен везде и не сможет войти. Уже выданный токен сервисы принимают до 10 минут.`,
            confirmLabel: 'Заблокировать',
          }
        : {
            title: 'Разблокировать пользователя?',
            message: `${user.name} снова сможет войти через Telegram. Старые сессии не вернутся.`,
            confirmLabel: 'Разблокировать',
            danger: false,
          },
    );
    if (!ok) return;
    await run(
      'block',
      () => adminApi.setBlocked(user.id, blocking),
      blocking ? `${user.name} заблокирован` : `${user.name} разблокирован`,
      blocking ? 'Не удалось заблокировать' : 'Не удалось разблокировать',
    );
  };

  const revokeAll = async () => {
    const ok = await confirm({
      title: 'Отозвать все сессии?',
      message: `${user.name} выйдет на всех устройствах (сервисы примут старый токен ещё до 10 минут).`,
      confirmLabel: 'Отозвать все',
    });
    if (ok) await run('revoke-all', () => adminApi.revokeSessions(user.id), 'Все сессии отозваны', 'Не удалось отозвать сессии');
  };

  const revokeOne = async (sessionId: number, label: string) => {
    const ok = await confirm({
      title: 'Отозвать сессию?',
      message: `Сессия «${label}» будет завершена.`,
      confirmLabel: 'Отозвать',
    });
    if (ok) await run(`session:${sessionId}`, () => adminApi.revokeSession(sessionId), 'Сессия отозвана', 'Не удалось отозвать сессию');
  };

  return (
    <Stack gap="xl">
      {dialog}
      <div className={classes.drawerHead}>
        <UserAvatar user={user} size={52} />
        <div className={classes.whoText}>
          <h3 className={classes.drawerName}>{user.name}</h3>
          <span className={classes.whoSub}>
            {user.username ? `@${user.username} · ` : ''}
            <span className={classes.mono}>tg {user.telegramId}</span> · с {formatDate(user.createdAt)}
          </span>
          <Group gap={4} mt={6}>
            <UserBadges user={user} />
          </Group>
        </div>
      </div>

      <Section
        variant="plain"
        title="Доступ к сервисам"
        description="Явные гранты. Сервисы с режимом «по приглашению» открываются только по гранту."
      >
        <div className={classes.rows}>
          {apps.map((app) => {
            const granted = user.grants.includes(app.id);
            const note = implicitAccess(app, user);
            return (
              <div key={app.id} className={classes.rowItem}>
                <div className={classes.rowMain}>
                  <AppLabel appId={app.id} name={app.name} services={services} size={28} />
                  <div className={classes.rowSub} style={{ marginLeft: 40 }}>
                    {ACCESS_LABEL[app.access]}
                    {note ? ` · ${note}` : ''}
                  </div>
                </div>
                <Switch
                  checked={granted}
                  disabled={busy !== null}
                  aria-label={`Грант: ${app.name}`}
                  onChange={(e) => void toggleGrant(app, e.currentTarget.checked)}
                />
              </div>
            );
          })}
          {apps.length === 0 && <Text size="sm" c="dimmed">Сервисов нет.</Text>}
        </div>
      </Section>

      <Section variant="plain" title="Права">
        <div className={classes.rows}>
          <div className={classes.rowItem}>
            <div className={classes.rowMain}>
              <div className={classes.rowTitle}>Администратор</div>
              <div className={classes.rowSub}>
                {user.isOwner
                  ? 'Владелец всегда администратор — флаг не меняется.'
                  : 'Открывает сервисы с режимом «только админам». Админку видит только владелец.'}
              </div>
            </div>
            <Switch
              checked={user.isAdmin}
              disabled={user.isOwner || busy !== null}
              aria-label="Администратор"
              onChange={(e) => void toggleAdmin(e.currentTarget.checked)}
            />
          </div>
        </div>
      </Section>

      <Section
        variant="plain"
        title="Активные сессии"
        description={sessions.length ? undefined : 'Нет активных сессий.'}
        actions={
          <Button
            size="xs"
            variant="default"
            leftSection={<IconLogout size={14} />}
            disabled={sessions.length === 0 || busy !== null}
            loading={busy === 'revoke-all'}
            onClick={() => void revokeAll()}
          >
            Отозвать все
          </Button>
        }
      >
        {sessions.length > 0 && (
          <div className={classes.rows}>
            {sessions.map((s) => {
              const label = describeUserAgent(s.userAgent);
              return (
                <div key={s.id} className={classes.rowItem}>
                  <IconDeviceDesktop size={18} stroke={1.6} className={classes.muted} />
                  <div className={classes.rowMain}>
                    <div className={classes.rowTitle} title={s.userAgent ?? undefined}>
                      {label}
                    </div>
                    <div className={classes.rowSub}>
                      <span className={classes.mono}>{s.ip ?? 'IP неизвестен'}</span> · вход {formatDateTime(s.createdAt)} ·
                      активность {formatRelative(s.lastUsedAt, 'не было')}
                    </div>
                  </div>
                  <Tooltip label="Отозвать сессию">
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label={`Отозвать сессию ${label}`}
                      disabled={busy !== null}
                      loading={busy === `session:${s.id}`}
                      onClick={() => void revokeOne(s.id, label)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section variant="plain" title="Последние входы" description={logins.length ? 'До 50 последних попыток' : undefined}>
        {logins.length === 0 ? (
          <EmptyState compact title="Входов не было" />
        ) : (
          <div className={classes.rows}>
            {logins.map((l) => (
              <div key={l.id} className={classes.rowItem}>
                <div className={classes.rowMain}>
                  <div className={classes.rowTitle}>{formatDateTime(l.at)}</div>
                  <div className={classes.rowSub}>
                    <span className={classes.mono}>{l.ip ?? '—'}</span> · {describeUserAgent(l.userAgent)}
                  </div>
                </div>
                <Badge color={LOGIN_RESULT[l.result]?.color ?? 'gray'}>{LOGIN_RESULT[l.result]?.label ?? l.result}</Badge>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className={classes.danger}>
        <div className={classes.rowMain}>
          <div className={classes.rowTitle}>{user.isBlocked ? 'Пользователь заблокирован' : 'Блокировка'}</div>
          <div className={classes.rowSub}>
            {user.isOwner
              ? 'Владельца заблокировать нельзя.'
              : user.isBlocked
                ? `С ${formatDateTime(user.blockedAt)}. Вход запрещён, сессии отозваны.`
                : 'Запрещает вход и отзывает все сессии.'}
          </div>
        </div>
        <Button
          color="red"
          variant={user.isBlocked ? 'default' : 'filled'}
          leftSection={user.isBlocked ? <IconLockOpen size={16} /> : user.isOwner ? <IconLock size={16} /> : <IconBan size={16} />}
          disabled={user.isOwner || (busy !== null && busy !== 'block')}
          loading={busy === 'block'}
          onClick={() => void toggleBlock()}
        >
          {user.isBlocked ? 'Разблокировать' : 'Заблокировать'}
        </Button>
      </div>
    </Stack>
  );
}

function DetailSkeleton() {
  return (
    <Stack gap="lg" aria-busy="true">
      <Group gap="md">
        <Skeleton height={52} circle />
        <Stack gap={6} style={{ flex: 1 }}>
          <Skeleton height={16} width="50%" />
          <Skeleton height={12} width="35%" />
        </Stack>
      </Group>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={44} />
      ))}
    </Stack>
  );
}

