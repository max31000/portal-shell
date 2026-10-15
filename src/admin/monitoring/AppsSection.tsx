import { useMemo, useState } from 'react';
import { SegmentedControl, Select, Skeleton, Table } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { EmptyState, ErrorState, Section } from '@mvv42/kit';
import { chartColors } from '@mvv42/kit/charts';
import { IconRoute } from '@tabler/icons-react';
import { APP_SERVICES, type AppService } from './entities';
import { byLabel, useInstant } from './hooks';
import { PromChart, type PromChartSpec } from './PromChart';
import { appQueries, endpointLabel, LOGIN_RESULTS } from './appQueries';
import { formatValue } from './units';
import classes from './Monitoring.module.css';

const LOGIN_COLORS: Record<string, string> = {
  ok: chartColors.positive,
  denied_blocked: chartColors.negative,
};

/** Chart declarations of one .NET service (prometheus-net metrics, job `apps`). */
function appCharts(service: AppService): PromChartSpec[] {
  const q = appQueries(service);
  const byEndpoint = (m: Record<string, string>) => endpointLabel(m.endpoint);
  const charts: PromChartSpec[] = [
    {
      title: 'Запросы в секунду по эндпоинтам',
      explanation: 'Эндпоинт — шаблон маршрута ASP.NET. 8 самых нагруженных, остальные — «Другое».',
      unit: 'rps',
      kind: 'stackedArea',
      queries: [{ expr: q.rpsByEndpoint, legend: byEndpoint }],
    },
    {
      title: 'Задержка p95 по эндпоинтам',
      explanation: '95% запросов к эндпоинту быстрее этого времени (по гистограмме приложения). 8 самых медленных.',
      unit: 'seconds',
      other: 'none',
      queries: [{ expr: q.p95ByEndpoint, legend: byEndpoint }],
    },
    {
      title: 'Ошибки 5xx в секунду',
      explanation: 'Ответы 5xx по эндпоинтам — исключения и сбои внутри приложения.',
      unit: 'rps',
      queries: [{ expr: q.errorsByEndpoint, legend: byEndpoint }],
    },
    {
      title: 'Память процесса',
      explanation: 'Рабочий набор процесса (то, что видит ОС и OOM-killer) и управляемая куча .NET.',
      unit: 'bytes',
      order: ['рабочий набор', 'куча .NET'],
      queries: [
        { expr: q.workingSet, legend: () => 'рабочий набор' },
        { expr: q.managedHeap, legend: () => 'куча .NET' },
      ],
    },
    {
      title: 'CPU процесса',
      explanation: '% одного ядра.',
      unit: 'percent',
      kind: 'area',
      queries: [{ expr: q.cpu, legend: () => 'CPU' }],
    },
    {
      title: 'Сборки мусора',
      explanation: 'Сборок GC в секунду по поколениям. Частые сборки gen 2 — признак давления на память.',
      unit: 'rps',
      order: ['gen 0', 'gen 1', 'gen 2'],
      queries: [{ expr: q.gcByGeneration, legend: (m) => `gen ${m.generation ?? '?'}` }],
    },
    {
      title: 'Запросы в обработке',
      explanation: 'Сколько запросов приложение обрабатывает в момент снятия метрики.',
      unit: 'count',
      queries: [{ expr: q.inProgress, legend: () => 'в обработке' }],
    },
  ];
  if (q.loginsByResult) {
    charts.push({
      title: 'Входы по результату',
      explanation:
        'Попытки входа в минуту: ok — успешные; denied_blocked — заблокирован; invalid — неверная подпись Telegram; ' +
        'replayed — повтор; denied_unregistered — без приглашения; invite_check_failed — неверный код.',
      unit: 'perMin',
      kind: 'stackedArea',
      order: LOGIN_RESULTS,
      colors: LOGIN_COLORS,
      queries: [{ expr: q.loginsByResult, legend: (m) => m.result || '?' }],
    });
  }
  return charts;
}

/** Endpoints over the period: requests, p95, 4xx, 5xx — by requests. */
function EndpointsTable({ service }: { service: AppService }) {
  const q = appQueries(service);
  const exprs = useMemo(
    () => ({ requests: q.totalByEndpoint, p95: q.p95TotalByEndpoint, c4xx: q.total4xxByEndpoint, c5xx: q.total5xxByEndpoint }),
    [q.totalByEndpoint, q.p95TotalByEndpoint, q.total4xxByEndpoint, q.total5xxByEndpoint],
  );
  const { data, error, loading, reload } = useInstant(exprs);
  // Instant vectors: NaN p95 (no traffic) stays out of the map.
  const requests = byLabel(data?.requests, 'endpoint', '');
  const p95 = byLabel(data?.p95, 'endpoint', '');
  const c4xx = byLabel(data?.c4xx, 'endpoint', '');
  const c5xx = byLabel(data?.c5xx, 'endpoint', '');
  const endpoints = [...requests.keys()]
    .filter((e) => (requests.get(e) ?? 0) > 0)
    .sort((a, b) => (requests.get(b) ?? 0) - (requests.get(a) ?? 0) || a.localeCompare(b));

  return (
    <Section title="Эндпоинты за период" description="Запросы, p95 и ошибки по шаблонам маршрутов" padding="none">
      {error && !data ? (
        <ErrorState title="Не удалось загрузить эндпоинты" error={error} onRetry={() => void reload()} compact />
      ) : loading && !data ? (
        <div style={{ padding: 'var(--mvv-sp-5)' }}>
          <Skeleton height={14} mb="sm" />
          <Skeleton height={14} width="60%" />
        </div>
      ) : endpoints.length === 0 ? (
        <EmptyState compact icon={<IconRoute />} title="Запросов нет" description="За период приложение не получило запросов." />
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table className={classes.table} aria-label="Эндпоинты за период">
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Эндпоинт</Table.Th>
                <Table.Th scope="col" className={classes.num}>Запросы</Table.Th>
                <Table.Th scope="col" className={classes.num}>p95</Table.Th>
                <Table.Th scope="col" className={classes.num}>4xx</Table.Th>
                <Table.Th scope="col" className={classes.num}>5xx</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {endpoints.map((e) => (
                <Table.Tr key={e}>
                  <Table.Th scope="row" className={classes.code}>
                    {endpointLabel(e)}
                  </Table.Th>
                  <Table.Td className={classes.num}>{formatValue(Math.round(requests.get(e) ?? 0), 'count')}</Table.Td>
                  <Table.Td className={classes.num}>{formatValue(p95.get(e) ?? null, 'seconds')}</Table.Td>
                  <Table.Td className={classes.num}>{formatValue(Math.round(c4xx.get(e) ?? 0), 'count')}</Table.Td>
                  <Table.Td className={classes.num}>{formatValue(Math.round(c5xx.get(e) ?? 0), 'count')}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Section>
  );
}

/** «Приложения»: prometheus-net metrics of the .NET services, one service at a time. */
export function AppsSection() {
  const [service, setService] = useState<AppService>(APP_SERVICES[0]);
  const isPhone = useMediaQuery('(max-width: 48em)') ?? false;
  const charts = useMemo(() => appCharts(service), [service]);
  const data = APP_SERVICES.map((s) => ({ value: s, label: s }));
  const onChange = (v: string | null) => {
    const found = APP_SERVICES.find((s) => s === v);
    if (found) setService(found);
  };

  return (
    <div className={classes.stack}>
      <div className={classes.controls}>
        {isPhone ? (
          <Select
            className={classes.sectionSelect}
            label="Сервис"
            data={data}
            value={service}
            onChange={onChange}
            allowDeselect={false}
          />
        ) : (
          <SegmentedControl aria-label="Сервис" data={data} value={service} onChange={onChange} />
        )}
      </div>
      <div className={classes.grid}>
        {charts.map((spec, i) => (
          <PromChart key={`${service}-${i}`} {...spec} />
        ))}
      </div>
      <EndpointsTable service={service} />
    </div>
  );
}
