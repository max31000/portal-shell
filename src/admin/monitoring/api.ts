/**
 * Client of the monitoring proxy (`/monitoring/api`, nginx, owner only, GET only) — spec
 * `mvv42-infra/docs/specs/2026-10-16-monitoring-ui.md`. Responses are the upstreams' own: VictoriaMetrics
 * (`/metrics/*`, Prometheus API), VictoriaLogs (`/logs/*`, LogsQL; `query` and `tail` answer NDJSON) and vmalert
 * (`/alerts`). JSON goes through the kit's `apiJson`, NDJSON through `mvv42Fetch` (cookies, one refresh on 401);
 * a failure reaches the admin auth-lost handler only when the session / ownership is really gone (`checkAuthLost`).
 * Every call takes an optional `AbortSignal`.
 */
import { ApiError, apiJson as kitApiJson, isApiError, mvv42Fetch } from '@mvv42/kit/platform';
import { reportAuthLost } from '../api';

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

// ---------- Auth ----------

/** Owner check behind the nginx gate (204 for the owner). */
export const OWNER_CHECK = '/auth/api/admin/check';

let ownerCheck: Promise<void> | null = null;

/**
 * Decides whether a failed monitoring call means the session / ownership is gone. A 401 has already survived the
 * kit's refresh → lost. A 403 is ambiguous (nginx also denies paths outside its allow-list), so it is confirmed by
 * `GET /auth/api/admin/check`: only 401/403 there → lost; otherwise the caller just shows its ErrorState.
 * Concurrent 403s share one check.
 */
export async function checkAuthLost(error: unknown): Promise<void> {
  if (!isApiError(error)) return;
  if (error.status === 401) {
    reportAuthLost(error);
    return;
  }
  if (error.status !== 403) return;
  if (!ownerCheck) {
    ownerCheck = (async () => {
      try {
        const r = await mvv42Fetch(OWNER_CHECK, { headers: { Accept: 'application/json' } });
        if (r.status === 401 || r.status === 403) reportAuthLost(new ApiError(r.status, null, `HTTP ${r.status}`));
      } catch {
        /* offline: not an auth loss */
      }
    })().finally(() => {
      ownerCheck = null;
    });
  }
  await ownerCheck;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    return await kitApiJson<T>(url, signal ? { signal } : undefined);
  } catch (error) {
    if (!signal?.aborted) await checkAuthLost(error);
    throw error;
  }
}

/** `mvv42Fetch` + `ApiError` on non-2xx (with the same auth-lost rules as JSON calls). */
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
    await checkAuthLost(error);
    throw error;
  }
  return response;
}

const NDJSON = { Accept: 'application/x-ndjson, application/json;q=0.9' };

/** Hits window: bucket `step` and `offset` (the browser's UTC offset, so days start at local midnight). */
export interface HitsWindow {
  start: number;
  end: number;
  step: string;
  offset?: string;
}

/** The browser's UTC offset as a VictoriaLogs duration (`10800s` for UTC+3). */
export function utcOffset(date: Date = new Date()): string {
  return `${-date.getTimezoneOffset() * 60}s`;
}

export const monitoringApi = {
  /** Instant query (`time` omitted = now). */
  query: async (query: string, time?: number, signal?: AbortSignal): Promise<PromSample[]> =>
    promResult(await getJson<PromResponse<PromSample>>(`${MONITORING_API}/metrics/query?${qs({ query, time })}`, signal)),

  queryRange: async (query: string, w: TimeWindow, signal?: AbortSignal): Promise<PromSeries[]> =>
    promResult(
      await getJson<PromResponse<PromSeries>>(
        `${MONITORING_API}/metrics/query_range?${qs({ query, start: w.start, end: w.end, step: w.step })}`,
        signal,
      ),
    ),

  labelValues: async (name: string, signal?: AbortSignal): Promise<string[]> => {
    const body = await getJson<{ data?: string[] }>(
      `${MONITORING_API}/metrics/label/${encodeURIComponent(name)}/values`,
      signal,
    );
    return Array.isArray(body?.data) ? body.data : [];
  },

  /** LogsQL query → entries in the server's order. */
  logs: async (
    query: string,
    w: { start: number; end: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<LogEntry[]> => {
    const response = await fetchOk(
      `${MONITORING_API}/logs/query?${qs({ query, limit: w.limit, start: w.start, end: w.end })}`,
      { headers: NDJSON, signal },
    );
    return parseNdjson<LogEntry>(await response.text());
  },

  /** Line counts per `field` value in `step` buckets (aligned with `offset`). */
  hits: async (query: string, w: HitsWindow, field = 'level', signal?: AbortSignal): Promise<LogHits[]> => {
    const body = await getJson<{ hits?: LogHits[] }>(
      `${MONITORING_API}/logs/hits?${qs({ query, start: w.start, end: w.end, step: w.step, offset: w.offset, field })}`,
      signal,
    );
    return Array.isArray(body?.hits) ? body.hits : [];
  },

  fieldValues: async (
    field: string,
    w: { start: number; end: number },
    query = '*',
    signal?: AbortSignal,
  ): Promise<FieldValue[]> => {
    const body = await getJson<{ values?: FieldValue[] }>(
      `${MONITORING_API}/logs/field_values?${qs({ query, field, start: w.start, end: w.end })}`,
      signal,
    );
    return Array.isArray(body?.values) ? body.values : [];
  },

  alerts: async (signal?: AbortSignal): Promise<Alert[]> => {
    const body = await getJson<{ data?: { alerts?: Alert[] } }>(`${MONITORING_API}/alerts`, signal);
    return Array.isArray(body?.data?.alerts) ? body.data.alerts : [];
  },
};

/**
 * Follows `/logs/tail` until the server closes it (VictoriaLogs ends a tail within 10 min) or `signal` aborts.
 * `onOpen` fires once the server accepted the stream; every complete NDJSON line goes to `onEntry`. Resolves on a
 * normal end, rejects on errors (the caller reconnects).
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

/** RE2 metacharacters escaped: the text matches literally inside a regexp. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive substring of `_msg`: `~"(?i)<escaped>"`. */
export function substringFilter(text: string): string {
  return `~${logsqlString(`(?i)${escapeRegex(text)}`)}`;
}

/**
 * Splits raw LogsQL at the first top-level `|` (outside quotes and backticks) into the filter part and the pipes
 * (`"| fields …"`, or `""`).
 */
export function splitLogsQL(raw: string): { filter: string; pipes: string } {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === '\\' && quote !== '`') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '|') return { filter: raw.slice(0, i).trim(), pipes: raw.slice(i).trim() };
  }
  return { filter: raw.trim(), pipes: '' };
}

export interface LogFilters {
  containers: string[];
  levels: string[];
  text: string;
  /** `text` is raw LogsQL instead of a case-insensitive substring. */
  raw: boolean;
}

/** Filters → the filter expression (`*` when empty) and the user's raw pipes (raw mode only, else `""`). */
export function logQueryParts({ containers, levels, text, raw }: LogFilters): { filter: string; pipes: string } {
  const parts: string[] = [];
  if (containers.length > 0) parts.push(`container:in(${containers.map(logsqlString).join(', ')})`);
  if (levels.length > 0) parts.push(`level:in(${levels.map(logsqlString).join(', ')})`);
  const t = text.trim();
  if (!t) return { filter: parts.length > 0 ? parts.join(' ') : '*', pipes: '' };
  if (!raw) {
    parts.push(substringFilter(t));
    return { filter: parts.join(' '), pipes: '' };
  }
  const { filter: userFilter, pipes } = splitLogsQL(t);
  let filter: string;
  if (!userFilter) filter = parts.length > 0 ? parts.join(' ') : '*';
  else if (parts.length === 0) filter = userFilter;
  else filter = `(${parts.join(' ')}) and (${userFilter})`;
  return { filter, pipes };
}

/** Pipes `/logs/tail` rejects (stats, reordering, limiting). */
const TAIL_FORBIDDEN_PIPES = new Set(['stats', 'uniq', 'top', 'sort', 'limit', 'head', 'offset', 'skip']);

/** `| a … | b …` → `['a …', 'b …']` (top-level pipes only). */
export function splitPipes(pipes: string): string[] {
  const out: string[] = [];
  let rest = pipes.trim();
  while (rest.startsWith('|')) {
    const { filter, pipes: next } = splitLogsQL(rest.slice(1));
    if (filter) out.push(filter);
    rest = next;
  }
  return out;
}

/**
 * The live-tail query: the filter plus the user's pipes when VictoriaLogs tail accepts all of them (no stats /
 * sort / limit pipes); otherwise the pipes are dropped and returned in `dropped` for a hint.
 */
export function buildTailQuery(filters: LogFilters): { query: string; dropped: string } {
  const { filter, pipes } = logQueryParts(filters);
  if (!pipes) return { query: filter, dropped: '' };
  const forbidden = splitPipes(pipes).some((p) => TAIL_FORBIDDEN_PIPES.has(p.split(/[\s(]/, 1)[0].toLowerCase()));
  return forbidden ? { query: filter, dropped: pipes } : { query: `${filter} ${pipes}`, dropped: '' };
}

/** The filter expression only (hits; no pipes). */
export function buildLogFilter(filters: LogFilters): string {
  return logQueryParts(filters).filter;
}

/** Max lines of a search. */
export const LOG_LIMIT = 500;

/**
 * The search query: filters, the user's pipes, then ours — newest first, at most `LOG_LIMIT` lines. Our sort and
 * limit always come last, so they apply to whatever the user's pipes produce.
 */
export function buildLogQuery(filters: LogFilters): string {
  const { filter, pipes } = logQueryParts(filters);
  return `${filter}${pipes ? ` ${pipes}` : ''} | sort by (_time desc) | limit ${LOG_LIMIT}`;
}
