import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '@mvv42/kit/platform';
import { redeemInvite, type MeResponse } from '../auth/api';
import type { AuthSnapshot, AuthStatus } from '../auth/useAuth';
import { showNotice } from '../shell/notice';
import type { Service } from '../types';
import { normalizeInviteCode } from './code';
import { captureInvite, clearPendingInvite, redeemErrorText, storePendingInvite } from './invite';

interface InviteFlowOptions {
  authStatus: AuthStatus;
  /** Registry loaded (needed to name and open the service after redeem). */
  ready: boolean;
  services: Service[];
  /** Ask the visitor to sign in (the login modal opens on the code step with the pending code). */
  requestLogin: () => void;
  /** Adopt the `/me` from the redeem response. */
  applyMe: (me: MeResponse) => AuthSnapshot;
  /** Re-read `/me` (after a 401). */
  refreshAuth: () => Promise<AuthSnapshot>;
  /** Post AUTH_CHANGED to the active service. */
  onAuthChanged: () => void;
  /** Open the service the invite was for. */
  openService: (service: Service) => void;
}

export interface InviteFlow {
  /** A code is waiting for login / redeem. */
  pending: boolean;
  /** The pending code (prefills the login modal's code field). */
  code: string | null;
  /** The visitor closed the login modal: drop the invite. */
  cancel: () => void;
  /**
   * `/telegram` already consumed the code (its response has `invite`, spec review decision 4): drop it, no redeem.
   * Call in the same tick as applying the new `/me` so the flow never redeems it a second time.
   */
  finish: () => void;
  /**
   * A known user signed in with a code typed into the login modal (no `invite` in the response, decision 5):
   * redeem it quietly — «already granted» / login-only codes give no notice. Same tick as applying `/me`.
   */
  adopt: (code: string) => void;
}

const MAX_ATTEMPTS = 2;

function sameCode(a: string, b: string): boolean {
  const na = normalizeInviteCode(a);
  const nb = normalizeInviteCode(b);
  return na.ok && nb.ok ? na.value === nb.value : a === b;
}

/**
 * `?invite=CODE` (spec §10.10): captured on boot (URL cleaned, code in sessionStorage) → signed out: login modal →
 * signed in: `POST /auth/api/invites/redeem` → «Доступ к <сервис> открыт» (or «уже есть») → AUTH_CHANGED → open the
 * service. Errors (`invite_not_found` / `invite_expired` / `invite_exhausted`, …) drop the code with a notice.
 */
export function useInviteFlow(options: InviteFlowOptions): InviteFlow {
  const [code, setCode] = useState<string | null>(captureInvite);
  /** `typed` — adopted from the login modal: redeem quietly. */
  const source = useRef<'link' | 'typed'>('link');
  /** Bumped to re-run the flow after a 401 retry. */
  const [tick, setTick] = useState(0);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  const inFlight = useRef(false);
  const attempts = useRef(0);
  const prompted = useRef(false);

  const finish = useCallback(() => {
    clearPendingInvite();
    setCode(null);
  }, []);

  const { authStatus, ready } = options;

  useEffect(() => {
    if (!code || authStatus === 'loading' || !ready || inFlight.current) return;

    if (authStatus === 'unavailable') {
      showNotice('invite', 'Сервис входа недоступен — приглашение не принято', 'error');
      finish();
      return;
    }

    if (authStatus === 'anonymous') {
      if (!prompted.current) {
        prompted.current = true;
        opts.current.requestLogin();
      }
      return;
    }

    // authenticated
    inFlight.current = true;
    attempts.current += 1;
    void (async () => {
      try {
        const result = await redeemInvite(code);
        finish();
        opts.current.applyMe(result.me);
        opts.current.onAuthChanged();
        // Login-only invite (appId null): nothing was granted, the visitor is simply signed in.
        if (result.appId === null) return;
        const service = opts.current.services.find((s) => s.id === result.appId);
        const name = service?.name ?? result.appId;
        if (result.alreadyGranted) {
          if (source.current === 'typed') return;
          showNotice('invite', `У вас уже есть доступ к «${name}»`);
        } else {
          showNotice('invite', `Доступ к «${name}» открыт`);
        }
        if (service) opts.current.openService(service);
      } catch (error) {
        if (isApiError(error) && error.status === 401 && attempts.current < MAX_ATTEMPTS) {
          // Session gone between /me and redeem: re-read /me; signed out → the login prompt shows again.
          prompted.current = false;
          inFlight.current = false;
          const after = await opts.current.refreshAuth().catch(() => null);
          // Still signed in → retry once now; otherwise the status change re-runs the flow (login prompt).
          if (after?.status === 'authenticated') setTick((t) => t + 1);
          return;
        }
        showNotice('invite', redeemErrorText(error), 'error');
        finish();
      } finally {
        inFlight.current = false;
      }
    })();
  }, [code, authStatus, ready, finish, tick]);

  const cancel = useCallback(() => {
    if (!code) return;
    showNotice('invite', 'Приглашение не принято: для него нужно войти');
    finish();
  }, [code, finish]);

  const adopt = useCallback(
    (next: string) => {
      // The link's own code (maybe formatted differently): the link flow already redeems it.
      if (code !== null && sameCode(code, next)) return;
      source.current = 'typed';
      attempts.current = 0;
      prompted.current = true; // already signed in by the modal: never prompt for this code
      storePendingInvite(next);
      setCode(next);
    },
    [code],
  );

  return { pending: code !== null, code, cancel, finish, adopt };
}
