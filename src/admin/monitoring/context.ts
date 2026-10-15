import { createContext, useContext, useEffect, useRef } from 'react';
import { useResource, type Resource } from '../useResource';
import { DEFAULT_PERIOD, type Period } from './period';

export interface MonitoringContextValue {
  period: Period;
  /** Bumped by «Обновить» and the 30 s auto-refresh: every data hook reloads in place. */
  refreshKey: number;
  /** The last bump came from the auto-refresh timer (a hook still loading skips it). */
  refreshAuto: boolean;
  /** Opens «Логи» filtered by a container. */
  openLogs: (container: string) => void;
}

export const MonitoringContext = createContext<MonitoringContextValue>({
  period: DEFAULT_PERIOD,
  refreshKey: 0,
  refreshAuto: false,
  openLogs: () => {},
});

export function useMonitoring(): MonitoringContextValue {
  return useContext(MonitoringContext);
}

export interface MonitoringResourceOptions {
  /** Ignore refreshes (e.g. the log search while Live is on). */
  frozen?: boolean;
}

/**
 * `useResource` keyed by the period and `key` (a new period shows skeletons and aborts the old requests), reloaded
 * in place — data stays on screen — whenever `refreshKey` changes after mount. An auto-refresh tick is skipped
 * while the previous load is still pending; «Обновить» restarts it.
 */
export function useMonitoringResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
  { frozen = false }: MonitoringResourceOptions = {},
): Resource<T> {
  const { period, refreshKey, refreshAuto } = useMonitoring();
  const resource = useResource(load, `${period.value}\n${key}`);
  const { reload } = resource;
  const seen = useRef(refreshKey);
  useEffect(() => {
    if (seen.current === refreshKey) return;
    seen.current = refreshKey;
    if (!frozen) void reload({ skipIfPending: refreshAuto });
  }, [refreshKey, refreshAuto, frozen, reload]);
  return resource;
}
