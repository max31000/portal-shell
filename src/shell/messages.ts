/**
 * Shell ↔ service postMessage protocol (spec §3.3, §9.16).
 *
 * service → shell: NAVIGATE {serviceId, path}, AUTH_REQUIRED {serviceId}, READY {serviceId}
 * shell → service: THEME {scheme}, AUTH_CHANGED {}
 *
 * Everything is same-origin: outbound uses targetOrigin = location.origin; inbound is accepted only when
 * event.origin === location.origin, event.source is the active service iframe, and serviceId matches it.
 */

export type ColorScheme = 'light' | 'dark';

export interface NavigateMessage {
  type: 'NAVIGATE';
  serviceId: string;
  /** Path inside the service, starting with "/" (may include ?query). */
  path: string;
}

export interface AuthRequiredMessage {
  type: 'AUTH_REQUIRED';
  serviceId: string;
}

export interface ReadyMessage {
  type: 'READY';
  serviceId: string;
}

export interface ThemeMessage {
  type: 'THEME';
  scheme: ColorScheme;
}

export interface AuthChangedMessage {
  type: 'AUTH_CHANGED';
}

export type InboundMessage = NavigateMessage | AuthRequiredMessage | ReadyMessage;
export type OutboundMessage = ThemeMessage | AuthChangedMessage;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function hasServiceId(v: Record<string, unknown>): boolean {
  return typeof v.serviceId === 'string' && v.serviceId.length > 0;
}

export function isNavigateMessage(v: unknown): v is NavigateMessage {
  return (
    isRecord(v) &&
    v.type === 'NAVIGATE' &&
    hasServiceId(v) &&
    typeof v.path === 'string' &&
    v.path.startsWith('/')
  );
}

export function isAuthRequiredMessage(v: unknown): v is AuthRequiredMessage {
  return isRecord(v) && v.type === 'AUTH_REQUIRED' && hasServiceId(v);
}

export function isReadyMessage(v: unknown): v is ReadyMessage {
  return isRecord(v) && v.type === 'READY' && hasServiceId(v);
}

export function parseInboundMessage(v: unknown): InboundMessage | null {
  if (isNavigateMessage(v)) return { type: 'NAVIGATE', serviceId: v.serviceId, path: v.path };
  if (isAuthRequiredMessage(v)) return { type: 'AUTH_REQUIRED', serviceId: v.serviceId };
  if (isReadyMessage(v)) return { type: 'READY', serviceId: v.serviceId };
  return null;
}

export interface InboundContext {
  /** Expected origin — always the shell's own `location.origin`. */
  origin: string;
  /** contentWindow of the iframe currently showing `serviceId`. */
  source: MessageEventSource | null;
  serviceId: string;
}

/** Full acceptance check for a message arriving at the shell. Returns null when it must be ignored. */
export function acceptInbound(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  ctx: InboundContext,
): InboundMessage | null {
  if (event.origin !== ctx.origin) return null;
  if (!ctx.source || event.source !== ctx.source) return null;
  const msg = parseInboundMessage(event.data);
  if (!msg || msg.serviceId !== ctx.serviceId) return null;
  return msg;
}

/** Post a shell → service message to a frame, pinned to our own origin. */
export function postToFrame(target: Window | null | undefined, msg: OutboundMessage): void {
  target?.postMessage(msg, window.location.origin);
}
