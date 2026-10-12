import { useState } from 'react';
import { Select, Skeleton, Switch, Table, Text } from '@mantine/core';
import { EmptyState, ErrorState, Section } from '@mvv42/kit';
import { IconApps } from '@tabler/icons-react';
import type { Service } from '../types';
import { adminApi, type AccessMode, type OverviewApp } from './api';
import { AppLabel } from './AppLabel';
import { ACCESS_LABEL } from './format';
import { mutate } from './feedback';
import { useResource } from './useResource';
import classes from './Admin.module.css';

const ACCESS_OPTIONS = (Object.keys(ACCESS_LABEL) as AccessMode[]).map((value) => ({ value, label: ACCESS_LABEL[value] }));

export function AppsTab({ services }: { services: Service[] }) {
  const { data, error, loading, reload } = useResource(adminApi.overview);
  const [busy, setBusy] = useState<string | null>(null);

  if (error && !data) return <ErrorState title="Не удалось загрузить сервисы" error={error} onRetry={() => void reload()} />;

  async function save(app: OverviewApp, patch: Partial<Pick<OverviewApp, 'anonymous' | 'access'>>, success: string) {
    setBusy(app.id);
    await mutate(
      () => adminApi.saveApp(app.id, { name: app.name, anonymous: app.anonymous, access: app.access, ...patch }),
      success,
      `Не удалось сохранить «${app.name}»`,
    );
    await reload();
    setBusy(null);
  }

  const apps = data?.apps ?? [];

  return (
    <Section
      title="Сервисы"
      description="Кто может пользоваться сервисом. Изменения доходят до сервисов в течение 10 минут (срок жизни токена)."
      padding="none"
    >
      {loading ? (
        <div style={{ padding: 'var(--mvv-sp-5)' }}>
          <Skeleton height={36} mb="sm" />
          <Skeleton height={36} mb="sm" />
          <Skeleton height={36} />
        </div>
      ) : apps.length === 0 ? (
        <EmptyState compact icon={<IconApps />} title="Сервисов нет" />
      ) : (
        <Table className={classes.table} verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Сервис</Table.Th>
              <Table.Th>Без входа</Table.Th>
              <Table.Th>Доступ после входа</Table.Th>
              <Table.Th className={classes.num}>С доступом</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {apps.map((app) => (
              <Table.Tr key={app.id}>
                <Table.Td>
                  <AppLabel appId={app.id} name={app.name} services={services} withId />
                </Table.Td>
                <Table.Td>
                  <Switch
                    checked={app.anonymous}
                    disabled={busy !== null}
                    aria-label={`${app.name}: доступен без входа`}
                    label={app.anonymous ? 'Да' : 'Нет'}
                    onChange={(e) => {
                      const anonymous = e.currentTarget.checked;
                      void save(
                        app,
                        { anonymous },
                        anonymous ? `${app.name} открывается без входа` : `${app.name} требует входа`,
                      );
                    }}
                  />
                </Table.Td>
                <Table.Td>
                  <Select
                    w={200}
                    size="xs"
                    data={ACCESS_OPTIONS}
                    value={app.access}
                    allowDeselect={false}
                    disabled={busy !== null}
                    aria-label={`${app.name}: режим доступа`}
                    onChange={(v) => {
                      if (v && v !== app.access) {
                        void save(app, { access: v as AccessMode }, `${app.name}: ${ACCESS_LABEL[v as AccessMode].toLowerCase()}`);
                      }
                    }}
                  />
                </Table.Td>
                <Table.Td className={classes.num}>{app.grantedUsers}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Text size="xs" c="dimmed" px="lg" py="md" style={{ borderTop: '1px solid var(--mvv-border)' }}>
        «Без входа» — сервис открывается анонимно, вход лишь включает личные функции. «По приглашению» — нужен грант
        (инвайт или переключатель у пользователя). Администраторы видят всё.
      </Text>
    </Section>
  );
}
