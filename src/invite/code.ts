/**
 * Invite-code normalisation — identical to mvv42-auth (closed-registration spec, review decision 6); the shared test
 * vectors live in `code-vectors.json` (copied into the server tests):
 * trim (explicit whitespace set) → Cyrillic look-alikes to Latin → ASCII upper case → drop whitespace and dashes →
 * Crockford (O→0, I/L→1) → must match `^[0-9A-HJKMNP-TV-Z]{12}$`. A legacy base64url code (`^[A-Za-z0-9_-]{20,}$`,
 * checked on the trimmed input) is used as is. Anything else is rejected on the client (no request).
 * Case mapping is per character and only for ASCII / the Cyrillic look-alikes — no full Unicode case mapping
 * (`ß` → `SS`, `ﬁ` → `FI` would differ between runtimes). The result is always ASCII (safe for a header).
 */

const NEW_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const LEGACY_CODE_RE = /^[A-Za-z0-9_-]{20,}$/;

/**
 * Whitespace stripped at the ends and inside: space, tab, CR, LF, NBSP, U+2000–U+200B (en quad … zero-width space),
 * narrow NBSP, medium math space, ideographic space, BOM.
 */
const WHITESPACE = ' \t\n\r\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF';
/** Dashes removed inside: ASCII hyphen-minus, U+2010–U+2015 (hyphen … horizontal bar), U+2212 minus. */
const DASHES = '\\-\u2010-\u2015\u2212';

const TRIM_RE = new RegExp(`^[${WHITESPACE}]+|[${WHITESPACE}]+$`, 'g');
const SEPARATORS = new RegExp(`^[${WHITESPACE}${DASHES}]$`);

/** Cyrillic letters that look like Latin ones (upper and lower case) → Latin upper case. */
const CYRILLIC_LOOKALIKES: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X',
  а: 'A', в: 'B', е: 'E', к: 'K', м: 'M', н: 'H', о: 'O', р: 'P', с: 'C', т: 'T', х: 'X',
};

/** One character → its normalised form ('' = dropped). Unknown characters stay and fail the regex. */
function mapChar(ch: string): string {
  if (SEPARATORS.test(ch)) return '';
  const code = ch.charCodeAt(0);
  // Cyrillic look-alikes → Latin upper; ASCII a–z → A–Z; everything else keeps its case.
  const up = CYRILLIC_LOOKALIKES[ch] ?? (code >= 0x61 && code <= 0x7a ? String.fromCharCode(code - 0x20) : ch);
  if (up === 'O') return '0';
  if (up === 'I' || up === 'L') return '1';
  return up;
}

export type NormalizedInviteCode = { ok: true; value: string; legacy: boolean } | { ok: false };

export function normalizeInviteCode(raw: string): NormalizedInviteCode {
  const trimmed = raw.replace(TRIM_RE, '');
  if (!trimmed) return { ok: false };
  let value = '';
  for (const ch of trimmed) value += mapChar(ch); // for…of walks code points (astral chars stay whole)
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
