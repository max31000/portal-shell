import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isApiError } from '@mvv42/kit/platform';
import { tailLogs, type LogEntry } from './api';
import { hashString } from './series';

/** Lines kept in memory while live. */
export const LIVE_LIMIT = 1000;
/** New lines are flushed to the screen at most this often (a burst is one render). */
const FLUSH_MS = 250;
/** A stream that lived at least this long reconnects at once (after `RETRY_FAST_MS`). */
export const HEALTHY_STREAM_MS = 5000;
const RETRY_FAST_MS = 1000;
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60_000;

export interface LogLineItem {
  /** Stable key: `_time` + `_stream` + hash of `_msg` (+ `#n` for exact repeats) — React key and expanded state. */
  key: string;
  entry: LogEntry;
}

/** Key of a line without the repeat suffix. */
export function lineKey(entry: LogEntry): string {
  return `${entry._time}|${entry._stream ?? ''}|${hashString(String(entry._msg ?? '')).toString(36)}`;
}

/** Entries → items with unique stable keys (exact repeats get `#2`, `#3` …). */
export function keyLines(entries: LogEntry[], counts: Map<string, number> = new Map()): LogLineItem[] {
  return entries.map((entry) => {
    const base = lineKey(entry);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return { key: n === 1 ? base : `${base}#${n}`, entry };
  });
}

/**
 * Delay before the next tail connection. A stream that lived ≥ 5 s (VictoriaLogs closes tails periodically)
 * reconnects after 1 s; one that failed or closed sooner backs off: ≥ 5 s, doubling up to 60 s.
 */
export function nextTailDelay(previous: number, livedMs: number | null): number {
  if (livedMs !== null && livedMs >= HEALTHY_STREAM_MS) return RETRY_FAST_MS;
  return Math.min(Math.max(previous * 2, RETRY_MIN_MS), RETRY_MAX_MS);
}

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'hidden';

export interface LiveTail {
  /** Newest first. */
  lines: LogLineItem[];
  status: LiveStatus;
  /** Lines received while paused (shown on resume). */
  buffered: number;
  /** A fatal error (4xx) — the stream stopped. */
  error: unknown;
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** `document.visibilityState !== 'hidden'`, live. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
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
 * Follows `/logs/tail?query=` while `enabled` and the browser tab is visible (hidden → the stream is closed, visible
 * → reconnected, lines kept): newest first, at most `LIVE_LIMIT` kept, reconnects after the server's periodic close
 * or an error (`nextTailDelay`). While `paused` lines are buffered, not shown. A new `query` starts over.
 */
export function useLiveTail(query: string, enabled: boolean, paused: boolean): LiveTail {
  const visible = useDocumentVisible();
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
  const pending = useRef<LogLineItem[]>([]);
  const pausedRef = useRef(paused);
  const counts = useRef(new Map<string, number>());

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    counts.current = new Map();
  }, [session]);

  const fatal = state.error !== null && state.error !== undefined;
  useEffect(() => {
    if (!enabled || fatal) return;
    const ctrl = new AbortController();
    const update = (patch: Partial<LiveTail>) => {
      if (!ctrl.signal.aborted) setState((s) => ({ ...s, ...patch }));
    };
    if (!visible) return () => ctrl.abort();
    pending.current = [];

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
      pending.current.unshift(keyLines([entry], counts.current)[0]);
      if (pending.current.length > LIVE_LIMIT) pending.current.length = LIVE_LIMIT;
    };

    const run = async () => {
      let delay = 0;
      while (!ctrl.signal.aborted) {
        update({ status: 'connecting' });
        let openedAt: number | null = null;
        try {
          await tailLogs(query, onEntry, ctrl.signal, () => {
            openedAt = Date.now();
            update({ status: 'open' });
          });
        } catch (e) {
          if (ctrl.signal.aborted) return;
          // 4xx (auth lost, a bad query) will not heal by retrying.
          if (isApiError(e) && e.status >= 400 && e.status < 500) {
            update({ error: e, status: 'idle' });
            return;
          }
        }
        if (ctrl.signal.aborted) return;
        delay = nextTailDelay(delay, openedAt === null ? null : Date.now() - openedAt);
        update({ status: 'reconnecting' });
        await sleep(delay, ctrl.signal);
      }
    };
    void run();

    return () => {
      ctrl.abort();
      window.clearInterval(flush);
    };
  }, [query, enabled, visible, fatal]);

  const status: LiveStatus = enabled && !visible && !fatal ? 'hidden' : state.status;
  return { lines: state.lines, status, buffered: state.buffered, error: state.error };
}
