import type { Labels } from './api';
import { legend } from './entities';
import { PromChart, type PromChartSpec } from './PromChart';
import classes from './Monitoring.module.css';

const CPU_MODES = ['user', 'system', 'iowait', 'steal'];
const CPU_ORDER = [...CPU_MODES, 'прочее'];

/** Share of all CPU time, %. Modes outside the main four fold into «прочее» (equal legends are summed). */
const CPU_BY_MODE: PromChartSpec = {
  title: 'CPU по режимам',
  explanation:
    'Доля времени всех ядер, %. user — программы, system — ядро ОС, iowait — ожидание диска, steal — время, ' +
    'отнятое гипервизором у виртуалки. Высокий steal — проблема хостинга, не сервера.',
  unit: 'percent',
  kind: 'stackedArea',
  yMax: 100,
  order: CPU_ORDER,
  queries: [
    {
      expr:
        '100 * sum by (mode) (rate(node_cpu_seconds_total{mode!="idle"}[$__rate]))' +
        ' / scalar(sum(rate(node_cpu_seconds_total[$__rate])))',
      legend: (m: Labels) => (CPU_MODES.includes(m.mode) ? m.mode : 'прочее'),
    },
  ],
};

const SERVER_CHARTS: PromChartSpec[] = [
  CPU_BY_MODE,
  {
    title: 'Load average',
    explanation: 'Среднее число готовых к работе процессов за 1, 5 и 15 минут. Больше числа ядер — очередь на CPU.',
    unit: 'count',
    order: ['1 мин', '5 мин', '15 мин'],
    queries: [
      { expr: 'node_load1', legend: legend.fixed('1 мин') },
      { expr: 'node_load5', legend: legend.fixed('5 мин') },
      { expr: 'node_load15', legend: legend.fixed('15 мин') },
    ],
  },
  {
    title: 'Память',
    explanation:
      'Занято — программами (всего − доступно). Доступно — сколько можно отдать программам без свопа; ' +
      'в него входит большая часть кэша и буферов, поэтому линии не складываются.',
    unit: 'bytes',
    order: ['занято', 'кэш + буферы', 'доступно'],
    queries: [
      { expr: 'node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes', legend: legend.fixed('занято') },
      { expr: 'node_memory_Cached_bytes + node_memory_Buffers_bytes', legend: legend.fixed('кэш + буферы') },
      { expr: 'node_memory_MemAvailable_bytes', legend: legend.fixed('доступно') },
    ],
  },
  {
    title: 'Диск / — занято',
    explanation: 'Заполненность корневого раздела. Алерт — когда свободно меньше 15%.',
    unit: 'percent',
    kind: 'area',
    yMax: 100,
    queries: [
      {
        expr: '100 * (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})',
        legend: legend.fixed('занято'),
      },
    ],
  },
  {
    title: 'Диск: чтение и запись',
    explanation: 'Байт в секунду по всем дискам.',
    unit: 'bytesPerSec',
    order: ['чтение', 'запись'],
    queries: [
      { expr: 'sum(rate(node_disk_read_bytes_total[$__rate]))', legend: legend.fixed('чтение') },
      { expr: 'sum(rate(node_disk_written_bytes_total[$__rate]))', legend: legend.fixed('запись') },
    ],
  },
  {
    title: 'Сеть',
    explanation: 'Байт в секунду по внешним интерфейсам (veth, docker и lo исключены). Включает трафик VPN.',
    unit: 'bytesPerSec',
    order: ['приём', 'передача'],
    queries: [
      { expr: 'sum(rate(node_network_receive_bytes_total[$__rate]))', legend: legend.fixed('приём') },
      { expr: 'sum(rate(node_network_transmit_bytes_total[$__rate]))', legend: legend.fixed('передача') },
    ],
  },
  {
    title: 'Conntrack — заполнение',
    explanation:
      'Таблица отслеживаемых соединений ядра. При 100% новые соединения (и VPN) отбрасываются; алерт — с 80%.',
    unit: 'percent',
    kind: 'area',
    yMax: 100,
    queries: [
      { expr: '100 * node_nf_conntrack_entries / node_nf_conntrack_entries_limit', legend: legend.fixed('заполнено') },
    ],
  },
];

export function ServerSection() {
  return (
    <div className={classes.grid}>
      {SERVER_CHARTS.map((spec, i) => (
        <PromChart key={i} {...spec} />
      ))}
    </div>
  );
}
