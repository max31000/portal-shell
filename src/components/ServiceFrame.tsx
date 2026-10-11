import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { IconArrowUpRight, IconRefresh } from '@tabler/icons-react';
import type { Service } from '../types';
import {
  acceptInbound,
  postToFrame,
  type AuthRequiredMessage,
  type ColorScheme,
  type NavigateMessage,
  type OutboundMessage,
} from '../shell/messages';
import { buildFrameSrc } from '../shell/hash';
import { AppIcon } from './AppIcon';
import classes from './ServiceFrame.module.css';
import ui from './ui.module.css';

const TIMEOUT_MS = 15_000;

export interface ServiceFrameHandle {
  /** Post a shell → service message to the current iframe. */
  post: (msg: OutboundMessage) => void;
}

interface ServiceFrameProps {
  service: Service;
  /** Path inside the service ("/" or "/operations?x=1"). */
  initialPath?: string;
  /** Resolved colour scheme (never 'auto'); pushed to the service as THEME. */
  scheme: ColorScheme;
  /** Validated NAVIGATE / AUTH_REQUIRED from this service's iframe. */
  onServiceMessage?: (msg: NavigateMessage | AuthRequiredMessage) => void;
  ref?: Ref<ServiceFrameHandle>;
}

type LoadState = 'loading' | 'loaded' | 'timeout';

/** Renders one service. Mount with `key={service.id}` so switching services starts fresh. */
export function ServiceFrame({ service, initialPath = '/', scheme, onServiceMessage, ref }: ServiceFrameProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const src = buildFrameSrc(service.path, initialPath);

  // A new src (e.g. Back/Forward inside the service) is a new load.
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setState('loading');
  }

  const post = useCallback((msg: OutboundMessage) => {
    postToFrame(iframeRef.current?.contentWindow, msg);
  }, []);

  useImperativeHandle(ref, () => ({ post }), [post]);

  // Load timeout, restarted on retry or when the src changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      setState((s) => (s === 'loading' ? 'timeout' : s));
    }, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [attempt, src]);

  // Push theme changes to the running service.
  useEffect(() => {
    post({ type: 'THEME', scheme });
  }, [scheme, post]);

  // Inbound messages: only from this iframe, our origin, and this service id.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = acceptInbound(e, {
        origin: window.location.origin,
        source: iframeRef.current?.contentWindow ?? null,
        serviceId: service.id,
      });
      if (!msg) return;
      if (msg.type === 'READY') {
        post({ type: 'THEME', scheme });
        return;
      }
      onServiceMessage?.(msg);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [service.id, scheme, post, onServiceMessage]);

  function handleLoad() {
    setState('loaded');
    // Services that predate the READY handshake still get the theme.
    post({ type: 'THEME', scheme });
  }

  function retry() {
    setState('loading');
    setAttempt((n) => n + 1);
  }

  return (
    <div className={classes.root}>
      <div className={classes.progress} data-state={state} aria-hidden="true" />
      {state === 'loading' && (
        <span className="visually-hidden" role="status">
          Загрузка {service.name}…
        </span>
      )}

      <iframe
        key={attempt}
        ref={iframeRef}
        src={src}
        title={service.name}
        onLoad={handleLoad}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        className={classes.frame}
        data-hidden={state === 'timeout' || undefined}
      />

      {state === 'timeout' && (
        <div className={classes.timeout} role="alert">
          <AppIcon icon={service.icon} name={service.name} color={service.color} size={56} />
          <h2 className={classes.timeoutTitle}>Сервис не отвечает</h2>
          <p className={classes.timeoutText}>
            {service.name} не загрузился за {TIMEOUT_MS / 1000} секунд. Попробуйте ещё раз или откройте его
            отдельно.
          </p>
          <div className={classes.actions}>
            <button type="button" className={ui.primaryButton} onClick={retry}>
              <IconRefresh size={16} stroke={2} aria-hidden="true" />
              Повторить
            </button>
            <a className={ui.secondaryButton} href={src} target="_blank" rel="noopener">
              Открыть отдельно
              <IconArrowUpRight size={16} stroke={2} aria-hidden="true" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
