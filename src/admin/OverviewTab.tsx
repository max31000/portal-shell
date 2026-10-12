import { Badge, Button, Skeleton, Table } from '@mantine/core';
import { EmptyState, ErrorState, Metric, MetricGrid, Section } from '@mvv42/kit';
import { IconApps, IconArrowRight } from '@tabler/icons-react';
import type { Service } from '../types';
import { adminApi } from './api';
import { AppLabel } from './AppLabel';
import { ACCESS_SHORT, plural } from './format';
import { useResource } from './useResource';
import classes from './Admin.module.css';

interface OverviewTabProps {
  services: Service[];
  onOpenApps: () => void;
}

export function OverviewTab({ services, onOpenApps }: OverviewTabProps) {
  const { data, error, loading, reload } = useResource(adminApi.overview);

  if (error && !data) return <ErrorState title="Не удалось загрузить обзор" error={error} onRetry={() => void reload()} />;

  const metrics = data ?? { users: 0, activeSessions: 0, logins24h: 0, logins7d: 0, blocked: 0, apps: [] };
  // Closed registration (auth ≥ the invite-login release); an older auth during the rollout has no such field.
  const denied = typeof metrics.deniedUnregistered7d === 'number' ? metrics.deniedUnregistered7d : null;

  return (
    <>
      <MetricGrid cols={4}>
        <Metric
          label="Пользователи"
          value={metrics.users}
          hint={
            metrics.blocked > 0
              ? `${metrics.blocked} ${plural(metrics.blocked, 'заблокирован', 'заблокированы', 'заблокировано')}`
              : 'никто не заблокирован'
          }
          loading={loading}
        />
        <Metric label="Активные сессии" value={metrics.activeSessions} hint="не отозваны и не истекли" loading={loading} />
        {denied === null ? (
          <>
            <Metric label="Входы за 24 часа" value={metrics.logins24h} hint="успешные" loading={loading} />
            <Metric label="Входы за 7 дней" value={metrics.logins7d} hint="успешные" loading={loading} />
          </>
        ) : (
          // Four tiles stay in one row: the 24 h count moves into the 7-day hint.
          <>
            <Metric
              label="Входы за 7 дней"
              value={metrics.logins7d}
              hint={`успешные · ${metrics.logins24h} за 24 часа`}
              loading={loading}
            />
            <Metric
              label="Попыток входа без приглашения (7 дн.)"
              value={denied}
              hint="новые люди без кода"
              loading={loading}
            />
          </>
        )}
      </MetricGrid>

      <Section
        title="Сервисы"
        description="Режим доступа и сколько пользователей могут пользоваться сервисом"
        padding="none"
        actions={
          <Button variant="default" size="xs" rightSection={<IconArrowRight size={14} />} onClick={onOpenApps}>
            Настроить
          </Button>
        }
      >
        {loading ? (
          <div style={{ padding: 'var(--mvv-sp-5)' }}>
            <Skeleton height={14} mb="sm" />
            <Skeleton height={14} mb="sm" />
            <Skeleton height={14} width="60%" />
          </div>
        ) : metrics.apps.length === 0 ? (
          <EmptyState compact icon={<IconApps />} title="Сервисов нет" description="Добавьте сервис в mvv42-auth" />
        ) : (
          <Table className={classes.table}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Сервис</Table.Th>
                <Table.Th>Доступ</Table.Th>
                <Table.Th>Без входа</Table.Th>
                <Table.Th className={classes.num}>С доступом</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {metrics.apps.map((app) => (
                <Table.Tr key={app.id}>
                  <Table.Td>
                    <AppLabel appId={app.id} name={app.name} services={services} withId />
                  </Table.Td>
                  <Table.Td>
                    <Badge color={app.access === 'public' ? 'gray' : app.access === 'invite' ? 'blue' : 'violet'}>
                      {ACCESS_SHORT[app.access] ?? app.access}
                    </Badge>
                  </Table.Td>
                  <Table.Td className={app.anonymous ? undefined : classes.muted}>
                    {app.anonymous ? 'Открывается без входа' : 'Нужен вход'}
                  </Table.Td>
                  <Table.Td className={classes.num}>{app.grantedUsers}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
