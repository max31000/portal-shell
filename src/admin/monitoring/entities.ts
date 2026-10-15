import { chartColors } from '@mvv42/kit/charts';
import type { Labels } from './api';

/** `service` label values of the HTTP metrics (Vector), in the fixed order that sets chart colours. */
export const HTTP_SERVICES = [
  'portal',
  'auth',
  'cashpulse',
  'bonds',
  'credit_calc',
  'keysynth',
  'bliss',
  'monitoring',
  'other',
] as const;

/** Containers of the monitoring stack run in the host network: their network counters are the host's. */
export function isHostNetworkContainer(name: string): boolean {
  return name.startsWith('mvv42-mon-');
}

/** Response classes, coloured by meaning. */
export const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const;
export const STATUS_CLASS_COLORS: Record<string, string> = {
  '2xx': chartColors.positive,
  '3xx': chartColors.info,
  '4xx': chartColors.warning,
  '5xx': chartColors.negative,
};

/** Log levels: chart colours (by severity) and badge colours. */
export const LEVEL_COLORS: Record<string, string> = {
  critical: 'var(--mvv-danger)',
  error: 'color-mix(in srgb, var(--mvv-danger) 60%, var(--mvv-warning))',
  warn: 'var(--mvv-warning)',
  info: 'var(--mvv-info)',
  debug: 'var(--mvv-text-3)',
};

export const LEVEL_BADGE: Record<string, { color: string; variant: 'filled' | 'light' }> = {
  critical: { color: 'red', variant: 'filled' },
  error: { color: 'red', variant: 'light' },
  warn: { color: 'yellow', variant: 'light' },
  info: { color: 'blue', variant: 'light' },
  debug: { color: 'gray', variant: 'light' },
};

/** Probe jobs (blackbox): what each one checks. */
export const PROBE_JOB_LABEL: Record<string, string> = {
  health: 'health-эндпоинт',
  edge: 'снаружи, через nginx',
  vpn: 'TCP-порт VPN',
};

/** Shared legend helpers. */
export const legend = {
  label: (name: string, fallback = '—') => (m: Labels) => m[name] || fallback,
  fixed: (text: string) => () => text,
};
