import { vi } from 'vitest';

/** `render` inside `Mvv42Provider` (test env) and the notification reset — from the kit. */
export { renderWithKit, resetNotifications } from '@mvv42/kit/testing';

/** jsdom lacks matchMedia / ResizeObserver; Mantine (and `useMediaQuery`) need them. */
export function stubDom(matches = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

type Handler = (call: RecordedCall) => Response | Promise<Response> | unknown;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Stubs `fetch` with a route table: keys are `"METHOD /path"` (path without origin, query included) or
 * `"METHOD /path*"` for a prefix. A handler may return a `Response` or a plain value (sent as 200 JSON).
 * Unknown routes answer 404. All calls are recorded.
 */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname + url.search;
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call = { method, path, body, headers: new Headers(init?.headers) };
    calls.push(call);
    const key = `${method} ${path}`;
    const handler =
      routes[key] ??
      Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
    if (!handler) return json({ error: 'no_mock' }, 404);
    const result = await handler(call);
    return result instanceof Response ? result : json(result);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}
