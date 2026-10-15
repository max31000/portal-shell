import { describe, expect, it } from 'vitest';
import { buildTailQuery, splitPipes } from './api';
import { appQueries, endpointLabel, NO_ROUTE } from './appQueries';
import { keyLines, lineKey, nextTailDelay } from './useLiveTail';

describe('live tail helpers', () => {
  it('backs off when a stream dies within 5 s, reconnects fast after a healthy one', () => {
    expect(nextTailDelay(0, null)).toBe(5000);
    expect(nextTailDelay(5000, 300)).toBe(10_000);
    expect(nextTailDelay(10_000, null)).toBe(20_000);
    expect(nextTailDelay(40_000, 10)).toBe(60_000);
    expect(nextTailDelay(60_000, null)).toBe(60_000);
    expect(nextTailDelay(60_000, 600_000)).toBe(1000);
  });

  it('line keys are stable and unique for repeats', () => {
    const a = { _time: '2026-10-16T10:00:00Z', _stream: '{container="nginx"}', _msg: 'x' };
    expect(lineKey(a)).toBe(lineKey({ ...a }));
    expect(lineKey(a)).not.toBe(lineKey({ ...a, _msg: 'y' }));
    const keys = keyLines([a, { ...a }, { ...a, _msg: 'y' }]).map((l) => l.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[1]).toBe(`${keys[0]}#2`);
  });

  it('tail keeps user pipes it supports and drops stats/sort/limit ones', () => {
    const raw = (text: string) => ({ containers: ['nginx'], levels: [], text, raw: true });
    expect(splitPipes('| fields _time, _msg | extract "a|b" from _msg')).toEqual(['fields _time, _msg', 'extract "a|b" from _msg']);
    expect(buildTailQuery(raw('error | fields _time, _msg'))).toEqual({
      query: '(container:in("nginx")) and (error) | fields _time, _msg',
      dropped: '',
    });
    expect(buildTailQuery(raw('error | stats count()'))).toEqual({
      query: '(container:in("nginx")) and (error)',
      dropped: '| stats count()',
    });
    expect(buildTailQuery(raw('error | fields _msg | sort by (_time)')).dropped).toBe('| fields _msg | sort by (_time)');
  });
});

describe('app queries', () => {
  it('select the service of job apps and use the rate/range placeholders', () => {
    const q = appQueries('bonds');
    expect(q.rpsByEndpoint).toBe('sum by (endpoint) (rate(http_requests_received_total{job="apps",service="bonds"}[$__rate]))');
    expect(q.p95ByEndpoint).toBe(
      'histogram_quantile(0.95, sum by (endpoint, le) (rate(http_request_duration_seconds_bucket{job="apps",service="bonds"}[$__rate])))',
    );
    expect(q.errorsByEndpoint).toContain('code="5xx"');
    expect(q.totalByEndpoint).toContain('increase(http_requests_received_total{job="apps",service="bonds"}[$__range])');
    expect(q.total4xxByEndpoint).toContain('code="4xx"');
    expect(q.gcByGeneration).toBe('sum by (generation) (rate(dotnet_collection_count_total{job="apps",service="bonds"}[$__rate]))');
    expect(q.loginsByResult).toBeNull();
    expect(appQueries('auth').loginsByResult).toBe(
      '60 * sum by (result) (rate(mvv42_auth_logins_total{job="apps",service="auth"}[$__rate]))',
    );
  });

  it('unmatched routes have an empty endpoint', () => {
    expect(endpointLabel('')).toBe(NO_ROUTE);
    expect(endpointLabel(undefined)).toBe(NO_ROUTE);
    expect(endpointLabel('/api/users/{id}')).toBe('/api/users/{id}');
  });
});
