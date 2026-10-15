import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { json, mockFetch, renderWithKit, stubChartSize, stubDom, type RecordedCall } from '../../test/utils';
import { MonitoringContext } from './context';
import { DEFAULT_PERIOD } from './period';
import { PromChart, type PromChartSpec } from './PromChart';
import { OTHER_SERIES } from './series';

const param = (call: RecordedCall, name: string) => new URL(call.path, 'http://localhost').searchParams.get(name) ?? '';

function matrix(call: RecordedCall, names: string[]) {
  const start = Number(param(call, 'start'));
  const step = Number(param(call, 'step'));
  return {
    status: 'success',
    data: {
      resultType: 'matrix',
      result: names.map((name, i) => ({
        metric: { name },
        values: [0, 1, 2, 3].map((k) => [start + k * step, String(i + 1)]),
      })),
    },
  };
}

const SPEC: PromChartSpec = {
  title: 'Память по контейнерам',
  explanation: 'Рабочий набор',
  unit: 'bytes',
  kind: 'stackedArea',
  maxSeries: 3,
  queries: [{ expr: 'sum by (name) (container_memory_working_set_bytes)', legend: (m) => m.name }],
};

function renderChart(spec: PromChartSpec = SPEC) {
  return renderWithKit(
    <MonitoringContext.Provider value={{ period: DEFAULT_PERIOD, refreshKey: 0, openLogs: () => {} }}>
      <PromChart {...spec} />
    </MonitoringContext.Provider>,
  );
}

beforeEach(() => {
  stubDom();
  stubChartSize();
});
afterEach(() => vi.unstubAllGlobals());

describe('PromChart', () => {
  it('renders the series of the range query with the top-N and «Другое» in the legend', async () => {
    const { calls } = mockFetch({
      'GET /monitoring/api/metrics/query_range?*': (call) => matrix(call, ['a', 'b', 'c', 'd', 'e']),
    });
    renderChart();
    expect(await screen.findByText(OTHER_SERIES)).toBeTruthy();
    // Biggest three by mean: e, d, c; a + b folded.
    for (const name of ['c', 'd', 'e']) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText('a')).toBeNull();
    expect(document.querySelectorAll('.recharts-area').length).toBe(4);
    expect(param(calls[0], 'query')).toBe(SPEC.queries[0].expr);
    expect(screen.getByRole('button', { name: 'Как читать график' })).toBeTruthy();
  });

  it('expands $__rate with the period step', async () => {
    const { calls } = mockFetch({ 'GET /monitoring/api/metrics/query_range?*': (call) => matrix(call, ['a']) });
    renderChart({ ...SPEC, queries: [{ expr: 'rate(x[$__rate])', legend: () => 'x' }] });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(param(calls[0], 'query')).toBe('rate(x[120s])');
  });

  it('empty result → the empty state', async () => {
    mockFetch({ 'GET /monitoring/api/metrics/query_range?*': () => ({ status: 'success', data: { resultType: 'matrix', result: [] } }) });
    renderChart();
    expect(await screen.findByText('За выбранный период метрик нет.')).toBeTruthy();
  });

  it('a failed query → ErrorState with retry', async () => {
    let fail = true;
    mockFetch({
      'GET /monitoring/api/metrics/query_range?*': (call) => (fail ? json({ error: 'boom' }, 500) : matrix(call, ['a'])),
    });
    renderChart();
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    fail = false;
    fireEvent.click(retry);
    await waitFor(() => expect(document.querySelectorAll('.recharts-area').length).toBe(1));
  });
});
