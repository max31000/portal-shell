/** Value units of the monitoring charts and tiles. `percent` values are 0…100. */
export type Unit = 'percent' | 'bytes' | 'bytesPerSec' | 'rps' | 'perMin' | 'seconds' | 'count';

const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];

/** Up to one decimal below 10, none above; ru-RU separators. */
function num(n: number, maxDigits = n !== 0 && Math.abs(n) < 10 ? 1 : 0): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: maxDigits });
}

/** Binary multiples: 1536 → «1,5 КБ». */
export function formatBytes(n: number): string {
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${n < 0 ? '−' : ''}${num(v)} ${BYTE_UNITS[i]}`;
}

/** Seconds → «250 мс» / «1,2 с». */
export function formatSeconds(s: number): string {
  if (Math.abs(s) < 1) return `${num(s * 1000, Math.abs(s) < 0.01 ? 1 : 0)} мс`;
  return `${num(s, 1)} с`;
}

/** Full value with its unit (tooltips, tables, tiles); null → «—». */
export function formatValue(v: number | null | undefined, unit: Unit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'percent':
      return `${num(v)}%`;
    case 'bytes':
      return formatBytes(v);
    case 'bytesPerSec':
      return `${formatBytes(v)}/с`;
    case 'rps':
      return `${num(v, Math.abs(v) < 1 ? 2 : 1)} запр/с`;
    case 'perMin':
      return `${num(v, Math.abs(v) < 1 ? 2 : 1)} /мин`;
    case 'seconds':
      return formatSeconds(v);
    case 'count':
      return num(v, 0);
  }
}

/** Uptime: «3 дн 4 ч», «5 ч 12 мин», «42 мин». */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} дн ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}
