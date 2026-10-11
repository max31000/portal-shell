import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from './hash';

describe('parseHash', () => {
  it.each([
    ['', { serviceId: null, servicePath: '/' }],
    ['#', { serviceId: null, servicePath: '/' }],
    ['#/', { serviceId: null, servicePath: '/' }],
    ['#/cashpulse', { serviceId: 'cashpulse', servicePath: '/' }],
    ['#/cashpulse/', { serviceId: 'cashpulse', servicePath: '/' }],
    ['#/cashpulse/operations', { serviceId: 'cashpulse', servicePath: '/operations' }],
    ['#/cashpulse/a/b', { serviceId: 'cashpulse', servicePath: '/a/b' }],
    ['#/cashpulse?tab=2', { serviceId: 'cashpulse', servicePath: '/?tab=2' }],
    ['#/cashpulse/ops?tab=2&x=1', { serviceId: 'cashpulse', servicePath: '/ops?tab=2&x=1' }],
    ['#/?x=1', { serviceId: null, servicePath: '/' }],
  ])('%s', (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });
});

describe('buildHash', () => {
  it('omits root path', () => {
    expect(buildHash('cashpulse', '/')).toBe('#/cashpulse');
  });
  it('appends nested path', () => {
    expect(buildHash('cashpulse', '/operations')).toBe('#/cashpulse/operations');
  });
  it('keeps query strings', () => {
    expect(buildHash('bonds', '/list?sort=ytm')).toBe('#/bonds/list?sort=ytm');
  });
  it('normalises missing leading slash', () => {
    expect(buildHash('bonds', 'list')).toBe('#/bonds/list');
  });
  it('round-trips through parseHash', () => {
    for (const p of ['/', '/a', '/a/b', '/?q=1', '/a?q=1']) {
      expect(parseHash(buildHash('svc', p))).toEqual({ serviceId: 'svc', servicePath: p });
    }
  });
});
