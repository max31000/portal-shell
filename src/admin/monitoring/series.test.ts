import { describe, expect, it } from 'vitest';
import { chartColors, seriesColor } from '@mvv42/kit/charts';
import type { PromSeries } from './api';
import { buildChart, chartMax, entityColor, hashString, hitsBuckets, hitsRows, OTHER_SERIES, type PromQuery } from './series';

const byName: PromQuery = { expr: 'x', legend: (m) => m.name };

function series(name: string, values: [number, string][]): PromSeries {
  return { metric: { name }, values };
}

describe('buildChart', () => {
  it('turns matrices into rows keyed by series, values parsed, ms timestamps', () => {
    const { rows, series: s } = buildChart(
      [[series('a', [[100, '1'], [115, '2']]), series('b', [[100, '3']])]],
      [byName],
      { step: 15 },
    );
    expect(s.map((x) => x.name)).toEqual(['a', 'b']);
    expect(rows).toEqual([
      { t: 100_000, s0: 1, s1: 3 },
      { t: 115_000, s0: 2, s1: null },
    ]);
  });

  it('sums series with the same legend and combines several queries', () => {
    const q2: PromQuery = { expr: 'y', legend: () => 'a' };
    const { rows, series: s } = buildChart([[series('a', [[100, '1']])], [series('z', [[100, '2']])]], [byName, q2], {
      step: 15,
    });
    expect(s).toHaveLength(1);
    expect(rows[0].s0).toBe(3);
  });

  it('breaks the line on a jump longer than 1.5 steps and on NaN, never zero-fills', () => {
    const { rows } = buildChart([[series('a', [[100, '1'], [115, 'NaN'], [130, '2'], [190, '3']])]], [byName], {
      step: 15,
    });
    expect(rows.map((r) => [r.t / 1000, r.s0])).toEqual([
      [100, 1],
      [115, null],
      [130, 2],
      [145, null],
      [190, 3],
    ]);
  });

  it('keeps the top maxSeries by mean and folds the rest into «Другое» (summed)', () => {
    const matrix = ['a', 'b', 'c', 'd'].map((n, i) => series(n, [[100, String(i + 1)], [115, String(i + 1)]]));
    const { rows, series: s } = buildChart([matrix], [byName], { step: 15, maxSeries: 2 });
    expect(s.map((x) => x.name)).toEqual(['c', 'd', OTHER_SERIES]);
    expect(s[2].color).toBe(chartColors.other);
    // a (1) + b (2) = 3
    expect(rows[0]).toEqual({ t: 100_000, s0: 3, s1: 4, s2: 3 });
  });

  it('orders and colours by the fixed entity order, not by response order', () => {
    const order = ['portal', 'auth', 'bonds'];
    const svc: PromQuery = { expr: 'x', legend: (m) => m.service };
    const matrix: PromSeries[] = [
      { metric: { service: 'bonds' }, values: [[1, '1']] },
      { metric: { service: 'zeta' }, values: [[1, '1']] },
      { metric: { service: 'portal' }, values: [[1, '1']] },
    ];
    const { series: s } = buildChart([matrix], [svc], { step: 15, order });
    expect(s.map((x) => [x.name, x.color])).toEqual([
      ['portal', seriesColor(0)],
      ['bonds', seriesColor(2)],
      ['zeta', entityColor('zeta')],
    ]);
  });

  it('entities outside an order keep one colour across charts and refreshes', () => {
    const cpu = buildChart([[series('bonds-api', [[1, '5']]), series('nginx', [[1, '1']])]], [byName], { step: 15 });
    const mem = buildChart([[series('nginx', [[1, '9']]), series('mysql', [[1, '1']]), series('bonds-api', [[1, '2']])]], [byName], {
      step: 15,
    });
    const color = (c: typeof cpu, name: string) => c.series.find((x) => x.name === name)?.color;
    expect(color(cpu, 'bonds-api')).toBe(color(mem, 'bonds-api'));
    expect(color(cpu, 'nginx')).toBe(color(mem, 'nginx'));
    expect(hashString('bonds-api')).toBe(hashString('bonds-api'));
    expect(chartColors.series).toContain(entityColor('anything'));
  });

  it("other: 'none' drops the tail instead of summing it", () => {
    const matrix = ['a', 'b', 'c'].map((n, i) => series(n, [[100, String(i + 1)]]));
    const { series: s } = buildChart([matrix], [byName], { step: 15, maxSeries: 2, other: 'none' });
    expect(s.map((x) => x.name)).toEqual(['b', 'c']);
  });

  it('chartMax: stack total for stacked charts, biggest series otherwise', () => {
    const chart = buildChart([[series('a', [[1, '2'], [2, '1']]), series('b', [[1, '3'], [2, 'NaN']])]], [byName], { step: 1 });
    expect(chartMax(chart, true)).toBe(5);
    expect(chartMax(chart, false)).toBe(3);
  });

  it('fixed colours win', () => {
    const { series: s } = buildChart([[{ metric: { class: '5xx' }, values: [[1, '1']] }]], [{ expr: 'x', legend: (m) => m.class }], {
      step: 15,
      colors: { '5xx': 'red' },
    });
    expect(s[0].color).toBe('red');
  });

  it('empty result → no rows, no series', () => {
    expect(buildChart([[]], [byName], { step: 15 })).toEqual({ rows: [], series: [] });
  });
});

describe('hitsRows', () => {
  const t0 = Date.parse('2026-10-16T10:00:00Z') / 1000;

  it('zero-fills every bucket of the window and merges levels, most severe first', () => {
    const { rows, levels } = hitsRows(
      [
        { fields: { level: 'info' }, timestamps: ['2026-10-16T10:00:00Z', '2026-10-16T10:01:00Z'], values: [5, 6] },
        { fields: { level: 'error' }, timestamps: ['2026-10-16T10:01:00Z'], values: [2] },
      ],
      { start: t0 - 30, end: t0 + 180, step: 60 },
    );
    expect(levels).toEqual(['error', 'info']);
    expect(rows).toEqual([
      { t: (t0 - 60) * 1000, info: 0, error: 0 },
      { t: t0 * 1000, info: 5, error: 0 },
      { t: (t0 + 60) * 1000, info: 6, error: 2 },
      { t: (t0 + 120) * 1000, info: 0, error: 0 },
      { t: (t0 + 180) * 1000, info: 0, error: 0 },
    ]);
  });

  it('day buckets with offset=3h start at UTC+3 midnight (21:00 UTC)', () => {
    const day = 86_400;
    const buckets = hitsBuckets(10 * day, 12 * day, day, 3 * 3600);
    expect(buckets).toEqual([10 * day - 3 * 3600, 11 * day - 3 * 3600, 12 * day - 3 * 3600]);
    expect(new Date(buckets[0] * 1000).getUTCHours()).toBe(21);
  });
});
