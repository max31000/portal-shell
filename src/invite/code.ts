/**
 * Invite-code normalisation — identical to mvv42-auth (closed-registration spec, review decision 6):
 * trim → Cyrillic look-alikes to Latin → upper case → drop spaces and dashes → Crockford (O→0, I/L→1) →
 * must match `^[0-9A-HJKMNP-TV-Z]{12}$`. A legacy base64url code (`^[A-Za-z0-9_-]{20,}$`) is used as is.
 * Anything else is rejected on the client (no request). The result is always ASCII (safe for a header).
 */

const NEW_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const LEGACY_CODE_RE = /^[A-Za-z0-9_-]{20,}$/;

/** Cyrillic letters that look like Latin ones (upper and lower case). */
const CYRILLIC_LOOKALIKES: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', х: 'x',
};
const CYRILLIC_RE = new RegExp(`[${Object.keys(CYRILLIC_LOOKALIKES).join('')}]`, 'g');

/** Whitespace and every dash people paste (hyphen, non-breaking hyphen, figure/en/em dash, minus). */
const SEPARATORS_RE = /[\s\-‐-―−]/g;

export type NormalizedInviteCode = { ok: true; value: string; legacy: boolean } | { ok: false };

export function normalizeInviteCode(raw: string): NormalizedInviteCode {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  const value = trimmed
    .replace(CYRILLIC_RE, (ch) => CYRILLIC_LOOKALIKES[ch])
    .toUpperCase()
    .replace(SEPARATORS_RE, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (NEW_CODE_RE.test(value)) return { ok: true, value, legacy: false };
  if (LEGACY_CODE_RE.test(trimmed)) return { ok: true, value: trimmed, legacy: true };
  return { ok: false };
}

/** `XXXX-XXXX-XXXX` for a new-format code; anything else (legacy, invalid) unchanged. */
export function formatInviteCode(code: string): string {
  const n = normalizeInviteCode(code);
  if (!n.ok || n.legacy) return code;
  return `${n.value.slice(0, 4)}-${n.value.slice(4, 8)}-${n.value.slice(8)}`;
}
