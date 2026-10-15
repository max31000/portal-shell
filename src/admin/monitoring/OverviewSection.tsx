import { Badge, Button } from '@mantine/core';
import { DataList, EmptyState, ErrorState, ListRow, Metric, MetricGrid, Section } from '@mvv42/kit';
import { IconArrowRight, IconFileText, IconHeartRateMonitor, IconShieldCheck } from '@tabler/icons-react';
import type { Labels } from './api';
import { useMonitoring } from './context';
import { AlertList, AlertListSkeleton } from './AlertsSection';
import { PROBE_JOB_LABEL, SERVICE_CONTAINER, legend } from './entities';
import { scalarOf, useAlerts, useInstant } from './hooks';
import { PromChart, type PromChartSpec } from './PromChart';
import { formatDuration, formatValue } from './units';
import classes from './Monitoring.module.css';

const KEY_FIGURES = {
  cpu: '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[$__rate])))',
  memTotal: 'node_memory_MemTotal_bytes',
  memAvailable: 'node_memory_MemAvailable_bytes',
  diskFree: 'node_filesystem_avail_bytes{mountpoint="/"}',
  diskSize: 'node_filesystem_size_bytes{mountpoint="/"}',
  rx: 'sum(rate(node_network_receive_bytes_total[$__rate]))',
  tx: 'sum(rate(node_network_transmit_bytes_total[$__rate]))',
  rps: 'sum(rate(mvv42_http_requests_total[$__rate]))',
  uptime: 'time() - node_boot_time_seconds',
  certDays: 'min(probe_ssl_earliest_cert_expiry{job="edge"} - time()) / 86400',
  load1: 'node_load1',
};

const HEALTH = {
  up: 'probe_success',
  duration: 'probe_duration_seconds',
};

const OVERVIEW_CHARTS: PromChartSpec[] = [
  {
    title: 'CPU',
    explanation: 'Загрузка всех ядер, % (100% − простой).',
    unit: 'percent',
    kind: 'area',
    yMax: 100,
    compact: true,
    queries: [
      { expr: '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[$__rate])))', legend: legend.fixed('CPU') },
    ],
  },
  {
    title: 'Запросы в секунду',
    explanation: 'Все HTTP-запросы через nginx. По сервисам — в разделе HTTP.',
    unit: 'rps',
    kind: 'area',
    compact: true,
    queries: [{ expr: 'sum(rate(mvv42_http_requests_total[$__rate]))', legend: legend.fixed('запросы') }],
  },
];

function KeyFigures() {
  const { data, error, loading, reload } = useInstant(KEY_FIGURES);
  if (error && !data) return <ErrorState title="Не удалось загрузить метрики сервера" error={error} onRetry={() => void reload()} />;

  const v = (k: keyof typeof KEY_FIGURES) => scalarOf(data?.[k]);
  const memTotal = v('memTotal');
  const memAvailable = v('memAvailable');
  const memUsed = memTotal !== null && memAvailable !== null ? memTotal - memAvailable : null;
  const diskFree = v('diskFree');
  const diskSize = v('diskSize');
  const certDays = v('certDays');
  const load1 = v('load1');
  const busy = loading && !data;

  return (
    <MetricGrid cols={4}>
      <Metric label="CPU" value={formatValue(v('cpu'), 'percent')} hint="все ядра, 5 мин" loading={busy} />
      <Metric
        label="Память"
        value={formatValue(memUsed, 'bytes')}
        hint={`занято из ${formatValue(memTotal, 'bytes')}`}
        loading={busy}
      />
      <Metric
        label="Диск /"
        value={formatValue(diskFree, 'bytes')}
        hint={`свободно из ${formatValue(diskSize, 'bytes')}`}
        loading={busy}
      />
      <Metric
        label="Сеть сейчас"
        value={`↓ ${formatValue(v('rx'), 'bytesPerSec')}`}
        hint={`↑ ${formatValue(v('tx'), 'bytesPerSec')}`}
        loading={busy}
      />
      <Metric label="Запросы" value={formatValue(v('rps'), 'rps')} hint="через nginx, 5 мин" loading={busy} />
      <Metric label="Аптайм" value={formatDuration(v('uptime'))} hint="с загрузки сервера" loading={busy} />
      <Metric
        label="Сертификат"
        value={certDays === null ? '—' : `${Math.floor(certDays)} дн`}
        hint="до истечения TLS mvv42.ru"
        loading={busy}
      />
      <Metric label="Load 1 мин" value={load1 === null ? '—' : load1.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hint="очередь на CPU" loading={busy} />
    </MetricGrid>
  );
}

interface Probe {
  key: string;
  service: string;
  job: string;
  ok: boolean;
  duration: number | null;
}

const probeKey = (m: Labels) => `${m.job}/${m.service}/${m.instance ?? ''}`;

function Health() {
  const { openLogs } = useMonitoring();
  const { data, error, loading, reload } = useInstant(HEALTH);
  const durations = new Map((data?.duration ?? []).map((s) => [probeKey(s.metric), Number(s.value[1])]));
  const probes: Probe[] = (data?.up ?? [])
    .filter((s) => s.metric.service)
    .map((s) => {
      const key = probeKey(s.metric);
      const d = durations.get(key);
      return {
        key,
        service: s.metric.service,
        job: s.metric.job ?? '',
        ok: Number(s.value[1]) === 1,
        duration: d !== undefined && Number.isFinite(d) ? d : null,
      };
    })
    // Problems first, then by service.
    .sort((a, b) => Number(a.ok) - Number(b.ok) || a.service.localeCompare(b.service) || a.job.localeCompare(b.job));

  return (
    <Section title="Здоровье" description="Проверки blackbox: health-эндпоинты, сайт снаружи и VPN" padding="none">
      {error && !data ? (
        <ErrorState title="Не удалось загрузить проверки" error={error} onRetry={() => void reload()} compact />
      ) : loading && !data ? (
        <AlertListSkeleton />
      ) : probes.length === 0 ? (
        <EmptyState compact icon={<IconHeartRateMonitor />} title="Проверок нет" description="blackbox не прислал результатов." />
      ) : (
        <DataList aria-label="Проверки сервисов">
          {probes.map((p) => (
            <ListRow
              key={p.key}
              title={
                <span className={classes.status}>
                  <span className={classes.dot} data-ok={p.ok} role="img" aria-label={p.ok ? 'работает' : 'недоступен'} />
                  {p.service}
                </span>
              }
              description={PROBE_JOB_LABEL[p.job] ?? p.job}
              action={
                SERVICE_CONTAINER[p.service] ? (
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    leftSection={<IconFileText size={14} />}
                    onClick={() => openLogs(SERVICE_CONTAINER[p.service]!)}
                    aria-label={`Показать логи ${p.service}`}
                  >
                    Логи
                  </Button>
                ) : undefined
              }
              value={
                <span className={classes.status}>
                  {p.duration !== null && <span className={classes.muted}>{formatValue(p.duration, 'seconds')}</span>}
                  <Badge color={p.ok ? 'green' : 'red'} variant="light" size="sm">
                    {p.ok ? 'OK' : 'Недоступен'}
                  </Badge>
                </span>
              }
            />
          ))}
        </DataList>
      )}
    </Section>
  );
}

function ActiveAlerts({ onOpenAlerts }: { onOpenAlerts: () => void }) {
  const { data, error, loading, reload } = useAlerts();
  return (
    <Section
      title="Активные алерты"
      padding="none"
      actions={
        <Button variant="default" size="xs" rightSection={<IconArrowRight size={14} />} onClick={onOpenAlerts}>
          Все алерты
        </Button>
      }
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
    </Section>
  );
}

export function OverviewSection({ onOpenAlerts }: { onOpenAlerts: () => void }) {
  return (
    <div className={classes.stack}>
      <KeyFigures />
      <Health />
      <ActiveAlerts onOpenAlerts={onOpenAlerts} />
      <div className={classes.grid}>
        {OVERVIEW_CHARTS.map((spec, i) => (
          <PromChart key={i} {...spec} />
        ))}
      </div>
    </div>
  );
}
