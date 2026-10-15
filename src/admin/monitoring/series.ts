import { chartColors, seriesColor } from '@mvv42/kit/charts';
import { LOG_LEVELS, parseValue, type Labels, type LogHits, type PromSeries } from './api';

/** One PromQL expression of a chart; `legend` names a series from its labels (equal names are summed). */
export interface PromQuery {
  expr: string;
  legend: (metric: Labels) => string;
}

export interface ChartSeries {
  /** Recharts `dataKey` (`s0`, `s1`, …). */
  key: string;
  name: string;
  color: string;
}

/** `t` — milliseconds; series values by key, `null` = no data (a gap). */
export type ChartRow = { t: number } & Record<string, number | null>;

export interface ChartData {
  rows: ChartRow[];
  series: ChartSeries[];
}

export const OTHER_SERIES = 'Другое';

export interface BuildOptions {
  /** Expected point spacing, seconds: a longer jump between points becomes a gap. */
  step: number;
  /** Named series kept; the rest are summed into «Другое». Default 8. */
  maxSeries?: number;
  /** Fixed entity order: decides legend order and colours (`seriesColor(index in order)`), not the response. */
  order?: readonly string[];
  /** Fixed colours by series name (semantic ones: 5xx, error …). */
  colors?: Readonly<Record<string, string>>;
}

function addPoint(points: Map<number, number | null>, ts: number, v: number | null) {
  const prev = points.get(ts);
  if (v === null) {
    if (prev === undefined) points.set(ts, null);
    return;
  }
  points.set(ts, (prev ?? 0) + v);
}

function mean(points: Map<number, number | null>): number {
  let sum = 0;
  let n = 0;
  for (const v of points.values()) {
    if (v === null) continue;
    sum += v;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * VictoriaMetrics matrices (one per query) → Recharts rows. Series are named by `legend` (same name — summed),
 * the top `maxSeries` by mean value are kept and the rest folded into «Другое»; order and colours follow
 * `order` / `colors`, then the name. Missing points stay `null`, and a jump longer than 1.5 steps gets an
 * all-null row so lines break instead of bridging an outage.
 */
export function buildChart(results: PromSeries[][], queries: readonly PromQuery[], options: BuildOptions): ChartData {
  const { step, maxSeries = 8, order = [], colors = {} } = options;
  const named = new Map<string, Map<number, number | null>>();
  results.forEach((matrix, qi) => {
    const legend = queries[qi]?.legend;
    for (const s of matrix) {
      const name = legend ? legend(s.metric) : JSON.stringify(s.metric);
      let points = named.get(name);
      if (!points) named.set(name, (points = new Map()));
      for (const [ts, raw] of s.values) addPoint(points, ts, parseValue(raw));
    }
  });

  let entries = [...named.entries()];
  if (entries.length > maxSeries) {
    entries.sort((a, b) => mean(b[1]) - mean(a[1]));
    const other = new Map<number, number | null>();
    for (const [, points] of entries.slice(maxSeries)) for (const [ts, v] of points) addPoint(other, ts, v);
    entries = [...entries.slice(0, maxSeries), [OTHER_SERIES, other]];
  }

  const rank = (name: string) => {
    if (name === OTHER_SERIES) return Number.MAX_SAFE_INTEGER;
    const i = order.indexOf(name);
    return i === -1 ? order.length : i;
  };
  entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'ru'));

  let free = 0;
  const series: ChartSeries[] = entries.map(([name], i) => {
    let color = colors[name];
    if (!color) {
      if (name === OTHER_SERIES) color = chartColors.other;
      else {
        const fixed = order.indexOf(name);
        // Entities outside `order` take the palette slots after it.
        color = seriesColor(fixed !== -1 ? fixed : order.length + free++);
      }
    }
    return { key: `s${i}`, name, color };
  });

  const stamps = new Set<number>();
  for (const [, points] of entries) for (const ts of points.keys()) stamps.add(ts);
  const sorted = [...stamps].sort((a, b) => a - b);

  const rows: ChartRow[] = [];
  const emptyRow = (ts: number) => {
    const row = { t: ts * 1000 } as ChartRow;
    for (const s of series) row[s.key] = null;
    return row;
  };
  sorted.forEach((ts, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && ts - prev > step * 1.5) rows.push(emptyRow(prev + step));
    const row = emptyRow(ts);
    entries.forEach(([, points], si) => {
      row[series[si].key] = points.get(ts) ?? null;
    });
    rows.push(row);
  });

  return { rows, series };
}

/** `hits` by level → rows `{ t, critical, error, … }` (ms), levels most severe first; unknown levels at the end. */
export function hitsRows(hits: LogHits[]): { rows: Record<string, number>[]; levels: string[] } {
  const byTime = new Map<number, Record<string, number>>();
  const present = new Set<string>();
  for (const h of hits) {
    const level = h.fields?.level || 'unknown';
    present.add(level);
    h.timestamps.forEach((ts, i) => {
      const t = Date.parse(ts);
      if (Number.isNaN(t)) return;
      let row = byTime.get(t);
      if (!row) byTime.set(t, (row = { t }));
      row[level] = (row[level] ?? 0) + (h.values[i] ?? 0);
    });
  }
  const known = LOG_LEVELS.filter((l) => present.has(l)) as string[];
  const levels = [...known, ...[...present].filter((l) => !known.includes(l)).sort()];
  const rows = [...byTime.values()].sort((a, b) => a.t - b.t);
  for (const row of rows) for (const l of levels) row[l] ??= 0;
  return { rows, levels };
}
