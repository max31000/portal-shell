import { Skeleton, Table } from '@mantine/core';
import { EmptyState, ErrorState, Section } from '@mvv42/kit';
import { IconWorld } from '@tabler/icons-react';
import { HTTP_SERVICES, STATUS_CLASSES, STATUS_CLASS_COLORS, legend } from './entities';
import { byLabel, useInstant } from './hooks';
import { useMonitoring } from './context';
import { PromChart, type PromChartSpec } from './PromChart';
import { formatValue } from './units';
import classes from './Monitoring.module.css';

const bySvc = legend.label('service', 'other');

const latency = (q: number): string =>
  `histogram_quantile(${q}, sum by (service, le) (rate(mvv42_http_request_duration_seconds_bucket[$__rate])))`;

const HTTP_CHARTS: PromChartSpec[] = [
  {
    title: 'Запросы в секунду',
    explanation: 'Все HTTP-запросы через nginx по сервисам (сложены). other — пути вне сервисов.',
    unit: 'rps',
    kind: 'stackedArea',
    order: HTTP_SERVICES,
    queries: [{ expr: 'sum by (service) (rate(mvv42_http_requests_total[$__rate]))', legend: bySvc }],
  },
  {
    title: 'Ответы по классам',
    explanation: '2xx — успех, 3xx — перенаправления, 4xx — ошибки клиента (нет доступа, не найдено), 5xx — ошибки сервера.',
    unit: 'rps',
    kind: 'stackedArea',
    order: STATUS_CLASSES,
    colors: STATUS_CLASS_COLORS,
    queries: [
      {
        expr:
          'sum by (class) (label_replace(rate(mvv42_http_requests_total[$__rate]), "class", "${1}xx", "status", "([0-9]).*"))',
        legend: legend.label('class', '?'),
      },
    ],
  },
  {
    title: 'Ошибки 5xx в секунду',
    explanation: 'Ответы 5xx по сервисам. Алерт — когда их больше 5% запросов сервиса 10 минут.',
    unit: 'rps',
    order: HTTP_SERVICES,
    queries: [{ expr: 'sum by (service) (rate(mvv42_http_requests_total{status=~"5.."}[$__rate]))', legend: bySvc }],
  },
  {
    title: 'Задержка p50',
    explanation: 'Медиана времени ответа: половина запросов быстрее. Оценка по гистограмме nginx.',
    unit: 'seconds',
    order: HTTP_SERVICES,
    queries: [{ expr: latency(0.5), legend: bySvc }],
  },
  {
    title: 'Задержка p95',
    explanation: '95% запросов отвечают быстрее этого времени — «медленный хвост». Оценка по гистограмме nginx.',
    unit: 'seconds',
    order: HTTP_SERVICES,
    queries: [{ expr: latency(0.95), legend: bySvc }],
  },
  {
    title: 'Трафик ответов',
    explanation: 'Байт в секунду в телах ответов по сервисам (сложены).',
    unit: 'bytesPerSec',
    kind: 'stackedArea',
    order: HTTP_SERVICES,
    queries: [{ expr: 'sum by (service) (rate(mvv42_http_response_bytes_total[$__rate]))', legend: bySvc }],
  },
];

const TOTALS = {
  requests: 'sum by (service) (increase(mvv42_http_requests_total[$__range]))',
  c4xx: 'sum by (service) (increase(mvv42_http_requests_total{status=~"4.."}[$__range]))',
  c5xx: 'sum by (service) (increase(mvv42_http_requests_total{status=~"5.."}[$__range]))',
  bytes: 'sum by (service) (increase(mvv42_http_response_bytes_total[$__range]))',
};

function serviceRank(s: string): number {
  const i = (HTTP_SERVICES as readonly string[]).indexOf(s);
  return i === -1 ? HTTP_SERVICES.length : i;
}

/** Per-service totals over the period. */
function HttpTotals() {
  const { period } = useMonitoring();
  const { data, error, loading, reload } = useInstant(TOTALS);

  const requests = byLabel(data?.requests, 'service');
  const c4xx = byLabel(data?.c4xx, 'service');
  const c5xx = byLabel(data?.c5xx, 'service');
  const bytes = byLabel(data?.bytes, 'service');
  const services = [...requests.keys()].sort((a, b) => serviceRank(a) - serviceRank(b) || a.localeCompare(b));

  return (
    <Section title={`Итоги за ${period.label}`} description="Запросы, ошибки и трафик по сервисам" padding="none">
      {error && !data ? (
        <ErrorState title="Не удалось загрузить итоги" error={error} onRetry={() => void reload()} compact />
      ) : loading && !data ? (
        <div style={{ padding: 'var(--mvv-sp-5)' }}>
          <Skeleton height={14} mb="sm" />
          <Skeleton height={14} mb="sm" />
          <Skeleton height={14} width="60%" />
        </div>
      ) : services.length === 0 ? (
        <EmptyState compact icon={<IconWorld />} title="Запросов нет" description="За период nginx не принял ни одного запроса." />
      ) : (
        <Table.ScrollContainer minWidth={560}>
          <Table className={classes.table}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Сервис</Table.Th>
                <Table.Th scope="col" className={classes.num}>Запросы</Table.Th>
                <Table.Th scope="col" className={classes.num}>4xx</Table.Th>
                <Table.Th scope="col" className={classes.num}>5xx</Table.Th>
                <Table.Th scope="col" className={classes.num}>Трафик</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {services.map((s) => (
                <Table.Tr key={s}>
                  <Table.Th scope="row">{s}</Table.Th>
                  <Table.Td className={classes.num}>{formatValue(Math.round(requests.get(s) ?? 0), 'count')}</Table.Td>
                  <Table.Td className={classes.num}>{formatValue(Math.round(c4xx.get(s) ?? 0), 'count')}</Table.Td>
                  <Table.Td className={classes.num}>{formatValue(Math.round(c5xx.get(s) ?? 0), 'count')}</Table.Td>
                  <Table.Td className={classes.num}>{formatValue(bytes.get(s) ?? 0, 'bytes')}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Section>
  );
}

export function HttpSection() {
  return (
    <div className={classes.stack}>
      <div className={classes.grid}>
        {HTTP_CHARTS.map((spec, i) => (
          <PromChart key={i} {...spec} />
        ))}
      </div>
      <HttpTotals />
    </div>
  );
}
