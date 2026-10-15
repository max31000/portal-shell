import type { Period } from './period';
import type { Unit } from './units';

const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];

/** 1, 2, 2.5, 5 × 10ⁿ — the smallest «nice» step ≥ `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * base;
}

/** Fraction digits that show every multiple of `step` exactly (0.25 → 2, 0.02 → 2, 2.5 → 1, 25 → 0). */
export function stepDecimals(step: number): number {
  for (let d = 0; d <= 10; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return 10;
}

export interface ValueAxis {
  /** Tick values in the metric's own unit (bytes, seconds …), from 0. */
  ticks: number[];
  /** Domain top (the last tick). */
  max: number;
  /** Tick label: enough precision for the step, so no two labels repeat. */
  format: (value: number) => string;
}

/** Display scale of an axis: bytes pick a binary multiple, seconds go to ms below 1 s. */
function scaleOf(top: number, unit: Unit): { scale: number; suffix: string } {
  switch (unit) {
    case 'bytes':
    case 'bytesPerSec': {
      const k = top > 0 ? Math.min(BYTE_UNITS.length - 1, Math.max(0, Math.floor(Math.log(top) / Math.log(1024)))) : 0;
      return { scale: 1024 ** k, suffix: ` ${BYTE_UNITS[k]}${unit === 'bytesPerSec' ? '/с' : ''}` };
    }
    case 'seconds':
      return top < 1 ? { scale: 0.001, suffix: ' мс' } : { scale: 1, suffix: ' с' };
    case 'percent':
      return { scale: 1, suffix: '%' };
    default:
      return { scale: 1, suffix: '' };
  }
}

/**
 * Y axis for values up to `dataMax` (or a fixed `yMax`): ~`count` nice ticks from 0 and a formatter whose precision
 * follows the step — small rates read «0,02 0,04 …», never «0,1 0,1 0».
 */
export function valueAxis(dataMax: number, unit: Unit, yMax?: number, count = 5): ValueAxis {
  const top = yMax ?? (Number.isFinite(dataMax) && dataMax > 0 ? dataMax : 0);
  const { scale, suffix } = scaleOf(top, unit);
  const scaledTop = top / scale;
  let step = niceStep(scaledTop > 0 ? scaledTop / count : 1);
  if (unit === 'count' && step < 1) step = 1;
  const decimals = stepDecimals(step);
  const n = Math.max(1, Math.ceil(scaledTop / step - 1e-9));
  const ticks = Array.from({ length: n + 1 }, (_, i) => Number((i * step).toFixed(decimals)) * scale);
  const format = (v: number) =>
    `${(v / scale).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: decimals })}${suffix}`;
  return { ticks, max: ticks[ticks.length - 1], format };
}

const MINUTE = 60_000;
const TIME_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720].map((m) => m * MINUTE);
const DATE_STEPS = [1, 2, 3, 5, 7, 10, 14];

/**
 * X ticks over the whole window `[startMs, endMs)`, at local round times: minutes/hours from local midnight, or
 * local midnights (every N days) for 7d/30d — at most `maxTicks`, labels never repeat.
 */
export function timeTicks(startMs: number, endMs: number, axis: Period['axis'], maxTicks: number): number[] {
  const span = endMs - startMs;
  const out: number[] = [];
  const day = new Date(startMs);
  day.setHours(0, 0, 0, 0);
  if (axis === 'date') {
    const days = DATE_STEPS.find((d) => span / (d * 1440 * MINUTE) <= maxTicks) ?? DATE_STEPS[DATE_STEPS.length - 1];
    // Calendar arithmetic (setDate) keeps midnights through DST changes.
    for (const cur = new Date(day); cur.getTime() < endMs; cur.setDate(cur.getDate() + days)) {
      if (cur.getTime() >= startMs) out.push(cur.getTime());
    }
    return out;
  }
  const step = TIME_STEPS.find((s) => span / s <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1];
  for (let t = day.getTime(); t < endMs; t += step) if (t >= startMs) out.push(t);
  return out;
}
