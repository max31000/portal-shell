/**
 * Client of the monitoring proxy (`/monitoring/api`, nginx, owner only, GET only) — spec
 * `mvv42-infra/docs/specs/2026-10-16-monitoring-ui.md`. Responses are the upstreams' own: VictoriaMetrics
 * (`/metrics/*`, Prometheus API), VictoriaLogs (`/logs/*`, LogsQL; `query` and `tail` answer NDJSON) and vmalert
 * (`/alerts`). JSON goes through the admin `apiJson` (cookies, one refresh, 401/403 → auth lost); NDJSON through
 * the kit's `mvv42Fetch` with the same auth-lost routing.
 */
import { ApiError, mvv42Fetch } from '@mvv42/kit/platform';
import { apiJson, reportAuthLost } from '../api';

export const MONITORING_API = '/monitoring/api';

export type Labels = Record<string, string>;

/** Instant vector element: `value` is `[unix seconds, "number"]`. */
export interface PromSample {
  metric: Labels;
  value: [number, string];
}

/** Range matrix element: `values` are `[unix seconds, "number"]`, ascending. */
export interface PromSeries {
  metric: Labels;
  values: [number, string][];
}

interface PromResponse<R> {
  status?: string;
  data?: { resultType?: string; result?: R[] };
  error?: string;
}

/** A range request window, unix seconds. */
export interface TimeWindow {
  start: number;
  end: number;
  step: number;
}

/** One line of `/logs/query` or `/logs/tail` (fields the UI reads; others are kept). */
export interface LogEntry {
  _time: string;
  _msg: string;
  _stream?: string;
  container?: string;
  level?: string;
  [field: string]: unknown;
}

export interface LogHits {
  fields: Labels;
  timestamps: string[];
  values: number[];
  total?: number;
}

export interface FieldValue {
  value: string;
  hits: number;
}

export type AlertState = 'firing' | 'pending' | 'inactive';

export interface Alert {
  name: string;
  state: AlertState;
  labels: Labels;
  annotations: { summary?: string; [key: string]: string | undefined };
  activeAt: string;
  value: string;
}

/** `"1.5"` → 1.5; `NaN`, `±Inf`, junk → null (a gap, never a zero). */
export function parseValue(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `rate()` window of a range query: `max(step * 2, 2m)` in seconds (`"120s"`). */
export function rateWindow(step: number): string {
  return `${Math.max(Math.round(step * 2), 120)}s`;
}

/** `rate()` window of an instant query. */
export const INSTANT_RATE = '5m';

/**
 * Fills the query placeholders: `$__rate` — the `rate()` window, `$__range` — the whole period (for
 * `increase(…[$__range])` totals). Expressions are declared once with placeholders and expanded per request.
 */
export function expandQuery(expr: string, vars: { rate: string; range: string }): string {
  return expr.replaceAll('$__rate', vars.rate).replaceAll('$__range', vars.range);
}

function promResult<R>(body: PromResponse<R> | undefined): R[] {
  if (!body || body.status !== 'success' || !body.data || !Array.isArray(body.data.result)) {
    throw new Error(body?.error ? `VictoriaMetrics: ${body.error}` : 'VictoriaMetrics вернул неожиданный ответ');
  }
  return body.data.result;
}

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  return q.toString();
}

/** NDJSON text → objects; empty and unparsable lines (a torn last line) are skipped. */
export function parseNdjson<T = LogEntry>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      /* torn or non-JSON line */
    }
  }
  return out;
}

/** `mvv42Fetch` + `ApiError` on non-2xx (401/403 also reach the auth-lost handler). */
async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await mvv42Fetch(url, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error('Нет связи с сервером');
  }
  if (!response.ok) {
    const error = new ApiError(response.status, null, response.statusText || `HTTP ${response.status}`);
    reportAuthLost(error);
    throw error;
  }
  return response;
}

const NDJSON = { Accept: 'application/x-ndjson, application/json;q=0.9' };

export const monitoringApi = {
  /** Instant query (`time` omitted = now). */
  query: async (query: string, time?: number): Promise<PromSample[]> =>
    promResult(await apiJson<PromResponse<PromSample>>(`${MONITORING_API}/metrics/query?${qs({ query, time })}`)),

  queryRange: async (query: string, w: TimeWindow): Promise<PromSeries[]> =>
    promResult(
      await apiJson<PromResponse<PromSeries>>(
        `${MONITORING_API}/metrics/query_range?${qs({ query, start: w.start, end: w.end, step: w.step })}`,
      ),
    ),

  labelValues: async (name: string): Promise<string[]> => {
    const body = await apiJson<{ data?: string[] }>(`${MONITORING_API}/metrics/label/${encodeURIComponent(name)}/values`);
    return Array.isArray(body?.data) ? body.data : [];
  },

  /** LogsQL query → entries in the server's order. */
  logs: async (query: string, w: { start: number; end: number; limit?: number }): Promise<LogEntry[]> => {
    const response = await fetchOk(
      `${MONITORING_API}/logs/query?${qs({ query, limit: w.limit, start: w.start, end: w.end })}`,
      { headers: NDJSON },
    );
    return parseNdjson<LogEntry>(await response.text());
  },

  /** Line counts per `field` value in `step` buckets. */
  hits: async (query: string, w: { start: number; end: number; step: string }, field = 'level'): Promise<LogHits[]> => {
    const body = await apiJson<{ hits?: LogHits[] }>(
      `${MONITORING_API}/logs/hits?${qs({ query, start: w.start, end: w.end, step: w.step, field })}`,
    );
    return Array.isArray(body?.hits) ? body.hits : [];
  },

  fieldValues: async (field: string, w: { start: number; end: number }, query = '*'): Promise<FieldValue[]> => {
    const body = await apiJson<{ values?: FieldValue[] }>(
      `${MONITORING_API}/logs/field_values?${qs({ query, field, start: w.start, end: w.end })}`,
    );
    return Array.isArray(body?.values) ? body.values : [];
  },

  alerts: async (): Promise<Alert[]> => {
    const body = await apiJson<{ data?: { alerts?: Alert[] } }>(`${MONITORING_API}/alerts`);
    return Array.isArray(body?.data?.alerts) ? body.data.alerts : [];
  },
};

/**
 * Follows `/logs/tail` until the server closes it (VictoriaLogs ends a tail within 10 min) or `signal` aborts;
 * `onOpen` fires once the server accepted the stream, every complete NDJSON line goes to `onEntry`. Resolves on a normal end, rejects on errors (the caller
 * reconnects).
 */
export async function tailLogs(
  query: string,
  onEntry: (entry: LogEntry) => void,
  signal: AbortSignal,
  onOpen?: () => void,
): Promise<void> {
  const response = await fetchOk(`${MONITORING_API}/logs/tail?${qs({ query })}`, { headers: NDJSON, signal });
  onOpen?.();
  if (!response.body) {
    parseNdjson<LogEntry>(await response.text()).forEach(onEntry);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', onAbort);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) return;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) parseNdjson<LogEntry>(line).forEach(onEntry);
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseNdjson<LogEntry>(buffer).forEach(onEntry);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// ---------- LogsQL ----------

/** Levels the Vector pipeline writes (`level` field), most severe first. */
export const LOG_LEVELS = ['critical', 'error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** A LogsQL quoted string: backslash and double quote escaped. */
export function logsqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface LogFilters {
  containers: string[];
  levels: string[];
  text: string;
  /** `text` is raw LogsQL instead of a case-insensitive phrase. */
  raw: boolean;
}

/** Filters → a LogsQL filter expression (`*` when nothing is set); no pipes. */
export function buildLogFilter({ containers, levels, text, raw }: LogFilters): string {
  const parts: string[] = [];
  if (containers.length > 0) parts.push(`container:in(${containers.map(logsqlString).join(', ')})`);
  if (levels.length > 0) parts.push(`level:in(${levels.map(logsqlString).join(', ')})`);
  const t = text.trim();
  if (t) {
    if (!raw) parts.push(`i(${logsqlString(t)})`);
    // Raw LogsQL as is; wrapped when combined with other filters so its `or` keeps its meaning (pipes can't be).
    else parts.push(parts.length > 0 && !t.includes('|') ? `(${t})` : t);
  }
  return parts.length > 0 ? parts.join(' ') : '*';
}

/** Max lines of a search. */
export const LOG_LIMIT = 500;

/** The search query: newest first, at most `LOG_LIMIT` lines. */
export function buildLogQuery(filters: LogFilters): string {
  return `${buildLogFilter(filters)} | sort by (_time desc) | limit ${LOG_LIMIT}`;
}
