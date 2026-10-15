import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, SegmentedControl, Switch } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconRefresh } from '@tabler/icons-react';
import type { LogFilters } from './api';
import { MonitoringContext, type MonitoringContextValue } from './context';
import { PERIODS, DEFAULT_PERIOD, findPeriod, type Period } from './period';
import {
  MONITORING_SECTIONS,
  isMonitoringSection,
  monitoringHash,
  parseMonitoringSection,
  type MonitoringSection,
} from './route';
import { AlertsSection } from './AlertsSection';
import { ContainersSection } from './ContainersSection';
import { HttpSection } from './HttpSection';
import { LogsSection } from './LogsSection';
import { OverviewSection } from './OverviewSection';
import { ServerSection } from './ServerSection';
import classes from './Monitoring.module.css';

/** Auto-refresh interval. */
export const REFRESH_MS = 30_000;

const EMPTY_LOG_FILTERS: LogFilters = { containers: [], levels: [], text: '', raw: false };

/**
 * «Мониторинг» (spec `2026-10-16-monitoring-ui.md`): sections over the monitoring proxy, a shared period and
 * refresh. The section lives in the hash (`history.replaceState`, no new history entries) — the shell only
 * knows `#/admin/monitoring`.
 */
export function MonitoringTab() {
  const [section, setSection] = useState<MonitoringSection>(() => parseMonitoringSection(window.location.hash));
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [refreshKey, setRefreshKey] = useState(0);
  const [auto, setAuto] = useState(true);
  const [logFilters, setLogFilters] = useState<LogFilters>(EMPTY_LOG_FILTERS);
  const isPhone = useMediaQuery('(max-width: 48em)') ?? false;

  // The shell wrote `#/admin/monitoring`; keep the section part in sync without adding history entries.
  useEffect(() => {
    const hash = monitoringHash(section);
    if (window.location.hash !== hash) history.replaceState(history.state, '', hash);
  }, [section]);

  // Back / Forward between two monitoring URLs keeps this tab mounted.
  useEffect(() => {
    const onHashChange = () => setSection(parseMonitoringSection(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Every 30 s while the browser tab is visible; a tick missed while hidden fires on return.
  const missed = useRef(false);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') missed.current = true;
      else refresh();
    }, REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden' && missed.current) {
        missed.current = false;
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [auto, refresh]);

  const openLogs = useCallback((container: string) => {
    setLogFilters({ ...EMPTY_LOG_FILTERS, containers: [container] });
    setSection('logs');
  }, []);

  const context = useMemo<MonitoringContextValue>(() => ({ period, refreshKey, openLogs }), [period, refreshKey, openLogs]);
  const sectionData = MONITORING_SECTIONS.map((s) => ({ value: s.value, label: s.label }));

  return (
    <MonitoringContext.Provider value={context}>
      <div className={classes.header}>
        {isPhone ? (
          <Select
            className={classes.sectionSelect}
            aria-label="Раздел мониторинга"
            data={sectionData}
            value={section}
            onChange={(v) => isMonitoringSection(v) && setSection(v)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
        ) : (
          <SegmentedControl
            aria-label="Раздел мониторинга"
            data={sectionData}
            value={section}
            onChange={(v) => isMonitoringSection(v) && setSection(v)}
          />
        )}
        <div className={classes.controls}>
          <SegmentedControl
            aria-label="Период"
            size="xs"
            data={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            value={period.value}
            onChange={(v) => setPeriod(findPeriod(v))}
          />
          <Button variant="default" size="xs" leftSection={<IconRefresh size={14} stroke={1.75} />} onClick={refresh}>
            Обновить
          </Button>
          <Switch
            size="sm"
            label="Авто 30 с"
            checked={auto}
            onChange={(e) => setAuto(e.currentTarget.checked)}
            aria-label="Автообновление каждые 30 секунд"
          />
        </div>
      </div>

      {section === 'overview' && <OverviewSection onOpenAlerts={() => setSection('alerts')} />}
      {section === 'server' && <ServerSection />}
      {section === 'containers' && <ContainersSection />}
      {section === 'http' && <HttpSection />}
      {section === 'logs' && <LogsSection filters={logFilters} onFiltersChange={setLogFilters} />}
      {section === 'alerts' && <AlertsSection />}
    </MonitoringContext.Provider>
  );
}
