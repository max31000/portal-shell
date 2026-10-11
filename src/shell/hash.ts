/**
 * Shell routing lives in the URL hash: `#/<serviceId><servicePath>`.
 *
 * Examples:
 *   ""                          → { serviceId: null, servicePath: "/" }
 *   "#/"                        → { serviceId: null, servicePath: "/" }
 *   "#/cashpulse"               → { serviceId: "cashpulse", servicePath: "/" }
 *   "#/cashpulse/operations"    → { serviceId: "cashpulse", servicePath: "/operations" }
 *   "#/cashpulse?tab=2"         → { serviceId: "cashpulse", servicePath: "/?tab=2" }
 *   "#/cashpulse/ops?tab=2"     → { serviceId: "cashpulse", servicePath: "/ops?tab=2" }
 */
export interface HashState {
  /** Service id parsed from hash, or null for home. */
  serviceId: string | null;
  /** Path inside the service; always starts with "/" and may carry a query string. */
  servicePath: string;
}

export function parseHash(hash: string): HashState {
  const raw = hash.replace(/^#/, '');
  const qIndex = raw.indexOf('?');
  const pathPart = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = qIndex === -1 ? '' : raw.slice(qIndex);

  const parts = pathPart.split('/').filter(Boolean);
  if (parts.length === 0) {
    return { serviceId: null, servicePath: '/' };
  }
  const [serviceId, ...rest] = parts;
  const path = rest.length > 0 ? '/' + rest.join('/') : '/';
  return { serviceId, servicePath: path + query };
}

export function buildHash(serviceId: string, servicePath: string): string {
  const path = servicePath === '/' ? '' : servicePath.startsWith('/') ? servicePath : '/' + servicePath;
  return `#/${serviceId}${path}`;
}

/**
 * service.path = "/cashpulse/" (always trailing slash), initialPath = "/operations" or "/"
 * → "/cashpulse/operations" or "/cashpulse/".
 */
export function buildFrameSrc(servicePath: string, initialPath: string): string {
  const base = servicePath.replace(/\/$/, '');
  return base + (initialPath.startsWith('/') ? initialPath : '/' + initialPath);
}
