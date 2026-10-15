import { useState } from 'react';
import { Button, Skeleton, Table, UnstyledButton } from '@mantine/core';
import { EmptyState, ErrorState, Section } from '@mvv42/kit';
import { IconArrowDown, IconArrowUp, IconBox, IconFileText } from '@tabler/icons-react';
import { isHostNetworkContainer, legend } from './entities';
import { byLabel, useInstant } from './hooks';
import { useMonitoring } from './context';
import { PromChart, type PromChartSpec } from './PromChart';
import { formatDuration, formatValue } from './units';
import classes from './Monitoring.module.css';

const byName = legend.label('name');

const CONTAINER_CHARTS: PromChartSpec[] = [
  {
    title: 'CPU по контейнерам',
    explanation: '% одного ядра (100% = ядро целиком). Показаны 8 самых загруженных, остальные — «Другое».',
    unit: 'percent',
    queries: [
      { expr: '100 * sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[$__rate]))', legend: byName },
    ],
  },
  {
    title: 'Память по контейнерам',
    explanation: 'Рабочий набор (working set) — то, что считает OOM-killer. 8 крупнейших, остальные — «Другое».',
    unit: 'bytes',
    kind: 'stackedArea',
    queries: [{ expr: 'sum by (name) (container_memory_working_set_bytes{name!=""})', legend: byName }],
  },
];

const TABLE = {
  cpu: '100 * sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[$__rate]))',
  mem: 'sum by (name) (container_memory_working_set_bytes{name!=""})',
  limit: 'sum by (name) (container_spec_memory_limit_bytes{name!=""})',
  rx: 'sum by (name) (rate(container_network_receive_bytes_total{name!=""}[$__rate]))',
  tx: 'sum by (name) (rate(container_network_transmit_bytes_total{name!=""}[$__rate]))',
  uptime: 'time() - max by (name) (container_start_time_seconds{name!=""})',
};

type SortKey = 'name' | 'cpu' | 'mem' | 'uptime';

interface ContainerRow {
  name: string;
  cpu: number | null;
  mem: number | null;
  /** null — no limit (cAdvisor reports 0). */
  limit: number | null;
  rx: number | null;
  tx: number | null;
  uptime: number | null;
}

const SORT_LABEL: Record<SortKey, string> = { name: 'Имя', cpu: 'CPU', mem: 'Память', uptime: 'Аптайм' };

function compare(a: ContainerRow, b: ContainerRow, key: SortKey): number {
  if (key === 'name') return a.name.localeCompare(b.name);
  return (b[key] ?? -1) - (a[key] ?? -1) || a.name.localeCompare(b.name);
}

function ContainersTable() {
  const { openLogs } = useMonitoring();
  const { data, error, loading, reload } = useInstant(TABLE);
  const [sort, setSort] = useState<SortKey>('cpu');

  const cpu = byLabel(data?.cpu, 'name');
  const mem = byLabel(data?.mem, 'name');
  const limit = byLabel(data?.limit, 'name');
  const rx = byLabel(data?.rx, 'name');
  const tx = byLabel(data?.tx, 'name');
  const uptime = byLabel(data?.uptime, 'name');
  const names = new Set([...mem.keys(), ...cpu.keys()]);
  const rows: ContainerRow[] = [...names]
    .map((name) => {
      const host = isHostNetworkContainer(name);
      const lim = limit.get(name);
      return {
        name,
        cpu: cpu.get(name) ?? null,
        mem: mem.get(name) ?? null,
        limit: lim && lim > 0 ? lim : null,
        rx: host ? null : (rx.get(name) ?? null),
        tx: host ? null : (tx.get(name) ?? null),
        uptime: uptime.get(name) ?? null,
      };
    })
    .sort((a, b) => compare(a, b, sort));

  const header = (key: SortKey, numeric = true) => (
    <Table.Th
      scope="col"
      className={numeric ? classes.num : undefined}
      aria-sort={sort === key ? (key === 'name' ? 'ascending' : 'descending') : 'none'}
    >
      <UnstyledButton className={classes.sortButton} onClick={() => setSort(key)}>
        {SORT_LABEL[key]}
        {sort === key && (key === 'name' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
      </UnstyledButton>
    </Table.Th>
  );

  return (
    <Section title="Контейнеры" description="Сейчас (за последние 5 минут)" padding="none">
      {error && !data ? (
        <ErrorState title="Не удалось загрузить контейнеры" error={error} onRetry={() => void reload()} compact />
      ) : loading && !data ? (
        <div style={{ padding: 'var(--mvv-sp-5)' }}>
          <Skeleton height={14} mb="sm" />
          <Skeleton height={14} mb="sm" />
          <Skeleton height={14} width="60%" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState compact icon={<IconBox />} title="Контейнеров нет" description="cAdvisor не прислал метрик." />
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table className={classes.table}>
            <Table.Thead>
              <Table.Tr>
                {header('name', false)}
                {header('cpu')}
                {header('mem')}
                <Table.Th scope="col" className={classes.num}>
                  Сеть ↓ / ↑
                </Table.Th>
                {header('uptime')}
                <Table.Th scope="col">
                  <span className="mvv-visually-hidden">Действия</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.name}>
                  <Table.Th scope="row" className={classes.code}>
                    {r.name}
                  </Table.Th>
                  <Table.Td className={classes.num}>{formatValue(r.cpu, 'percent')}</Table.Td>
                  <Table.Td className={classes.num}>
                    {formatValue(r.mem, 'bytes')}
                    <span className={classes.muted}> / {r.limit === null ? 'без лимита' : formatValue(r.limit, 'bytes')}</span>
                  </Table.Td>
                  <Table.Td className={classes.num}>
                    {isHostNetworkContainer(r.name) ? (
                      <span className={classes.muted} title="Сеть хоста — см. «Сервер»">
                        сеть хоста
                      </span>
                    ) : (
                      `${formatValue(r.rx, 'bytesPerSec')} / ${formatValue(r.tx, 'bytesPerSec')}`
                    )}
                  </Table.Td>
                  <Table.Td className={classes.num}>{formatDuration(r.uptime)}</Table.Td>
                  <Table.Td>
                    <Button
                      variant="subtle"
                      size="compact-xs"
                      leftSection={<IconFileText size={14} />}
                      onClick={() => openLogs(r.name)}
                      aria-label={`Показать логи ${r.name}`}
                    >
                      Логи
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Section>
  );
}

export function ContainersSection() {
  return (
    <div className={classes.stack}>
      <ContainersTable />
      <div className={classes.grid}>
        {CONTAINER_CHARTS.map((spec, i) => (
          <PromChart key={i} {...spec} />
        ))}
      </div>
    </div>
  );
}
