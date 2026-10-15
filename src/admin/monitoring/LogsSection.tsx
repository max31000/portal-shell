import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Chip, Group, MultiSelect, Skeleton, Switch, TextInput, UnstyledButton } from '@mantine/core';
import { EmptyState, ErrorState, Section } from '@mvv42/kit';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame, ChartTooltip, CHART_HEIGHT_COMPACT, pickAxisTicks, useChartTheme } from '@mvv42/kit/charts';
import { IconFileText, IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconSearch } from '@tabler/icons-react';
import {
  LOG_LEVELS,
  buildLogFilter,
  buildLogQuery,
  monitoringApi,
  type LogEntry,
  type LogFilters,
  type LogHits,
} from './api';
import { useMonitoring, useMonitoringResource } from './context';
import { LEVEL_BADGE, LEVEL_COLORS } from './entities';
import { formatAxisTime, formatStamp, hitsStep, periodWindow } from './period';
import { hitsRows } from './series';
import { formatValue } from './units';
import { LIVE_LIMIT, useLiveTail, type LiveLine } from './useLiveTail';
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

  const filter = buildLogFilter(filters);
  const query = buildLogQuery(filters);

  const containers = useMonitoringResource(
    useCallback(() => monitoringApi.fieldValues('container', periodWindow(period)), [period]),
    'containers',
  );
  const search = useMonitoringResource(
    useCallback(() => monitoringApi.logs(query, periodWindow(period)), [query, period]),
    `logs\n${query}`,
  );
  const hits = useMonitoringResource(
    useCallback(
      () => monitoringApi.hits(filter, { ...periodWindow(period), step: hitsStep(period) }, 'level'),
      [filter, period],
    ),
    `hits\n${filter}`,
  );
  const tail = useLiveTail(filter, live, paused);

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

  const searchLines: LiveLine[] = useMemo(
    () => (search.data ?? []).map((entry, i) => ({ id: i, entry })),
    [search.data],
  );

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
              placeholder={filters.raw ? 'error OR _msg:~"timeout"' : 'подстрока, без учёта регистра'}
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

      <HitsChart hits={hits.data} loading={hits.loading && !hits.data} error={hits.data ? undefined : hits.error} onRetry={hits.reload} />

      <Section
        title={live ? 'Live' : 'Строки'}
        description={
          live
            ? `Новые сверху, не больше ${LIVE_LIMIT}`
            : `Новые сверху, не больше 500 за ${period.label}`
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
              ) : tail.status === 'reconnecting' ? (
                'Переподключение…'
              ) : (
                'Подключение…'
              )}
            </div>
            {tail.error ? (
              <ErrorState error={tail.error} title="Live недоступен" compact />
            ) : tail.lines.length === 0 ? (
              <EmptyState compact icon={<IconFileText />} title="Ждём новые строки" description="Подходящие строки появятся здесь." />
            ) : (
              <LogList lines={tail.lines} onContainer={(c) => set({ containers: [c] })} />
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
          <LogList lines={searchLines} onContainer={(c) => set({ containers: [c] })} />
        )}
      </Section>
    </div>
  );
}

// ---------- List ----------

const LONG_LINES = 3;
const LONG_CHARS = 360;

function LogList({ lines, onContainer }: { lines: LiveLine[]; onContainer: (container: string) => void }) {
  return (
    <ul className={classes.logList} aria-label="Строки логов">
      {lines.map((l) => (
        <LogLine key={l.id} entry={l.entry} onContainer={onContainer} />
      ))}
    </ul>
  );
}

function LogLine({ entry, onContainer }: { entry: LogEntry; onContainer: (container: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const msg = String(entry._msg ?? '');
  const long = msg.split('\n').length > LONG_LINES || msg.length > LONG_CHARS;
  const level = entry.level || 'info';
  const badge = LEVEL_BADGE[level] ?? { color: 'gray', variant: 'light' as const };
  const ms = Date.parse(entry._time);

  return (
    <li className={classes.logLine}>
      <time className={classes.logTime} dateTime={entry._time}>
        {Number.isNaN(ms) ? entry._time : formatStamp(ms, true)}
      </time>
      <Badge color={badge.color} variant={badge.variant} size="sm" radius="sm">
        {level}
      </Badge>
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
        <pre className={classes.logMsg} data-collapsed={long && !expanded}>
          {msg}
        </pre>
        {long && (
          <UnstyledButton className={`${classes.expand} mvv-text-link`} onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? 'Свернуть' : 'Показать полностью'}
          </UnstyledButton>
        )}
      </div>
    </li>
  );
}

// ---------- Histogram ----------

interface HitsChartProps {
  hits: LogHits[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

function HitsChart({ hits, loading, error, onRetry }: HitsChartProps) {
  const theme = useChartTheme({ height: CHART_HEIGHT_COMPACT - 60 });
  const { period } = useMonitoring();
  const { rows, levels } = useMemo(() => hitsRows(hits ?? []), [hits]);
  return (
    <ChartFrame
      title="Строк по уровням"
      explanation="Сколько строк логов за каждый интервал периода, по уровню. Уровень определяет Vector по тексту строки."
      height={CHART_HEIGHT_COMPACT - 60}
      loading={loading}
      error={error ?? undefined}
      onRetry={() => void onRetry()}
      empty={!loading && rows.length === 0}
      emptyDescription="За период подходящих строк нет."
    >
      <BarChart data={rows} margin={theme.margin} accessibilityLayer>
        <CartesianGrid {...theme.grid} />
        <XAxis
          dataKey="t"
          ticks={pickAxisTicks(
            rows.map((r) => r.t),
            theme.maxTicks,
          )}
          tickFormatter={(v: number) => formatAxisTime(v, period.axis)}
          {...theme.xAxis}
        />
        <YAxis allowDecimals={false} tickFormatter={(v: number) => formatValue(v, 'count')} {...theme.yAxis} />
        <Tooltip
          {...theme.barTooltip}
          content={
            <ChartTooltip
              labelFormatter={(v) => formatStamp(Number(v))}
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
            maxBarSize={theme.bar.maxBarSize}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
