import { describe, expect, it, vi } from 'vitest';
import {
  acceptInbound,
  isAuthRequiredMessage,
  isNavigateMessage,
  isReadyMessage,
  parseInboundMessage,
  postToFrame,
} from './messages';

describe('type guards', () => {
  it('accepts well-formed NAVIGATE', () => {
    expect(isNavigateMessage({ type: 'NAVIGATE', serviceId: 'bonds', path: '/list' })).toBe(true);
    expect(isNavigateMessage({ type: 'NAVIGATE', serviceId: 'bonds', path: '/list?x=1' })).toBe(true);
  });

  it.each([
    null,
    undefined,
    'NAVIGATE',
    42,
    {},
    { type: 'NAVIGATE' },
    { type: 'NAVIGATE', serviceId: '', path: '/' },
    { type: 'NAVIGATE', serviceId: 'x', path: 'relative' },
    { type: 'NAVIGATE', serviceId: 'x', path: 5 },
    { type: 'navigate', serviceId: 'x', path: '/' },
  ])('rejects malformed NAVIGATE %j', (v) => {
    expect(isNavigateMessage(v)).toBe(false);
  });

  it('validates AUTH_REQUIRED and READY', () => {
    expect(isAuthRequiredMessage({ type: 'AUTH_REQUIRED', serviceId: 'bonds' })).toBe(true);
    expect(isAuthRequiredMessage({ type: 'AUTH_REQUIRED' })).toBe(false);
    expect(isReadyMessage({ type: 'READY', serviceId: 'bonds' })).toBe(true);
    expect(isReadyMessage({ type: 'READY', serviceId: 7 })).toBe(false);
  });

  it('parseInboundMessage strips unknown fields and ignores outbound types', () => {
    expect(parseInboundMessage({ type: 'READY', serviceId: 'a', extra: 1 })).toEqual({ type: 'READY', serviceId: 'a' });
    expect(parseInboundMessage({ type: 'THEME', scheme: 'dark' })).toBeNull();
    expect(parseInboundMessage({ type: 'AUTH_CHANGED' })).toBeNull();
  });
});

describe('acceptInbound', () => {
  const frame = {} as Window;
  const other = {} as Window;
  const ctx = { origin: 'https://mvv42.ru', source: frame, serviceId: 'bonds' };
  const data = { type: 'NAVIGATE', serviceId: 'bonds', path: '/x' };

  it('accepts same origin, same source, matching serviceId', () => {
    expect(acceptInbound({ origin: 'https://mvv42.ru', source: frame, data }, ctx)).toEqual(data);
  });

  it('rejects foreign origin', () => {
    expect(acceptInbound({ origin: 'https://evil.example', source: frame, data }, ctx)).toBeNull();
  });

  it('rejects messages from other windows', () => {
    expect(acceptInbound({ origin: 'https://mvv42.ru', source: other, data }, ctx)).toBeNull();
    expect(acceptInbound({ origin: 'https://mvv42.ru', source: null, data }, ctx)).toBeNull();
    expect(acceptInbound({ origin: 'https://mvv42.ru', source: frame, data }, { ...ctx, source: null })).toBeNull();
  });

  it('rejects serviceId that does not match the sending frame', () => {
    const spoof = { type: 'AUTH_REQUIRED', serviceId: 'cashpulse' };
    expect(acceptInbound({ origin: 'https://mvv42.ru', source: frame, data: spoof }, ctx)).toBeNull();
  });
});

describe('postToFrame', () => {
  it('targets the shell origin', () => {
    const postMessage = vi.fn();
    postToFrame({ postMessage } as unknown as Window, { type: 'THEME', scheme: 'dark' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'THEME', scheme: 'dark' }, window.location.origin);
  });

  it('is a no-op without a target', () => {
    expect(() => postToFrame(null, { type: 'AUTH_CHANGED' })).not.toThrow();
  });
});
