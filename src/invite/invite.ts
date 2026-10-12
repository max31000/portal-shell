/**
 * Invite links (spec §3.2, §10.10): `https://mvv42.ru/?invite=<code>`.
 * On boot the shell removes `?invite=` from the URL at once (history.replaceState) and keeps the code in
 * sessionStorage until the visitor has signed in and the redeem finished (so a login round-trip, a reload or
 * the Telegram popup cannot lose it, and the code never stays in the address bar / history).
 */
import { isApiError } from '@mvv42/kit/platform';

export const INVITE_PARAM = 'invite';
export const INVITE_STORAGE_KEY = 'mvv42-invite';
/** What the visitor typed into the login modal's code field (raw text; survives a reload / Telegram popup). */
export const INVITE_DRAFT_KEY = 'mvv42-invite-draft';

/** Codes are URL-safe tokens; anything else is ignored rather than sent to the server. */
const CODE_RE = /^[A-Za-z0-9_-]{4,128}$/;

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPendingInvite(): string | null {
  try {
    const v = session()?.getItem(INVITE_STORAGE_KEY) ?? null;
    return v && CODE_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    session()?.removeItem(INVITE_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
}

/** Stores a code for the redeem after login (e.g. typed by a known user in the login modal). */
export function storePendingInvite(code: string): void {
  try {
    session()?.setItem(INVITE_STORAGE_KEY, code);
  } catch {
    /* storage blocked */
  }
}

export function readInviteDraft(): string | null {
  try {
    return session()?.getItem(INVITE_DRAFT_KEY) || null;
  } catch {
    return null;
  }
}

export function saveInviteDraft(value: string): void {
  try {
    if (value.trim()) session()?.setItem(INVITE_DRAFT_KEY, value.slice(0, 200));
    else session()?.removeItem(INVITE_DRAFT_KEY);
  } catch {
    /* storage blocked */
  }
}

export function clearInviteDraft(): void {
  saveInviteDraft('');
}

/**
 * Moves `?invite=CODE` from the URL into sessionStorage (URL cleaned with replaceState, other params and the
 * hash kept). Returns the pending code — from the URL or one stored earlier — or null.
 */
export function captureInvite(): string | null {
  const url = new URL(window.location.href);
  if (url.searchParams.has(INVITE_PARAM)) {
    const raw = url.searchParams.get(INVITE_PARAM)?.trim() ?? '';
    url.searchParams.delete(INVITE_PARAM);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    if (CODE_RE.test(raw)) {
      // A fresh link wins over whatever was typed into the login modal earlier.
      clearInviteDraft();
      // Storage blocked → the code still lives in memory for this page.
      storePendingInvite(raw);
      return raw;
    }
  }
  return readPendingInvite();
}

const REDEEM_ERRORS: Record<string, string> = {
  invite_not_found: 'Приглашение не найдено — возможно, его удалили',
  invite_expired: 'Срок действия приглашения истёк',
  invite_exhausted: 'Приглашение уже использовано',
  rate_limited: 'Слишком много попыток — повторите через минуту',
  origin_not_allowed: 'Запрос отклонён',
};

export function redeemErrorText(error: unknown): string {
  if (isApiError(error)) {
    if (error.code && REDEEM_ERRORS[error.code]) return REDEEM_ERRORS[error.code];
    if (error.status === 401) return 'Не удалось войти — приглашение не принято';
    return `Не удалось принять приглашение (HTTP ${error.status})`;
  }
  return 'Не удалось принять приглашение: нет связи с сервером';
}
