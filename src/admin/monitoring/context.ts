import { createContext, useContext, useEffect, useRef } from 'react';
import { useResource, type Resource } from '../useResource';
import { DEFAULT_PERIOD, type Period } from './period';

export interface MonitoringContextValue {
  period: Period;
  /** Bumped by «Обновить» and the 30 s auto-refresh: every data hook reloads in place. */
  refreshKey: number;
  /** Opens «Логи» filtered by a container. */
  openLogs: (container: string) => void;
}

export const MonitoringContext = createContext<MonitoringContextValue>({
  period: DEFAULT_PERIOD,
  refreshKey: 0,
  openLogs: () => {},
});

export function useMonitoring(): MonitoringContextValue {
  return useContext(MonitoringContext);
}

/**
 * `useResource` keyed by the period and `key` (a new period shows skeletons), reloaded in place — data stays on
 * screen — whenever `refreshKey` changes after mount.
 */
export function useMonitoringResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const { period, refreshKey } = useMonitoring();
  const resource = useResource(load, `${period.value}\n${key}`);
  const { reload } = resource;
  const seen = useRef(refreshKey);
  useEffect(() => {
    if (seen.current === refreshKey) return;
    seen.current = refreshKey;
    void reload();
  }, [refreshKey, reload]);
  return resource;
}
