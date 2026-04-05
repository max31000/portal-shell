import { useState, useEffect } from 'react';
import type { Service } from './types';

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
          setState({ services: data.services ?? [], loading: false, error: null });
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
