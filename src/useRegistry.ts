import { useState, useEffect } from 'react';
import type { Service } from './types';

/** Ids reserved by mvv42-auth / the shell (`#/admin` is the owner console) — never services. */
export const RESERVED_IDS: ReadonlySet<string> = new Set(['admin', 'auth', 'api', 'assets', 'health', '.well-known', 'portal']);

export function visibleServices(services: Service[] | undefined): Service[] {
  return (services ?? []).filter((s) => s && typeof s.id === 'string' && !RESERVED_IDS.has(s.id));
}

interface RegistryState {
  services: Service[];
  loading: boolean;
  error: string | null;
}

export function useRegistry(): RegistryState {
  const [state, setState] = useState<RegistryState>({
    services: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    fetch('/registry.json', { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { services: Service[] }) => {
        if (!cancelled) {
          setState({ services: visibleServices(data.services), loading: false, error: null });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setState({ services: [], loading: false, error: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
