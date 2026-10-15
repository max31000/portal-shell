import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { mockFetch, renderWithKit, stubChartSize, stubDom, type RecordedCall } from '../../test/utils';
import type { LogFilters } from './api';
import { MonitoringContext } from './context';
import { DEFAULT_PERIOD } from './period';
import { LogsSection } from './LogsSection';

const param = (call: RecordedCall, name: string) => new URL(call.path, 'http://localhost').searchParams.get(name) ?? '';

const LONG = Array.from({ length: 6 }, (_, i) => `at frame ${i}`).join('\n');
const LINES = [
  { _time: '2026-10-16T10:00:02Z', _msg: 'upstream timed out', container: 'nginx', level: 'error' },
  { _time: '2026-10-16T10:00:01Z', _msg: LONG, container: 'bonds-api', level: 'warn' },
];
const ndjson = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function stream(rows: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        rows.forEach((r) => controller.enqueue(encoder.encode(JSON.stringify(r) + '\n')));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function Harness({ initial }: { initial: LogFilters }) {
  const [filters, setFilters] = useState(initial);
  return (
    <MonitoringContext.Provider value={{ period: DEFAULT_PERIOD, refreshKey: 0, openLogs: () => {} }}>
      <LogsSection filters={filters} onFiltersChange={setFilters} />
    </MonitoringContext.Provider>
  );
}

const EMPTY: LogFilters = { containers: [], levels: [], text: '', raw: false };

function mockLogs(tail: () => Response = () => stream([])) {
  return mockFetch({
    'GET /monitoring/api/logs/field_values?*': () => ({ values: [{ value: 'nginx', hits: 9 }, { value: 'bonds-api', hits: 3 }] }),
    'GET /monitoring/api/logs/hits?*': () => ({
      hits: [{ fields: { level: 'error' }, timestamps: ['2026-10-16T10:00:00Z'], values: [1], total: 1 }],
    }),
    'GET /monitoring/api/logs/query?*': () => new Response(ndjson(LINES), { status: 200 }),
    'GET /monitoring/api/logs/tail?*': tail,
  });
}

const logQueries = (calls: RecordedCall[]) =>
  calls.filter((c) => c.path.startsWith('/monitoring/api/logs/query')).map((c) => param(c, 'query'));

beforeEach(() => {
  stubDom();
  stubChartSize();
});
afterEach(() => vi.unstubAllGlobals());

describe('LogsSection', () => {
  it('lists lines (time, level, container, message) and folds long messages', async () => {
    const { calls } = mockLogs();
    renderWithKit(<Harness initial={EMPTY} />);
    const list = await screen.findByRole('list', { name: 'Строки логов' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('error');
    expect(items[0].textContent).toContain('nginx');
    expect(items[0].textContent).toContain('upstream timed out');

    const toggle = within(items[1]).getByRole('button', { name: 'Показать полностью' });
    expect(items[1].querySelector('pre')?.getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(toggle);
    expect(items[1].querySelector('pre')?.getAttribute('data-collapsed')).toBe('false');

    expect(logQueries(calls)[0]).toBe('* | sort by (_time desc) | limit 500');
    const hits = calls.find((c) => c.path.startsWith('/monitoring/api/logs/hits'))!;
    expect([param(hits, 'query'), param(hits, 'field'), param(hits, 'step')]).toEqual(['*', 'level', '360s']);
  });

  it('levels, text (escaped, case-insensitive) and raw LogsQL build the query', async () => {
    const { calls } = mockLogs();
    renderWithKit(<Harness initial={{ ...EMPTY, containers: ['nginx'] }} />);
    await screen.findByRole('list', { name: 'Строки логов' });
    expect(logQueries(calls).at(-1)).toBe('container:in("nginx") | sort by (_time desc) | limit 500');

    fireEvent.click(screen.getByRole('checkbox', { name: 'error' }));
    await waitFor(() =>
      expect(logQueries(calls).at(-1)).toBe('container:in("nginx") level:in("error") | sort by (_time desc) | limit 500'),
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Текст' }), { target: { value: 'say "hi"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() =>
      expect(logQueries(calls).at(-1)).toBe(
        'container:in("nginx") level:in("error") i("say \\"hi\\"") | sort by (_time desc) | limit 500',
      ),
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Текст — запрос LogsQL как есть' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос LogsQL' }), { target: { value: '_msg:~"time.*out"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() =>
      expect(logQueries(calls).at(-1)).toBe(
        'container:in("nginx") level:in("error") (_msg:~"time.*out") | sort by (_time desc) | limit 500',
      ),
    );
  });

  it('Live tails with the same filters, newest on top, and reconnects when the stream ends', async () => {
    let n = 0;
    const { calls } = mockLogs(() => {
      n++;
      return n === 1
        ? stream([
            { _time: '2026-10-16T10:00:03Z', _msg: 'first', container: 'nginx', level: 'info' },
            { _time: '2026-10-16T10:00:04Z', _msg: 'second', container: 'nginx', level: 'info' },
          ])
        : stream([{ _time: '2026-10-16T10:00:05Z', _msg: 'after reconnect', container: 'nginx', level: 'info' }]);
    });
    renderWithKit(<Harness initial={{ ...EMPTY, containers: ['nginx'] }} />);
    await screen.findByRole('list', { name: 'Строки логов' });

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    await waitFor(() => expect(screen.getByText('second')).toBeTruthy());
    const tail = calls.find((c) => c.path.startsWith('/monitoring/api/logs/tail'))!;
    expect(param(tail, 'query')).toBe('container:in("nginx")');

    await waitFor(() => expect(screen.getByText('after reconnect')).toBeTruthy(), { timeout: 4000 });
    const items = within(screen.getByRole('list', { name: 'Строки логов' })).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('pre')?.textContent)).toEqual(['after reconnect', 'second', 'first']);

    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    expect(await screen.findByText('upstream timed out')).toBeTruthy();
  });
});
