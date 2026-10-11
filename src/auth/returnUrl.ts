/**
 * Sanitise the `?return=` target after login (spec §9.10): resolve against our origin, accept only the
 * same origin with a path that starts with "/" but not "//" or "/\". Anything else → "/".
 */
export function sanitizeReturnUrl(ret: string | null | undefined, origin: string = window.location.origin): string {
  if (!ret) return '/';
  let url: URL;
  try {
    url = new URL(ret, origin);
  } catch {
    return '/';
  }
  if (url.origin !== origin) return '/';
  const path = url.pathname;
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/';
  // Also refuse raw input that a looser parser might read as protocol-relative.
  if (/^[/\\]{2}/.test(ret) || /^\/\\/.test(ret)) return '/';
  return path + url.search + url.hash;
}
