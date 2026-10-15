import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  { _time: '2026-10-16T10:00:00Z', _msg: 'no level here', container: 'nginx' },
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

function Harness({ initial, refreshKey = 0 }: { initial: LogFilters; refreshKey?: number }) {
  const [filters, setFilters] = useState(initial);
  return (
    <MonitoringContext.Provider value={{ period: DEFAULT_PERIOD, refreshKey, refreshAuto: false, openLogs: () => {} }}>
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LogsSection', () => {
  it('lists lines (time, level, container, message) and folds long messages', async () => {
    const { calls } = mockLogs();
    renderWithKit(<Harness initial={EMPTY} />);
    const list = await screen.findByRole('list', { name: 'Строки логов' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[2].textContent).toContain('—'); // no level → a dash, not «info»
    expect(items[2].textContent).not.toContain('info');
    expect(items[0].textContent).toContain('error');
    expect(items[0].textContent).toContain('nginx');
    expect(items[0].textContent).toContain('upstream timed out');

    const toggle = within(items[1]).getByRole('button', { name: 'Показать полностью' });
    const pre = items[1].querySelector('pre')!;
    expect(toggle.getAttribute('aria-controls')).toBe(pre.id);
    expect(pre.getAttribute('data-collapsed')).toBe('true');
    fireEvent.click(toggle);
    expect(items[1].querySelector('pre')?.getAttribute('data-collapsed')).toBe('false');

    expect(logQueries(calls)[0]).toBe('* | sort by (_time desc) | limit 500');
    const hits = calls.find((c) => c.path.startsWith('/monitoring/api/logs/hits'))!;
    expect([param(hits, 'query'), param(hits, 'field'), param(hits, 'step')]).toEqual(['*', 'level', '300s']);
    expect(param(hits, 'offset')).toMatch(/^-?\d+s$/);
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
        'container:in("nginx") level:in("error") ~"(?i)say \\"hi\\"" | sort by (_time desc) | limit 500',
      ),
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Текст — запрос LogsQL как есть' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос LogsQL' }), { target: { value: '_msg:~"time.*out"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() =>
      expect(logQueries(calls).at(-1)).toBe(
        '(container:in("nginx") level:in("error")) and (_msg:~"time.*out") | sort by (_time desc) | limit 500',
      ),
    );
  });

  it('Live tails with the same filters, newest on top, and backs off before reconnecting a short stream', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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
    const tails = () => calls.filter((c) => c.path.startsWith('/monitoring/api/logs/tail'));
    renderWithKit(<Harness initial={{ ...EMPTY, containers: ['nginx'] }} />);
    await screen.findByRole('list', { name: 'Строки логов' });

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    await waitFor(() => expect(screen.getByText('second')).toBeTruthy());
    expect(param(tails()[0], 'query')).toBe('container:in("nginx")');

    // The stream closed at once → at least 5 s before the next attempt.
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(tails()).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await waitFor(() => expect(screen.getByText('after reconnect')).toBeTruthy());
    const items = within(screen.getByRole('list', { name: 'Строки логов' })).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('pre')?.textContent)).toEqual(['after reconnect', 'second', 'first']);

    fireEvent.click(screen.getByRole('button', { name: 'Остановить' }));
    expect(await screen.findByText('upstream timed out')).toBeTruthy();
  });

  it('Live pauses while the browser tab is hidden and reconnects when it is back', async () => {
    let cancelled = 0;
    const { calls } = mockLogs(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled++;
            },
          }),
          { status: 200 },
        ),
    );
    const tails = () => calls.filter((c) => c.path.startsWith('/monitoring/api/logs/tail'));
    renderWithKit(<Harness initial={EMPTY} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Live' }));
    await waitFor(() => expect(screen.getByText('Подключено')).toBeTruthy());
    expect(tails()).toHaveLength(1);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('Вкладка скрыта — поток на паузе')).toBeTruthy();
    await waitFor(() => expect(cancelled).toBe(1));

    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(tails()).toHaveLength(2));
    expect(await screen.findByText('Подключено')).toBeTruthy();
  });

  it('while live, refreshes do not reload the search or the histogram', async () => {
    const { calls } = mockLogs(() => new Response(new ReadableStream<Uint8Array>(), { status: 200 }));
    const { rerender } = renderWithKit(<Harness initial={EMPTY} />);
    await screen.findByRole('list', { name: 'Строки логов' });
    const count = (path: string) => calls.filter((c) => c.path.startsWith(path)).length;
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    rerender(<Harness initial={EMPTY} refreshKey={1} />);
    rerender(<Harness initial={EMPTY} refreshKey={2} />);
    await act(async () => {});
    expect(count('/monitoring/api/logs/query')).toBe(1);
    expect(count('/monitoring/api/logs/hits')).toBe(1);
  });
});
