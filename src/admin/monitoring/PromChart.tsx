import { useMemo, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame, ChartTooltip, CHART_HEIGHT_COMPACT, useChartTheme } from '@mvv42/kit/charts';
import type { TimeWindow } from './api';
import { timeTicks, valueAxis } from './axis';
import { usePromRange } from './hooks';
import { useMonitoring } from './context';
import { formatAxisTime, formatStamp } from './period';
import { buildChart, chartMax, type ChartData, type PromQuery } from './series';
import { formatValue, type Unit } from './units';

export type ChartKind = 'line' | 'area' | 'stackedArea';

/** A chart declaration: a new chart is one of these, no new code. */
export interface PromChartSpec {
  title: ReactNode;
  /** «?» popover: what the chart shows and how to read it. */
  explanation?: ReactNode;
  queries: readonly PromQuery[];
  unit: Unit;
  kind?: ChartKind;
  /** Named series kept (the rest summed into «Другое», or dropped with `other: 'none'`). Default 8. */
  maxSeries?: number;
  /** `none` for values that don't add up (latencies): series past `maxSeries` are dropped. */
  other?: 'sum' | 'none';
  /** Fixed Y maximum (100 for percentages). */
  yMax?: number;
  /** Fixed entity order for legend and colours (services, CPU modes). */
  order?: readonly string[];
  /** Fixed colours by series name. */
  colors?: Readonly<Record<string, string>>;
  /** Small dashboard chart. */
  compact?: boolean;
}

/** «График по PromQL»: range queries over the current period → line / area / stacked area chart. */
export function PromChart({
  title,
  explanation,
  queries,
  unit,
  kind = 'line',
  maxSeries,
  other,
  yMax,
  order,
  colors,
  compact,
}: PromChartSpec) {
  const exprs = useMemo(() => queries.map((q) => q.expr), [queries]);
  const { data, error, loading, reload } = usePromRange(exprs);
  const chart = useMemo<ChartData | null>(
    () => (data ? buildChart(data.results, queries, { step: data.window.step, maxSeries, other, order, colors }) : null),
    [data, queries, maxSeries, other, order, colors],
  );

  return (
    <ChartFrame
      title={title}
      explanation={explanation}
      height={compact ? CHART_HEIGHT_COMPACT : undefined}
      loading={loading && !data}
      error={!data ? error : undefined}
      onRetry={() => void reload()}
      empty={!!chart && (chart.series.length === 0 || chart.rows.length === 0)}
      emptyDescription="За выбранный период метрик нет."
    >
      {chart && data ? <ChartBody chart={chart} window={data.window} unit={unit} kind={kind} yMax={yMax} /> : <></>}
    </ChartFrame>
  );
}

interface ChartBodyProps {
  chart: ChartData;
  window: TimeWindow;
  unit: Unit;
  kind: ChartKind;
  yMax?: number;
}

/** The Recharts chart inside ChartFrame's ResponsiveContainer (Recharts 3 passes the size by context). */
function ChartBody({ chart, window, unit, kind, yMax }: ChartBodyProps) {
  const theme = useChartTheme();
  const { period } = useMonitoring();
  const startMs = window.start * 1000;
  const endMs = window.end * 1000;
  const y = useMemo(() => valueAxis(chartMax(chart, kind === 'stackedArea'), unit, yMax), [chart, kind, unit, yMax]);
  // Time axis = the whole period: data never stretches and missing stretches stay visible.
  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={[startMs, endMs]}
      allowDataOverflow
      ticks={timeTicks(startMs, endMs, period.axis, theme.maxTicks)}
      tickFormatter={(v: number) => formatAxisTime(v, period.axis)}
      {...theme.xAxis}
      minTickGap={0}
    />
  );
  const yAxis = (
    <YAxis
      domain={[0, y.max]}
      ticks={y.ticks}
      allowDataOverflow={yMax !== undefined}
      tickFormatter={y.format}
      {...theme.yAxis}
      width={unit === 'bytes' || unit === 'bytesPerSec' ? 76 : theme.yAxis.width}
    />
  );
  const tooltip = (
    <Tooltip
      {...theme.tooltip}
      content={
        <ChartTooltip
          labelFormatter={(v) => formatStamp(Number(v))}
          valueFormatter={(v) => formatValue(typeof v === 'number' ? v : null, unit)}
        />
      }
    />
  );
  const showLegend = chart.series.length > 1;
  const common = { data: chart.rows, margin: theme.margin, accessibilityLayer: true };

  if (kind === 'line') {
    return (
      <LineChart {...common}>
        <CartesianGrid {...theme.grid} />
        {xAxis}
        {yAxis}
        {tooltip}
        {showLegend && <Legend {...theme.legend} />}
        {chart.series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            {...theme.line}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  }
  return (
    <AreaChart {...common}>
      <CartesianGrid {...theme.grid} />
      {xAxis}
      {yAxis}
      {tooltip}
      {showLegend && <Legend {...theme.legend} />}
      {chart.series.map((s) => (
        <Area
          key={s.key}
          dataKey={s.key}
          name={s.name}
          stroke={s.color}
          fill={s.color}
          stackId={kind === 'stackedArea' ? 'stack' : undefined}
          {...theme.area}
          fillOpacity={kind === 'stackedArea' ? 0.35 : theme.area.fillOpacity}
          connectNulls={false}
          isAnimationActive={false}
        />
      ))}
    </AreaChart>
  );
}
