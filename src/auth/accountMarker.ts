/**
 * Device marker «this browser has signed in before» (code-first login, spec 2026-10-12, review decisions 2 and 5):
 * `localStorage['mvv42-has-account'] = '1'`, no PII. Set after every successful sign-in and whenever `/me` answers
 * with a signed-in user. With the marker the login modal opens in «Есть аккаунт» (Telegram button) instead of the
 * invite-code step. It is only a UI hint: any service on the same origin can read or write it, it is never trusted
 * for access, and sign-out deliberately keeps it (accepted risk on shared devices). Storage errors → «no marker».
 */
export const ACCOUNT_MARKER_KEY = 'mvv42-has-account';

export function hasAccountMarker(): boolean {
  try {
    return window.localStorage.getItem(ACCOUNT_MARKER_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAccountMarker(): void {
  try {
    window.localStorage.setItem(ACCOUNT_MARKER_KEY, '1');
  } catch {
    /* storage blocked: the modal simply starts with the code step */
  }
}

export function clearAccountMarker(): void {
  try {
    window.localStorage.removeItem(ACCOUNT_MARKER_KEY);
  } catch {
    /* storage blocked */
  }
}
