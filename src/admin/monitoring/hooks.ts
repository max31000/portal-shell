import { useCallback } from 'react';
import {
  expandQuery,
  INSTANT_RATE,
  monitoringApi,
  rateWindow,
  type Alert,
  type PromSample,
  type PromSeries,
  type TimeWindow,
} from './api';
import { useMonitoring, useMonitoringResource } from './context';
import { periodWindow } from './period';

export interface RangeData {
  /** One matrix per expression, in order. */
  results: PromSeries[][];
  window: TimeWindow;
}

/**
 * `query_range` of `exprs` over the current period (`usePromQuery` of the spec). `$__rate` / `$__range` are
 * expanded per request; the window ends at the moment of the (re)load.
 */
export function usePromRange(exprs: readonly string[]) {
  const { period } = useMonitoring();
  const key = exprs.join('\n');
  const load = useCallback(async (): Promise<RangeData> => {
    const window = periodWindow(period);
    const vars = { rate: rateWindow(window.step), range: period.value };
    const results = await Promise.all(key.split('\n').map((e) => monitoringApi.queryRange(expandQuery(e, vars), window)));
    return { results, window };
  }, [key, period]);
  return useMonitoringResource(load, `range\n${key}`);
}

/**
 * Instant queries by name (`{ cpu: '…', mem: '…' }`) → vectors by the same names. `$__rate` = 5m, `$__range` =
 * the period.
 */
export function useInstant<K extends string>(exprs: Readonly<Record<K, string>>) {
  const { period } = useMonitoring();
  const key = JSON.stringify(exprs);
  const load = useCallback(async (): Promise<Record<K, PromSample[]>> => {
    const parsed = JSON.parse(key) as Record<K, string>;
    const vars = { rate: INSTANT_RATE, range: period.value };
    const names = Object.keys(parsed) as K[];
    const vectors = await Promise.all(names.map((n) => monitoringApi.query(expandQuery(parsed[n], vars))));
    return Object.fromEntries(names.map((n, i) => [n, vectors[i]])) as Record<K, PromSample[]>;
  }, [key, period]);
  return useMonitoringResource(load, `instant\n${key}`);
}

/** First sample's value of a vector (scalar-like results); null when empty. */
export function scalarOf(vector: PromSample[] | undefined): number | null {
  const raw = vector?.[0]?.value?.[1];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Vector → value by one label (`name`, `service`). */
export function byLabel(vector: PromSample[] | undefined, label: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of vector ?? []) {
    const k = s.metric[label];
    const n = Number(s.value?.[1]);
    if (k !== undefined && Number.isFinite(n)) out.set(k, (out.get(k) ?? 0) + n);
  }
  return out;
}

const STATE_RANK: Record<string, number> = { firing: 0, pending: 1 };

/** Active alerts (firing, then pending; newest first within a state). */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return alerts
    .filter((a) => a.state === 'firing' || a.state === 'pending')
    .sort(
      (a, b) =>
        (STATE_RANK[a.state] ?? 2) - (STATE_RANK[b.state] ?? 2) ||
        Date.parse(b.activeAt || '') - Date.parse(a.activeAt || '') ||
        a.name.localeCompare(b.name),
    );
}

export function useAlerts() {
  const load = useCallback(async () => sortAlerts(await monitoringApi.alerts()), []);
  return useMonitoringResource(load, 'alerts');
}
