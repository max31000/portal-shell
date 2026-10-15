import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { json, mockFetch, renderWithKit, stubChartSize, stubDom, type RecordedCall } from '../../test/utils';
import { onAdminAuthLost } from '../api';
import { MonitoringTab } from './MonitoringTab';

const NOW = 1_760_600_000;
const GiB = 1024 ** 3;

const param = (call: RecordedCall, name: string) => new URL(call.path, 'http://localhost').searchParams.get(name) ?? '';

/** Instant answers by a substring of the PromQL expression. */
const INSTANT: [string, Array<{ metric: Record<string, string>; v: number }>][] = [
  ['mode="idle"', [{ metric: {}, v: 23.4 }]],
  ['node_memory_MemTotal_bytes', [{ metric: {}, v: 8 * GiB }]],
  ['node_memory_MemAvailable_bytes', [{ metric: {}, v: 5 * GiB }]],
  ['node_filesystem_avail_bytes', [{ metric: {}, v: 40 * GiB }]],
  ['node_filesystem_size_bytes', [{ metric: {}, v: 80 * GiB }]],
  ['node_network_receive', [{ metric: {}, v: 2048 }]],
  ['node_network_transmit', [{ metric: {}, v: 1024 }]],
  ['mvv42_http_requests_total', [{ metric: {}, v: 12.5 }]],
  ['node_boot_time_seconds', [{ metric: {}, v: 3 * 86_400 + 4 * 3600 }]],
  ['probe_ssl_earliest_cert_expiry', [{ metric: {}, v: 61.7 }]],
  ['node_load1', [{ metric: {}, v: 0.42 }]],
  [
    'probe_success',
    [
      { metric: { job: 'health', service: 'auth' }, v: 1 },
      { metric: { job: 'vpn', service: 'vpn' }, v: 0 },
    ],
  ],
  [
    'probe_duration_seconds',
    [
      { metric: { job: 'health', service: 'auth' }, v: 0.012 },
      { metric: { job: 'vpn', service: 'vpn' }, v: 0.5 },
    ],
  ],
];

function vector(query: string) {
  const hit = INSTANT.find(([needle]) => query.includes(needle));
  return {
    status: 'success',
    data: { resultType: 'vector', result: (hit?.[1] ?? []).map((s) => ({ metric: s.metric, value: [NOW, String(s.v)] })) },
  };
}

function matrix(call: RecordedCall) {
  const start = Number(param(call, 'start'));
  const step = Number(param(call, 'step'));
  return {
    status: 'success',
    data: {
      resultType: 'matrix',
      result: [{ metric: {}, values: [0, 1, 2].map((i) => [start + i * step, String(10 + i)]) }],
    },
  };
}

const ALERTS = {
  data: {
    alerts: [
      {
        name: 'ContainerRestarting',
        state: 'pending',
        labels: { name: 'bonds-api', severity: 'warning' },
        annotations: { summary: 'Контейнер bonds-api перезапускался 3 раза' },
        activeAt: '2026-10-16T09:00:00Z',
        value: '3',
      },
      {
        name: 'ServiceDown',
        state: 'firing',
        labels: { service: 'vpn', severity: 'critical' },
        annotations: { summary: 'vpn не отвечает' },
        activeAt: '2026-10-16T10:00:00Z',
        value: '0',
      },
    ],
  },
};

const APP_ENDPOINTS = [
  { metric: { endpoint: '/api/admin/users/{id:long}' }, v: 120 },
  { metric: {}, v: 7 },
];

function mockMonitoring(alerts: unknown = ALERTS, extra: Parameters<typeof mockFetch>[0] = {}) {
  return mockFetch({
    ...extra,
    'GET /monitoring/api/metrics/query?*': (call) => {
      const query = param(call, 'query');
      if (query.includes('http_requests_received_total') && query.includes('increase')) {
        return {
          status: 'success',
          data: { resultType: 'vector', result: APP_ENDPOINTS.map((s) => ({ metric: s.metric, value: [NOW, String(s.v)] })) },
        };
      }
      return vector(query);
    },
    'GET /monitoring/api/metrics/query_range?*': (call) => matrix(call),
    'GET /monitoring/api/alerts': () => (typeof alerts === 'function' ? alerts() : alerts),
    'GET /monitoring/api/logs/field_values?*': () => ({ values: [{ value: 'bonds-api', hits: 3 }] }),
    'GET /monitoring/api/logs/hits?*': () => ({ hits: [] }),
    'GET /monitoring/api/logs/query?*': () => new Response('', { status: 200 }),
  });
}

beforeEach(() => {
  stubDom();
  stubChartSize();
  history.replaceState(null, '', '#/admin/monitoring');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MonitoringTab', () => {
  it('overview: key figures, health with text status, alerts firing first, two charts', async () => {
    mockMonitoring();
    renderWithKit(<MonitoringTab />);

    expect(await screen.findByText('23%')).toBeTruthy();
    expect(screen.getByText('3 ГБ')).toBeTruthy(); // RAM used = 8 − 5
    expect(screen.getByText('занято из 8 ГБ')).toBeTruthy();
    expect(screen.getByText('40 ГБ')).toBeTruthy();
    expect(screen.getByText('↓ 2 КБ/с')).toBeTruthy();
    expect(screen.getByText('12,5 запр/с')).toBeTruthy();
    expect(screen.getByText('3 дн 4 ч')).toBeTruthy();
    expect(screen.getByText('61 дн')).toBeTruthy();
    expect(screen.getByText('0,42')).toBeTruthy();

    const health = await screen.findByRole('list', { name: 'Проверки сервисов' });
    const rows = within(health).getAllByRole('listitem');
    // Problems first; colour is backed by text.
    expect(rows[0].textContent).toContain('vpn');
    expect(rows[0].textContent).toContain('Недоступен');
    expect(rows[0].textContent).toContain('500 мс');
    expect(rows[1].textContent).toContain('auth');
    expect(rows[1].textContent).toContain('OK');
    expect(rows[1].textContent).toContain('12 мс');

    const alerts = await screen.findByRole('list', { name: 'Активные алерты' });
    const alertRows = within(alerts).getAllByRole('listitem');
    expect(alertRows[0].textContent).toContain('ServiceDown');
    expect(alertRows[0].textContent).toContain('Сработал');
    expect(alertRows[1].textContent).toContain('ContainerRestarting');

    await waitFor(() => expect(document.querySelectorAll('.recharts-surface').length).toBe(2));
  });

  it('«Всё спокойно» without alerts', async () => {
    mockMonitoring({ data: { alerts: [] } });
    renderWithKit(<MonitoringTab />);
    expect(await screen.findByText('Всё спокойно')).toBeTruthy();
  });

  it('sections switch and live in the hash without new history entries', async () => {
    mockMonitoring();
    const length = history.length;
    renderWithKit(<MonitoringTab />);

    fireEvent.click(screen.getByRole('radio', { name: 'Сервер' }));
    expect(await screen.findByText('CPU по режимам')).toBeTruthy();
    expect(window.location.hash).toBe('#/admin/monitoring/server');

    fireEvent.click(screen.getByRole('radio', { name: 'Алерты' }));
    expect(await screen.findByText(/vmalert\/rules\.yml/)).toBeTruthy();
    expect(window.location.hash).toBe('#/admin/monitoring/alerts');

    fireEvent.click(screen.getByRole('radio', { name: 'Обзор' }));
    expect(window.location.hash).toBe('#/admin/monitoring');
    expect(history.length).toBe(length);
  });

  it('opens the section from the hash', async () => {
    history.replaceState(null, '', '#/admin/monitoring/http');
    mockMonitoring();
    renderWithKit(<MonitoringTab />);
    expect(await screen.findByText('Ответы по классам')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'HTTP' }) as HTMLInputElement).checked).toBe(true);
  });

  it('the period sets the range window, step and rate() window', async () => {
    const { calls } = mockMonitoring();
    renderWithKit(<MonitoringTab />);
    const ranges = () => calls.filter((c) => c.path.startsWith('/monitoring/api/metrics/query_range'));
    await waitFor(() => expect(ranges().length).toBeGreaterThan(0));
    const first = ranges()[0];
    expect(Number(param(first, 'end')) - Number(param(first, 'start'))).toBe(6 * 3600);
    expect(param(first, 'step')).toBe('60');
    expect(param(first, 'query')).toContain('[120s]');

    const before = ranges().length;
    fireEvent.click(screen.getByRole('radio', { name: '7д' }));
    await waitFor(() => expect(ranges().length).toBeGreaterThan(before));
    const week = ranges()[ranges().length - 1];
    expect(Number(param(week, 'end')) - Number(param(week, 'start'))).toBe(7 * 86_400);
    expect(param(week, 'step')).toBe('1800');
    expect(param(week, 'query')).toContain('[3600s]');
  });

  it('«Обновить» reloads in place; auto-refresh skips hidden tabs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = mockMonitoring();
    renderWithKit(<MonitoringTab />);
    const alertCalls = () => calls.filter((c) => c.path === '/monitoring/api/alerts').length;
    await waitFor(() => expect(alertCalls()).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(alertCalls()).toBe(2));

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(alertCalls()).toBe(3));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(alertCalls()).toBe(3);
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(alertCalls()).toBe(4));
  });

  it('«Логи» on an alert opens Logs filtered by the container', async () => {
    const { calls } = mockMonitoring();
    renderWithKit(<MonitoringTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Показать логи bonds-api' }));
    expect(window.location.hash).toBe('#/admin/monitoring/logs');
    await waitFor(() =>
      expect(calls.some((c) => c.path.startsWith('/monitoring/api/logs/query') && param(c, 'query').includes('container:in("bonds-api")'))).toBe(
        true,
      ),
    );
  });

  it('an auto-refresh tick is skipped while the previous load is pending; «Обновить» aborts and restarts it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const { calls, fetchMock } = mockMonitoring(() => (++n === 1 ? new Promise(() => {}) : ALERTS));
    renderWithKit(<MonitoringTab />);
    const alertCalls = () => calls.filter((c) => c.path === '/monitoring/api/alerts').length;
    await waitFor(() => expect(alertCalls()).toBe(1));

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(alertCalls()).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(alertCalls()).toBe(2));
    const first = fetchMock.mock.calls.find(([url]) => String(url) === '/monitoring/api/alerts')!;
    expect((first[1] as RequestInit).signal?.aborted).toBe(true);
    expect(await screen.findByText('ServiceDown')).toBeTruthy();
  });

  it('a period change aborts the requests of the old period', async () => {
    history.replaceState(null, '', '#/admin/monitoring/server');
    let hang = true;
    const { fetchMock } = mockMonitoring(ALERTS, {});
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      hang && String(input).includes('query_range') ? new Promise<Response>(() => {}) : original(input, init),
    );
    renderWithKit(<MonitoringTab />);
    const ranges = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('query_range'));
    await waitFor(() => expect(ranges().length).toBeGreaterThan(0));
    const old = ranges().map(([, init]) => (init as RequestInit).signal!);
    expect(old.every((sig) => !sig.aborted)).toBe(true);

    hang = false;
    fireEvent.click(screen.getByRole('radio', { name: '24ч' }));
    await waitFor(() => expect(old.every((sig) => sig.aborted)).toBe(true));
    expect(await screen.findAllByText('CPU по режимам')).toBeTruthy();
  });

  it('a 403 the owner check does not confirm shows an error, the session stays', async () => {
    const lost = vi.fn();
    const off = onAdminAuthLost(lost);
    const { calls } = mockMonitoring(() => json({}, 403), {
      'GET /auth/api/admin/check': () => new Response(null, { status: 204 }),
    });
    history.replaceState(null, '', '#/admin/monitoring/alerts');
    renderWithKit(<MonitoringTab />);
    expect(await screen.findByText('Не удалось загрузить алерты')).toBeTruthy();
    expect(calls.some((c) => c.path === '/auth/api/admin/check')).toBe(true);
    expect(lost).not.toHaveBeenCalled();
    off();
  });

  it('«Приложения»: per-service charts and the endpoints table', async () => {
    const { calls } = mockMonitoring();
    renderWithKit(<MonitoringTab />);
    fireEvent.click(screen.getByRole('radio', { name: 'Приложения' }));
    expect(window.location.hash).toBe('#/admin/monitoring/apps');
    expect(await screen.findByText('Запросы в секунду по эндпоинтам')).toBeTruthy();
    expect(screen.getByText('Входы по результату')).toBeTruthy(); // auth only

    const table = await screen.findByRole('table', { name: 'Эндпоинты за период' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('/api/admin/users/{id:long}');
    expect(rows[0].textContent).toContain('120');
    expect(rows[1].textContent).toContain('(без маршрута)');

    const rangeQueries = () =>
      calls.filter((c) => c.path.startsWith('/monitoring/api/metrics/query_range')).map((c) => param(c, 'query'));
    await waitFor(() => expect(rangeQueries().some((q) => q.includes('service="auth"'))).toBe(true));

    fireEvent.click(screen.getByRole('radio', { name: 'bonds' }));
    await waitFor(() => expect(rangeQueries().some((q) => q.includes('service="bonds"'))).toBe(true));
    expect(screen.queryByText('Входы по результату')).toBeNull();
  });
});
