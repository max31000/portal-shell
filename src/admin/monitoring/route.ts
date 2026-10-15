import { adminHash } from '../route';

/** Sections of the «Мониторинг» tab; the tab keeps the current one in `#/admin/monitoring[/<section>]`. */
export const MONITORING_SECTIONS = [
  { value: 'overview', label: 'Обзор' },
  { value: 'server', label: 'Сервер' },
  { value: 'containers', label: 'Контейнеры' },
  { value: 'http', label: 'HTTP' },
  { value: 'logs', label: 'Логи' },
  { value: 'alerts', label: 'Алерты' },
] as const;

export type MonitoringSection = (typeof MONITORING_SECTIONS)[number]['value'];

export function isMonitoringSection(v: unknown): v is MonitoringSection {
  return typeof v === 'string' && MONITORING_SECTIONS.some((s) => s.value === v);
}

/** `#/admin/monitoring/http?x` → `http`; anything else → `overview`. */
export function parseMonitoringSection(hash: string): MonitoringSection {
  const segments = hash.replace(/^#/, '').split('?')[0].split('/').filter(Boolean);
  const section = segments[0] === 'admin' && segments[1] === 'monitoring' ? segments[2] : undefined;
  return isMonitoringSection(section) ? section : 'overview';
}

export function monitoringHash(section: MonitoringSection): string {
  const base = adminHash('monitoring');
  return section === 'overview' ? base : `${base}/${section}`;
}
