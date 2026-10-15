import { Badge, Button, Skeleton } from '@mantine/core';
import { DataList, EmptyState, ErrorState, ListRow, Section } from '@mvv42/kit';
import { IconFileText, IconShieldCheck } from '@tabler/icons-react';
import { formatDateTime, formatRelative } from '../format';
import type { Alert } from './api';
import { useMonitoring } from './context';
import { useAlerts } from './hooks';
import classes from './Monitoring.module.css';

const STATE: Record<string, { label: string; color: string }> = {
  firing: { label: 'Сработал', color: 'red' },
  pending: { label: 'Ожидает', color: 'yellow' },
};

/** What the alert is about: `service`, the container (`name`), the scrape `job`. */
function alertSubject(a: Alert): string | null {
  return a.labels.service || a.labels.name || a.labels.job || null;
}

interface AlertListProps {
  alerts: Alert[];
}

/** Active alerts as rows; container alerts get a «Логи» link. */
export function AlertList({ alerts }: AlertListProps) {
  const { openLogs } = useMonitoring();
  return (
    <DataList aria-label="Активные алерты">
      {alerts.map((a, i) => {
        const state = STATE[a.state] ?? { label: a.state, color: 'gray' };
        const subject = alertSubject(a);
        const container = a.labels.name;
        return (
          <ListRow
            key={`${a.name}-${i}`}
            title={
              <span className={classes.status}>
                <Badge color={state.color} variant={a.state === 'firing' ? 'filled' : 'light'} size="sm">
                  {state.label}
                </Badge>
                {a.name}
                {subject && <span className={classes.muted}>· {subject}</span>}
              </span>
            }
            description={
              <>
                {a.annotations?.summary ?? 'Без описания'}
                {' · '}
                <span title={formatDateTime(a.activeAt)}>с {formatRelative(a.activeAt, '—')}</span>
              </>
            }
            action={
              container ? (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  leftSection={<IconFileText size={14} />}
                  onClick={() => openLogs(container)}
                  aria-label={`Показать логи ${container}`}
                >
                  Логи
                </Button>
              ) : undefined
            }
          />
        );
      })}
    </DataList>
  );
}

export function AlertListSkeleton() {
  return (
    <div style={{ padding: 'var(--mvv-sp-5)' }}>
      <Skeleton height={14} mb="sm" />
      <Skeleton height={14} width="60%" />
    </div>
  );
}

export function AlertsSection() {
  const { data, error, loading, reload } = useAlerts();
  return (
    <Section
      title="Алерты"
      description="Сработавшие (firing) и ожидающие подтверждения по времени (pending) правила vmalert"
      padding="none"
    >
      {error && !data ? (
        <ErrorState title="Не удалось загрузить алерты" error={error} onRetry={() => void reload()} compact />
      ) : loading && !data ? (
        <AlertListSkeleton />
      ) : !data || data.length === 0 ? (
        <EmptyState compact icon={<IconShieldCheck />} title="Всё спокойно" description="Активных алертов нет." />
      ) : (
        <AlertList alerts={data} />
      )}
      <p className={classes.note} style={{ margin: 0, padding: 'var(--mvv-sp-3) var(--mvv-sp-5)' }}>
        Правила — в <code className={classes.code}>mvv42-infra/monitoring/vmalert/rules.yml</code>; уведомления
        приходят в Telegram.
      </p>
    </Section>
  );
}
