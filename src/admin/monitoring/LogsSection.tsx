import { memo, useCallback, useId, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Chip, Group, MultiSelect, Skeleton, Switch, TextInput, UnstyledButton } from '@mantine/core';
import { EmptyState, ErrorState, Section } from '@mvv42/kit';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame, ChartTooltip, CHART_HEIGHT_COMPACT, useChartTheme } from '@mvv42/kit/charts';
import { IconFileText, IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconSearch } from '@tabler/icons-react';
import {
  LOG_LEVELS,
  LOG_LIMIT,
  buildLogQuery,
  buildTailQuery,
  logQueryParts,
  monitoringApi,
  utcOffset,
  type LogEntry,
  type LogFilters,
  type LogHits,
} from './api';
import { timeTicks, valueAxis } from './axis';
import { useMonitoring, useMonitoringResource } from './context';
import { LEVEL_BADGE, LEVEL_COLORS } from './entities';
import { formatAxisTime, formatStamp, periodWindow } from './period';
import { hitsRows } from './series';
import { formatValue } from './units';
import { LIVE_LIMIT, keyLines, useLiveTail, type LogLineItem } from './useLiveTail';
import classes from './Monitoring.module.css';

interface LogsSectionProps {
  filters: LogFilters;
  onFiltersChange: (filters: LogFilters) => void;
}

/** «Логи»: LogsQL search over the period (≤ 500 newest lines), a histogram by level and a live tail. */
export function LogsSection({ filters, onFiltersChange }: LogsSectionProps) {
  const { period } = useMonitoring();
  const [draft, setDraft] = useState(filters.text);
  const [draftFor, setDraftFor] = useState(filters.text);
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);

  // The text box follows filters set from outside (a «Логи» link resets it).
  if (draftFor !== filters.text) {
    setDraftFor(filters.text);
    setDraft(filters.text);
  }

  const { filter } = logQueryParts(filters);
  const query = buildLogQuery(filters);
  const tailQuery = buildTailQuery(filters);
  // Live shows the stream: the search and the histogram keep what they have instead of refreshing.
  const frozen = { frozen: live };

  const containers = useMonitoringResource(
    useCallback(
      (signal: AbortSignal) => monitoringApi.fieldValues('container', periodWindow(period), '*', signal),
      [period],
    ),
    'containers',
    frozen,
  );
  const search = useMonitoringResource(
    useCallback((signal: AbortSignal) => monitoringApi.logs(query, periodWindow(period), signal), [query, period]),
    `logs\n${query}`,
    frozen,
  );
  const hits = useMonitoringResource(
    useCallback(
      async (signal: AbortSignal) => {
        const window = periodWindow(period);
        const offset = utcOffset();
        const data = await monitoringApi.hits(filter, { ...window, step: `${period.hitsStep}s`, offset }, 'level', signal);
        return { data, window: { ...window, step: period.hitsStep, offset: parseInt(offset, 10) } };
      },
      [filter, period],
    ),
    `hits\n${filter}`,
    frozen,
  );
  const tail = useLiveTail(tailQuery.query, live, paused);

  const containerOptions = useMemo(() => {
    const names = new Set((containers.data ?? []).map((v) => v.value).filter(Boolean));
    filters.containers.forEach((c) => names.add(c));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [containers.data, filters.containers]);

  const set = (patch: Partial<LogFilters>) => onFiltersChange({ ...filters, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ text: draft });
  };
  const onContainer = useCallback(
    (container: string) => onFiltersChange({ ...filters, containers: [container] }),
    [filters, onFiltersChange],
  );

  const searchLines = useMemo(() => keyLines(search.data ?? []), [search.data]);

  return (
    <div className={classes.stack}>
      <Section padding="md" title="Фильтры">
        <form className={classes.filters} onSubmit={submit} role="search" aria-label="Поиск по логам">
          <div className={classes.filterRow}>
            <MultiSelect
              className={classes.containers}
              label="Контейнеры"
              placeholder={filters.containers.length ? undefined : 'Все'}
              data={containerOptions}
              value={filters.containers}
              onChange={(v) => set({ containers: v })}
              searchable
              clearable
              nothingFoundMessage="Нет такого контейнера"
              comboboxProps={{ withinPortal: true }}
            />
            <TextInput
              className={classes.search}
              label={filters.raw ? 'Запрос LogsQL' : 'Текст'}
              placeholder={filters.raw ? 'error OR _msg:~"timeout" | fields _time, _msg' : 'подстрока, без учёта регистра'}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              leftSection={<IconSearch size={16} />}
              styles={{ input: filters.raw ? { fontFamily: 'var(--mvv-font-mono)' } : undefined }}
            />
            <Button type="submit" variant="default">
              Найти
            </Button>
          </div>
          <Group gap="md" wrap="wrap">
            <Chip.Group multiple value={filters.levels} onChange={(v) => set({ levels: v })}>
              <Group gap={6} role="group" aria-label="Уровни">
                {LOG_LEVELS.map((l) => (
                  <Chip key={l} value={l} size="xs" variant="light">
                    {l}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            <Switch
              size="sm"
              label="LogsQL"
              checked={filters.raw}
              onChange={(e) => set({ raw: e.currentTarget.checked, text: draft })}
              aria-label="Текст — запрос LogsQL как есть"
            />
          </Group>
        </form>
      </Section>

      <HitsChart
        hits={hits.data?.data}
        window={hits.data?.window}
        loading={hits.loading && !hits.data}
        error={hits.data ? undefined : hits.error}
        onRetry={() => void hits.reload()}
      />

      <Section
        title={live ? 'Live' : 'Строки'}
        description={
          live ? `Новые сверху, не больше ${LIVE_LIMIT}` : `Новые сверху, не больше ${LOG_LIMIT} за ${period.label}`
        }
        padding="none"
        actions={
          <Group gap="xs">
            {live && (
              <Button
                variant="default"
                size="xs"
                leftSection={paused ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? `Продолжить${tail.buffered ? ` (+${tail.buffered})` : ''}` : 'Пауза'}
              </Button>
            )}
            <Button
              variant={live ? 'light' : 'default'}
              color={live ? 'red' : undefined}
              size="xs"
              leftSection={live ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
              onClick={() => {
                setLive((l) => !l);
                setPaused(false);
              }}
              aria-pressed={live}
            >
              {live ? 'Остановить' : 'Live'}
            </Button>
          </Group>
        }
      >
        {live ? (
          <>
            <div className={classes.liveBar} style={{ padding: 'var(--mvv-sp-3) var(--mvv-sp-4)' }} role="status">
              {tail.error ? (
                'Поток остановлен'
              ) : tail.status === 'open' ? (
                <>
                  <Badge color="green" variant="dot" size="sm">
                    Подключено
                  </Badge>
                  {paused && 'Пауза — новые строки копятся'}
                </>
              ) : tail.status === 'hidden' ? (
                'Вкладка скрыта — поток на паузе'
              ) : tail.status === 'reconnecting' ? (
                'Переподключение…'
              ) : (
                'Подключение…'
              )}
              {tailQuery.dropped && (
                <span className={classes.muted}>
                  Live не поддерживает stats / sort / limit — пайпы запроса не применяются: {tailQuery.dropped}
                </span>
              )}
            </div>
            {tail.error ? (
              <ErrorState error={tail.error} title="Live недоступен" compact />
            ) : tail.lines.length === 0 ? (
              <EmptyState compact icon={<IconFileText />} title="Ждём новые строки" description="Подходящие строки появятся здесь." />
            ) : (
              <LogList lines={tail.lines} onContainer={onContainer} />
            )}
          </>
        ) : search.error && !search.data ? (
          <ErrorState title="Не удалось загрузить логи" error={search.error} onRetry={() => void search.reload()} compact />
        ) : search.loading && !search.data ? (
          <div style={{ padding: 'var(--mvv-sp-5)' }}>
            <Skeleton height={14} mb="sm" />
            <Skeleton height={14} mb="sm" />
            <Skeleton height={14} width="60%" />
          </div>
        ) : searchLines.length === 0 ? (
          <EmptyState compact icon={<IconFileText />} title="Ничего не найдено" description="Измените фильтры или период." />
        ) : (
          <LogList lines={searchLines} onContainer={onContainer} />
        )}
      </Section>
    </div>
  );
}

// ---------- List ----------

const LONG_LINES = 3;
const LONG_CHARS = 360;

function LogList({ lines, onContainer }: { lines: LogLineItem[]; onContainer: (container: string) => void }) {
  return (
    <ul className={classes.logList} aria-label="Строки логов">
      {lines.map((l) => (
        <LogLine key={l.key} entry={l.entry} onContainer={onContainer} />
      ))}
    </ul>
  );
}

/** One line; memoised — a live flush re-renders only the new lines. */
const LogLine = memo(function LogLine({
  entry,
  onContainer,
}: {
  entry: LogEntry;
  onContainer: (container: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const msgId = useId();
  const msg = String(entry._msg ?? '');
  const long = msg.split('\n').length > LONG_LINES || msg.length > LONG_CHARS;
  const level = entry.level ? String(entry.level) : '';
  const badge = LEVEL_BADGE[level] ?? { color: 'gray', variant: 'light' as const };
  const ms = Date.parse(entry._time);

  return (
    <li className={classes.logLine}>
      <time className={classes.logTime} dateTime={entry._time}>
        {Number.isNaN(ms) ? entry._time : formatStamp(ms, true)}
      </time>
      {level ? (
        <Badge color={badge.color} variant={badge.variant} size="sm" radius="sm">
          {level}
        </Badge>
      ) : (
        <span className={classes.muted} title="Уровень не определён">
          —
        </span>
      )}
      {entry.container ? (
        <UnstyledButton
          className={classes.logContainer}
          onClick={() => onContainer(String(entry.container))}
          title={`Только ${entry.container}`}
        >
          {entry.container}
        </UnstyledButton>
      ) : (
        <span className={classes.logContainer}>—</span>
      )}
      <div className={classes.logMsgCell}>
        <pre id={msgId} className={classes.logMsg} data-collapsed={long && !expanded}>
          {msg}
        </pre>
        {long && (
          <UnstyledButton
            className={`${classes.expand} mvv-text-link`}
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-controls={msgId}
          >
            {expanded ? 'Свернуть' : 'Показать полностью'}
          </UnstyledButton>
        )}
      </div>
    </li>
  );
});

// ---------- Histogram ----------

interface HitsChartProps {
  hits: LogHits[] | undefined;
  window: { start: number; end: number; step: number; offset: number } | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

function HitsChart({ hits, window, loading, error, onRetry }: HitsChartProps) {
  const height = CHART_HEIGHT_COMPACT - 60;
  const theme = useChartTheme({ height });
  const { period } = useMonitoring();
  const { rows, levels } = useMemo(
    () => (window ? hitsRows(hits ?? [], window) : { rows: [], levels: [] }),
    [hits, window],
  );
  const total = useMemo(() => rows.reduce((sum, r) => sum + levels.reduce((s, l) => s + (r[l] ?? 0), 0), 0), [rows, levels]);
  const y = useMemo(() => {
    let max = 0;
    for (const r of rows) max = Math.max(max, levels.reduce((s, l) => s + (r[l] ?? 0), 0));
    return valueAxis(max, 'count', undefined, 4);
  }, [rows, levels]);
  const startMs = (window?.start ?? 0) * 1000;
  const endMs = (window?.end ?? 0) * 1000;
  // Bars are centred in their bucket; the axis spans the whole period.
  const half = ((window?.step ?? 0) * 1000) / 2;
  const data = useMemo(() => rows.map((r) => ({ ...r, x: r.t + half })), [rows, half]);

  return (
    <ChartFrame
      title="Строк по уровням"
      explanation="Сколько строк логов за каждый интервал периода, по уровню. Уровень определяет Vector по тексту строки."
      height={height}
      loading={loading}
      error={error ?? undefined}
      onRetry={onRetry}
      empty={!loading && total === 0}
      emptyDescription="За период подходящих строк нет."
    >
      <BarChart data={data} margin={theme.margin} accessibilityLayer barCategoryGap={1}>
        <CartesianGrid {...theme.grid} />
        <XAxis
          dataKey="x"
          type="number"
          scale="time"
          domain={[startMs, endMs]}
          allowDataOverflow
          ticks={timeTicks(startMs, endMs, period.axis, theme.maxTicks)}
          tickFormatter={(v: number) => formatAxisTime(v, period.axis)}
          {...theme.xAxis}
          minTickGap={0}
        />
        <YAxis domain={[0, y.max]} ticks={y.ticks} tickFormatter={y.format} {...theme.yAxis} />
        <Tooltip
          {...theme.barTooltip}
          content={
            <ChartTooltip
              labelFormatter={(v) => formatStamp(Number(v) - half)}
              valueFormatter={(v) => formatValue(typeof v === 'number' ? v : null, 'count')}
            />
          }
        />
        <Legend {...theme.legend} />
        {levels.map((l, i) => (
          <Bar
            key={l}
            dataKey={l}
            name={l}
            stackId="levels"
            fill={LEVEL_COLORS[l] ?? 'var(--mvv-text-3)'}
            radius={i === levels.length - 1 ? theme.bar.radius : undefined}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
