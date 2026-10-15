import { useEffect, useRef, useState } from 'react';
import { isApiError } from '@mvv42/kit/platform';
import { tailLogs, type LogEntry } from './api';

/** Lines kept in memory while live. */
export const LIVE_LIMIT = 1000;
/** New lines are flushed to the screen at most this often (a burst is one render). */
const FLUSH_MS = 250;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

export interface LiveLine {
  /** Stable id for React keys and the expanded state. */
  id: number;
  entry: LogEntry;
}

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface LiveTail {
  lines: LiveLine[];
  status: LiveStatus;
  /** Lines received while paused (shown on resume). */
  buffered: number;
  /** A fatal error (401/403) — the stream stopped. */
  error: unknown;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    });
  });
}

/**
 * Follows `/logs/tail?query=` while `enabled`: newest lines first, at most `LIVE_LIMIT` kept, reconnects after the
 * server's periodic close or a network error (backoff 1 s → 30 s). While `paused` lines are buffered, not shown.
 * A new `query` starts over.
 */
export function useLiveTail(query: string, enabled: boolean, paused: boolean): LiveTail {
  // One session per (query, enabled): a new one starts empty (reset during render, not in the effect).
  const session = enabled ? query : null;
  const [state, setState] = useState<LiveTail & { session: string | null }>({
    session,
    lines: [],
    status: 'idle',
    buffered: 0,
    error: null,
  });
  if (state.session !== session) {
    setState({ session, lines: [], status: enabled ? 'connecting' : 'idle', buffered: 0, error: null });
  }
  const pending = useRef<LiveLine[]>([]);
  const pausedRef = useRef(paused);
  const seq = useRef(0);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    pending.current = [];
    const update = (patch: Partial<LiveTail>) => {
      if (!ctrl.signal.aborted) setState((s) => ({ ...s, ...patch }));
    };

    const flush = window.setInterval(() => {
      if (pending.current.length === 0) return;
      if (pausedRef.current) {
        update({ buffered: pending.current.length });
        return;
      }
      const fresh = pending.current;
      pending.current = [];
      setState((s) => ({ ...s, buffered: 0, lines: [...fresh, ...s.lines].slice(0, LIVE_LIMIT) }));
    }, FLUSH_MS);

    const onEntry = (entry: LogEntry) => {
      pending.current.unshift({ id: ++seq.current, entry });
      if (pending.current.length > LIVE_LIMIT) pending.current.length = LIVE_LIMIT;
    };

    const run = async () => {
      let delay = RETRY_MIN_MS;
      while (!ctrl.signal.aborted) {
        update({ status: 'connecting' });
        try {
          await tailLogs(query, onEntry, ctrl.signal, () => {
            delay = RETRY_MIN_MS;
            update({ status: 'open' });
          });
        } catch (e) {
          if (ctrl.signal.aborted) return;
          // 4xx (auth lost, a bad query) will not heal by retrying.
          if (isApiError(e) && e.status >= 400 && e.status < 500) {
            update({ error: e, status: 'idle' });
            return;
          }
          delay = Math.min(delay * 2, RETRY_MAX_MS);
        }
        if (ctrl.signal.aborted) return;
        update({ status: 'reconnecting' });
        await sleep(delay, ctrl.signal);
      }
    };
    void run();

    return () => {
      ctrl.abort();
      window.clearInterval(flush);
    };
  }, [query, enabled]);

  return { lines: state.lines, status: state.status, buffered: state.buffered, error: state.error };
}
