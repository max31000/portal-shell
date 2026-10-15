import { describe, expect, it } from 'vitest';
import { niceStep, stepDecimals, timeTicks, valueAxis } from './axis';
import { formatAxisTime } from './period';
import type { Unit } from './units';

const labels = (max: number, unit: Unit, yMax?: number) => {
  const a = valueAxis(max, unit, yMax);
  return a.ticks.map(a.format);
};

describe('value axis', () => {
  it('nice steps and the decimals they need', () => {
    expect([0.013, 0.03, 0.18, 0.4, 7, 23].map(niceStep)).toEqual([0.02, 0.05, 0.2, 0.5, 10, 25]);
    expect([0.02, 0.25, 2.5, 25, 5].map(stepDecimals)).toEqual([2, 2, 1, 0, 0]);
  });

  it('small rates get enough precision and never repeat a label', () => {
    // The real 6h HTTP chart: max ≈ 0.1 req/s used to read «0,1 0,1 0 0 0».
    const ticks = labels(0.1, 'rps');
    expect(ticks).toEqual(['0', '0,02', '0,04', '0,06', '0,08', '0,1']);
    for (const [max, unit] of [
      [0.1, 'rps'],
      [0.003, 'rps'],
      [0.37, 'seconds'],
      [2.4, 'seconds'],
      [3.2 * 1024 ** 3, 'bytes'],
      [900, 'bytesPerSec'],
      [7, 'count'],
      [0.4, 'percent'],
      [0, 'rps'],
    ] as [number, Unit][]) {
      const l = labels(max, unit);
      expect(new Set(l).size, `${unit} ${max}: ${l.join(' ')}`).toBe(l.length);
      expect(valueAxis(max, unit).max).toBeGreaterThanOrEqual(max);
    }
  });

  it('units follow the scale: ms below a second, binary byte multiples', () => {
    expect(labels(0.37, 'seconds')).toEqual(['0 мс', '100 мс', '200 мс', '300 мс', '400 мс']);
    expect(labels(3.2 * 1024 ** 3, 'bytes')).toEqual(['0 ГБ', '1 ГБ', '2 ГБ', '3 ГБ', '4 ГБ']);
    expect(labels(50, 'percent', 100)).toEqual(['0%', '20%', '40%', '60%', '80%', '100%']);
    expect(labels(3, 'count')).toEqual(['0', '1', '2', '3']);
  });
});

describe('time ticks', () => {
  const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

  it('6h: round local hours inside the window', () => {
    const ticks = timeTicks(at(2026, 10, 16, 4, 23), at(2026, 10, 16, 10, 23), 'time', 8);
    expect(ticks.map((t) => formatAxisTime(t, 'time'))).toEqual(['05:00', '06:00', '07:00', '08:00', '09:00', '10:00']);
  });

  it('24h ending exactly on a tick does not repeat the label', () => {
    const ticks = timeTicks(at(2026, 10, 15, 3), at(2026, 10, 16, 3), 'time', 8);
    const l = ticks.map((t) => formatAxisTime(t, 'time'));
    expect(new Set(l).size).toBe(l.length);
  });

  it('7d / 30d: local midnights, no repeated dates', () => {
    const week = timeTicks(at(2026, 10, 9, 13, 5), at(2026, 10, 16, 13, 5), 'date', 8);
    expect(week.map((t) => formatAxisTime(t, 'date'))).toEqual(['10.10', '11.10', '12.10', '13.10', '14.10', '15.10', '16.10']);
    expect(week.every((t) => new Date(t).getHours() === 0 && new Date(t).getMinutes() === 0)).toBe(true);

    const month = timeTicks(at(2026, 9, 16, 13), at(2026, 10, 16, 13), 'date', 8);
    const l = month.map((t) => formatAxisTime(t, 'date'));
    expect(month.length).toBeLessThanOrEqual(8);
    expect(new Set(l).size).toBe(l.length);
    expect(month.every((t) => new Date(t).getHours() === 0)).toBe(true);
  });
});
