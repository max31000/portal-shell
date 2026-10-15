import type { TimeWindow } from './api';

export interface Period {
  value: '1h' | '6h' | '24h' | '7d' | '30d';
  label: string;
  /** Length, seconds. */
  seconds: number;
  /** `query_range` step, seconds (~240–360 points). */
  step: number;
  /** Axis labels: time of day or the date. */
  axis: 'time' | 'date';
}

export const PERIODS: readonly Period[] = [
  { value: '1h', label: '1ч', seconds: 3600, step: 15, axis: 'time' },
  { value: '6h', label: '6ч', seconds: 6 * 3600, step: 60, axis: 'time' },
  { value: '24h', label: '24ч', seconds: 86_400, step: 300, axis: 'time' },
  { value: '7d', label: '7д', seconds: 7 * 86_400, step: 1800, axis: 'date' },
  { value: '30d', label: '30д', seconds: 30 * 86_400, step: 7200, axis: 'date' },
];

export const DEFAULT_PERIOD: Period = PERIODS[1];

export function findPeriod(value: string | null | undefined): Period {
  return PERIODS.find((p) => p.value === value) ?? DEFAULT_PERIOD;
}

/** The period ending now, unix seconds. */
export function periodWindow(period: Period, now: number = Date.now()): TimeWindow {
  const end = Math.floor(now / 1000);
  return { start: end - period.seconds, end, step: period.step };
}

/** Bucket of the log histogram: ~60 bars over the period. */
export function hitsStep(period: Period): string {
  return `${Math.round(period.seconds / 60)}s`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Axis label, local time: `HH:mm`, or `dd.MM` for 7d/30d. */
export function formatAxisTime(ms: number, axis: Period['axis']): string {
  const d = new Date(ms);
  return axis === 'date' ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}` : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Tooltip / list time, local: `dd.MM HH:mm[:ss]`. */
export function formatStamp(ms: number, seconds = false): string {
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ''}`;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${time}`;
}
