import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApiError } from '@mvv42/kit/platform';
import { json, mockFetch } from '../../test/utils';
import { onAdminAuthLost } from '../api';
import {
  buildLogFilter,
  buildLogQuery,
  escapeRegex,
  expandQuery,
  logQueryParts,
  logsqlString,
  splitLogsQL,
  substringFilter,
  utcOffset,
  monitoringApi,
  parseNdjson,
  parseValue,
  rateWindow,
  tailLogs,
  type LogEntry,
} from './api';

const params = (path: string) => new URL(path, 'http://localhost').searchParams;

function ndjsonStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

describe('monitoring client helpers', () => {
  it('parses VM values, NaN/Inf become gaps', () => {
    expect(parseValue('1.5')).toBe(1.5);
    expect(parseValue('0')).toBe(0);
    expect(parseValue('NaN')).toBeNull();
    expect(parseValue('+Inf')).toBeNull();
    expect(parseValue('')).toBeNull();
    expect(parseValue(undefined)).toBeNull();
  });

  it('rate window is max(step*2, 2m)', () => {
    expect(rateWindow(15)).toBe('120s');
    expect(rateWindow(60)).toBe('120s');
    expect(rateWindow(300)).toBe('600s');
    expect(rateWindow(7200)).toBe('14400s');
  });

  it('expands $__rate and $__range everywhere', () => {
    expect(expandQuery('rate(a[$__rate]) / rate(b[$__rate]) + increase(c[$__range])', { rate: '120s', range: '6h' })).toBe(
      'rate(a[120s]) / rate(b[120s]) + increase(c[6h])',
    );
  });

  it('parses NDJSON, skipping blank and torn lines', () => {
    const text = '{"_time":"t1","_msg":"a"}\n\n{"_time":"t2","_msg":"b"}\n{"_time":"t3","_ms';
    expect(parseNdjson(text)).toEqual([
      { _time: 't1', _msg: 'a' },
      { _time: 't2', _msg: 'b' },
    ]);
  });
});

describe('LogsQL building', () => {
  it('escapes quotes and backslashes', () => {
    expect(logsqlString('say "hi"')).toBe('"say \\"hi\\""');
    expect(logsqlString('C:\\path')).toBe('"C:\\\\path"');
    expect(logsqlString('\\"')).toBe('"\\\\\\""');
  });

  it('escapes regex metacharacters for the substring filter', () => {
    expect(escapeRegex('a.b*c+(d)[e]{f}|g^h$i?\\')).toBe('a\\.b\\*c\\+\\(d\\)\\[e\\]\\{f\\}\\|g\\^h\\$i\\?\\\\');
    // Regex escape, then LogsQL string escape: `1.5"x` → (?i)1\.5"x → "(?i)1\\.5\"x".
    expect(substringFilter('1.5"x')).toBe('~"(?i)1\\\\.5\\"x"');
    expect(new RegExp(escapeRegex('a.b(c)')).test('xa.b(c)y')).toBe(true);
    expect(new RegExp(escapeRegex('a.b')).test('axb')).toBe(false);
  });

  it('builds a case-insensitive substring filter with containers and levels', () => {
    expect(buildLogFilter({ containers: [], levels: [], text: '', raw: false })).toBe('*');
    expect(
      buildLogFilter({ containers: ['bonds-api', 'nginx'], levels: ['error', 'warn'], text: ' time"out ', raw: false }),
    ).toBe('container:in("bonds-api", "nginx") level:in("error", "warn") ~"(?i)time\\"out"');
  });

  it('splits raw LogsQL at the first top-level pipe, ignoring pipes in quotes', () => {
    expect(splitLogsQL('error')).toEqual({ filter: 'error', pipes: '' });
    expect(splitLogsQL('error or panic | fields _msg | limit 3')).toEqual({
      filter: 'error or panic',
      pipes: '| fields _msg | limit 3',
    });
    expect(splitLogsQL('_msg:"a|b" or \'c|d\' | stats count()')).toEqual({
      filter: '_msg:"a|b" or \'c|d\'',
      pipes: '| stats count()',
    });
    expect(splitLogsQL('"say \\"|\\"" | uniq')).toEqual({ filter: '"say \\"|\\""', pipes: '| uniq' });
    expect(splitLogsQL('| fields _msg')).toEqual({ filter: '', pipes: '| fields _msg' });
  });

  it('raw LogsQL: (filters) and (raw filter), user pipes before our sort and limit', () => {
    const raw = (text: string, containers: string[] = []) => ({ containers, levels: [], text, raw: true });
    expect(buildLogQuery(raw('error or panic'))).toBe('error or panic | sort by (_time desc) | limit 500');
    expect(buildLogQuery(raw('error or panic', ['nginx']))).toBe(
      '(container:in("nginx")) and (error or panic) | sort by (_time desc) | limit 500',
    );
    expect(buildLogQuery(raw('error | fields _time, _msg | limit 10', ['nginx']))).toBe(
      '(container:in("nginx")) and (error) | fields _time, _msg | limit 10 | sort by (_time desc) | limit 500',
    );
    expect(buildLogQuery(raw('| fields _msg', ['nginx']))).toBe(
      'container:in("nginx") | fields _msg | sort by (_time desc) | limit 500',
    );
    // Hits and tail get the filter part only.
    expect(buildLogFilter(raw('error | fields _msg', ['nginx']))).toBe('(container:in("nginx")) and (error)');
    expect(logQueryParts(raw('error | fields _msg')).pipes).toBe('| fields _msg');
  });

  it('search query sorts newest first and limits to 500', () => {
    expect(buildLogQuery({ containers: [], levels: ['error'], text: '', raw: false })).toBe(
      'level:in("error") | sort by (_time desc) | limit 500',
    );
  });

  it('UTC offset for hits buckets', () => {
    const date = { getTimezoneOffset: () => -180 } as Date;
    expect(utcOffset(date)).toBe('10800s');
  });
});

describe('monitoringApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('instant and range queries hit the proxy and return the result', async () => {
    const { calls } = mockFetch({
      'GET /monitoring/api/metrics/query?*': () => ({
        status: 'success',
        data: { resultType: 'vector', result: [{ metric: { job: 'node' }, value: [1, '1'] }] },
      }),
      'GET /monitoring/api/metrics/query_range?*': () => ({
        status: 'success',
        data: { resultType: 'matrix', result: [{ metric: {}, values: [[1, '2']] }] },
      }),
    });
    await expect(monitoringApi.query('up')).resolves.toEqual([{ metric: { job: 'node' }, value: [1, '1'] }]);
    await expect(monitoringApi.queryRange('up', { start: 100, end: 200, step: 15 })).resolves.toHaveLength(1);
    const range = params(calls[1].path);
    expect(calls[1].path.startsWith('/monitoring/api/metrics/query_range?')).toBe(true);
    expect([range.get('query'), range.get('start'), range.get('end'), range.get('step')]).toEqual(['up', '100', '200', '15']);
  });

  it('a VM error body rejects with its message', async () => {
    mockFetch({ 'GET /monitoring/api/metrics/query?*': () => ({ status: 'error', error: 'bad query' }) });
    await expect(monitoringApi.query('(')).rejects.toThrow('VictoriaMetrics: bad query');
  });

  it('a 401 that survived the refresh means the session is gone', async () => {
    const lost = vi.fn();
    const off = onAdminAuthLost(lost);
    mockFetch({
      'POST /auth/api/refresh': () => json({}, 401),
      'GET /monitoring/api/logs/query?*': () => json({}, 401),
    });
    await expect(monitoringApi.logs('*', { start: 1, end: 2 })).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledOnce();
    off();
  });

  it('a 403 counts only when /auth/api/admin/check confirms it', async () => {
    const lost = vi.fn();
    const off = onAdminAuthLost(lost);
    let check = 204;
    const { calls } = mockFetch({
      'GET /monitoring/api/alerts': () => json({}, 403),
      'GET /auth/api/admin/check': () => new Response(null, { status: check }),
    });
    // An nginx allow-list miss: the owner check passes → just an error for the caller.
    await expect(monitoringApi.alerts()).rejects.toSatisfy(isApiError);
    expect(lost).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.path === '/auth/api/admin/check')).toHaveLength(1);

    check = 403;
    await expect(monitoringApi.alerts()).rejects.toMatchObject({ status: 403 });
    expect(lost).toHaveBeenCalledOnce();
    off();
  });

  it('concurrent 403s share one owner check', async () => {
    const { calls } = mockFetch({
      'GET /monitoring/api/alerts': () => json({}, 403),
      'GET /auth/api/admin/check': () => new Response(null, { status: 204 }),
    });
    await Promise.allSettled([monitoringApi.alerts(), monitoringApi.alerts(), monitoringApi.alerts()]);
    expect(calls.filter((c) => c.path === '/auth/api/admin/check')).toHaveLength(1);
  });

  it('passes the abort signal to fetch', async () => {
    const { fetchMock } = mockFetch({ 'GET /monitoring/api/alerts': () => ({ data: { alerts: [] } }) });
    const ctrl = new AbortController();
    await monitoringApi.alerts(ctrl.signal);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(ctrl.signal);
  });

  it('logs are NDJSON lines', async () => {
    const { calls } = mockFetch({
      'GET /monitoring/api/logs/query?*': () =>
        new Response('{"_time":"2026-10-16T10:00:00Z","_msg":"hi","container":"nginx","level":"info"}\n', { status: 200 }),
    });
    const entries = await monitoringApi.logs('* | limit 5', { start: 10, end: 20 });
    expect(entries).toEqual([{ _time: '2026-10-16T10:00:00Z', _msg: 'hi', container: 'nginx', level: 'info' }]);
    expect(params(calls[0].path).get('query')).toBe('* | limit 5');
  });

  it('alerts / hits / field values unwrap their envelopes', async () => {
    mockFetch({
      'GET /monitoring/api/alerts': () => ({ data: { alerts: [{ name: 'X', state: 'firing' }] } }),
      'GET /monitoring/api/logs/hits?*': () => ({ hits: [{ fields: { level: 'error' }, timestamps: ['t'], values: [3] }] }),
      'GET /monitoring/api/logs/field_values?*': () => ({ values: [{ value: 'nginx', hits: 4 }] }),
    });
    await expect(monitoringApi.alerts()).resolves.toHaveLength(1);
    await expect(monitoringApi.hits('*', { start: 1, end: 2, step: '60s' })).resolves.toHaveLength(1);
    await expect(monitoringApi.fieldValues('container', { start: 1, end: 2 })).resolves.toEqual([{ value: 'nginx', hits: 4 }]);
  });

  it('tail streams NDJSON lines split across chunks', async () => {
    mockFetch({
      'GET /monitoring/api/logs/tail?*': () =>
        ndjsonStream(['{"_time":"1","_msg":"a"}\n{"_time":"2",', '"_msg":"b"}\n', '{"_time":"3","_msg":"c"}']),
    });
    const got: LogEntry[] = [];
    const opened = vi.fn();
    await tailLogs('*', (e) => got.push(e), new AbortController().signal, opened);
    expect(opened).toHaveBeenCalledOnce();
    expect(got.map((e) => e._msg)).toEqual(['a', 'b', 'c']);
  });
});
