import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  /** True while the first load (or a reload after an error) runs; background reloads keep the data. */
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads `load()` on mount and whenever `key` changes. `reload()` re-runs it keeping the current data on
 * screen (no flash); responses that arrive after a newer request are dropped.
 */
export function useResource<T>(load: () => Promise<T>, key: string | number = ''): Resource<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean; key: string | number }>({
    data: undefined,
    error: null,
    loading: true,
    key,
  });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const seq = useRef(0);

  if (state.key !== key) setState({ data: undefined, error: null, loading: true, key });

  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => (s.data === undefined ? { ...s, loading: true, error: null } : s));
    try {
      const data = await loadRef.current();
      if (id === seq.current) setState((s) => ({ ...s, data, error: null, loading: false }));
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run, key]);

  return { data: state.data, error: state.error, loading: state.loading, reload: run };
}
