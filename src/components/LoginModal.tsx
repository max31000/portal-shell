import { useEffect, useRef, useState } from 'react';
import { Button, Modal, TextInput, VisuallyHidden } from '@mantine/core';
import { TextLink } from '@mvv42/kit';
import { IconCircleCheckFilled } from '@tabler/icons-react';
import { AuthRequestError, checkInvite as apiCheckInvite, type InviteCheck, type TelegramAuthData } from '../auth/api';
import { clearAccountMarker, hasAccountMarker } from '../auth/accountMarker';
import { formatInviteCode, normalizeInviteCode } from '../invite/code';
import { readInviteDraft, saveInviteDraft } from '../invite/invite';
import classes from './LoginModal.module.css';

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'mv_cashpulse_bot';
const CALLBACK = '__mvv42OnTelegramAuth';
const OWNER_TELEGRAM_URL = 'https://t.me/mvv42';

declare global {
  interface Window {
    [CALLBACK]?: (user: TelegramAuthData) => void;
  }
}

interface LoginModalProps {
  opened: boolean;
  onClose: () => void;
  /**
   * Signs in with the widget payload and the normalised (ASCII) invite code, or null without one.
   * Rejects with `AuthRequestError` (its `code` drives the messages below).
   */
  onAuth: (data: TelegramAuthData, inviteCode: string | null) => Promise<void>;
  /** Why sign-in is asked for (e.g. «Чтобы открыть «X», войдите»): a subtitle under the title in every step. */
  message?: string;
  /** Pending code from an invite link (`?invite=`): the modal starts on the code step and checks it at once. */
  inviteCode?: string | null;
  /** Service name for an app id (the «Код даёт доступ к …» line); defaults to the id. */
  appName?: (appId: string) => string;
  /** `POST /auth/api/invites/check` (injectable for tests). */
  checkInvite?: (code: string) => Promise<InviteCheck>;
}

/**
 * Steps (spec 2026-10-12-code-first-login):
 * - `code` (A) — invite code field + «Продолжить» → `/invites/check`. The Telegram script is never loaded here.
 * - `accepted` (B) — the code is valid: the service it opens + the Telegram button; the code goes as `X-Invite-Code`.
 * - `account` (C) — «У меня уже есть аккаунт»: the Telegram button without a code.
 */
export type LoginStep = 'code' | 'accepted' | 'account';

const STEP_LABEL: Record<LoginStep, string> = {
  code: 'Шаг: код приглашения',
  accepted: 'Шаг: код принят, войдите через Telegram',
  account: 'Шаг: вход в существующий аккаунт',
};

const LOGIN_TEXT = {
  generic: 'Не получилось войти. Попробуйте ещё раз.',
  checkFailed: 'Не удалось проверить код. Попробуйте ещё раз.',
  again: 'Нажмите кнопку Telegram ещё раз',
  blocked: 'Аккаунт заблокирован — вход невозможен',
  rateLimited: 'Слишком много попыток — повторите через минуту',
  badFormat: 'Неверный формат кода',
  notFound: 'Код не найден',
  expired: 'Срок действия кода истёк',
  exhausted: 'Код уже использован',
  noAccount: 'Аккаунт не найден. Нужен код приглашения',
} as const;

const CODE_ERRORS: Record<string, string> = {
  invite_not_found: LOGIN_TEXT.notFound,
  invite_expired: LOGIN_TEXT.expired,
  invite_exhausted: LOGIN_TEXT.exhausted,
  invalid_invite_format: LOGIN_TEXT.badFormat,
};

function isRateLimited(error: unknown): boolean {
  return error instanceof AuthRequestError && (error.status === 429 || error.code === 'rate_limited');
}

function TelegramWidget({ onAuth }: { onAuth: (data: TelegramAuthData) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    window[CALLBACK] = onAuth;

    // One fresh slot per mount. Under StrictMode the effect runs twice; a script from the first run that
    // still executes renders into its own detached slot instead of next to the live widget.
    const slot = document.createElement('div');
    host.replaceChildren(slot);

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', `${CALLBACK}(user)`);
    script.onerror = () => setFailed(true);
    slot.appendChild(script);

    // Leaving B/C removes the script tag and the widget iframe (the global `window.Telegram` and the cached
    // script stay — accepted, decision 10).
    return () => {
      slot.remove();
      host.replaceChildren();
      if (window[CALLBACK] === onAuth) delete window[CALLBACK];
    };
  }, [onAuth]);

  return (
    <>
      <div ref={hostRef} className={classes.widget} />
      {failed && <p className={classes.error}>Не удалось загрузить виджет Telegram. Проверьте соединение.</p>}
    </>
  );
}

/**
 * Code-first sign-in: Telegram (script, iframe, the visitor's data) is involved only after the visitor has a checked
 * invite code (B) or says they already have an account (C). A device marker (`mvv42-has-account`) opens C directly;
 * a pending invite or a typed draft always starts on A with an automatic check. A widget payload refused for the code
 * (`invite_*` in B, `invite_required` in C) is kept in memory and resent automatically once a code passes the check.
 */
export function LoginModal({
  opened,
  onClose,
  onAuth,
  message,
  inviteCode,
  appName = (id) => id,
  checkInvite = apiCheckInvite,
}: LoginModalProps) {
  const [step, setStep] = useState<LoginStep>('code');
  /** `/invites/check` running (A). */
  const [checking, setChecking] = useState(false);
  /** `/telegram` running (B/C). */
  const [signingIn, setSigningIn] = useState(false);
  const [code, setCode] = useState('');
  /** The checked code (B): normalised value and the app it grants. */
  const [accepted, setAccepted] = useState<{ value: string; appId: string | null } | null>(null);
  /** Widget payload awaiting a valid code (after `invite_required` / a code error) or a retry (after 429). */
  const [held, setHeld] = useState<TelegramAuthData | null>(null);
  /** C answered `invite_required`: explain on A. */
  const [noAccount, setNoAccount] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  /** Code to check automatically right after opening (pending invite / draft); at most once per opening. */
  const [autoCheck, setAutoCheck] = useState<{ opening: number; code: string } | null>(null);
  const [opening, setOpening] = useState(0);

  // Every opening starts afresh (decision 11): a pending invite or a typed draft → A with an automatic check
  // (decision 1); otherwise the device marker → C; otherwise A.
  const [wasOpened, setWasOpened] = useState(false);
  if (opened !== wasOpened) {
    setWasOpened(opened);
    if (opened) {
      const next = opening + 1;
      const pending = readInviteDraft() ?? inviteCode ?? '';
      setOpening(next);
      setHeld(null);
      setAccepted(null);
      setNoAccount(false);
      setCodeError(null);
      setFormError(null);
      setSigningIn(false);
      setCode(pending);
      if (pending.trim()) {
        setStep('code');
        setChecking(true);
        setAutoCheck({ opening: next, code: pending });
      } else {
        setStep(hasAccountMarker() ? 'account' : 'code');
        setChecking(false);
        setAutoCheck(null);
      }
    }
  }

  /** Latest opening, for dropping answers that arrive after a close / reopen. */
  const openingRef = useRef(opening);
  const openedRef = useRef(opened);
  useEffect(() => {
    openingRef.current = opening;
    openedRef.current = opened;
  });
  const stale = (at: number) => !openedRef.current || openingRef.current !== at;

  // ----- Focus + live region on step changes (decision 11) -----

  const codeRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  /** Bumped to move focus: A → the code field, B/C → the title. Runs after the render that re-enables the input. */
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest === 0) return;
    if (step === 'code') codeRef.current?.focus();
    else titleRef.current?.focus();
  }, [focusRequest, step]);
  /** Announced politely after a step change (not on the first render of an opening). */
  const [announce, setAnnounce] = useState('');

  function goTo(next: LoginStep) {
    setStep(next);
    setAnnounce(STEP_LABEL[next]);
    setFocusRequest((n) => n + 1);
  }

  // ----- Sign-in (B/C) -----

  function signIn(data: TelegramAuthData, header: string | null) {
    const at = openingRef.current;
    setSigningIn(true);
    setFormError(null);
    onAuth(data, header).then(
      () => {
        if (stale(at)) return;
        setSigningIn(false);
        setHeld(null);
      },
      (error: unknown) => {
        if (stale(at)) return;
        setSigningIn(false);
        signInFailed(error, data);
      },
    );
  }

  function signInFailed(error: unknown, data: TelegramAuthData) {
    const reason = error instanceof AuthRequestError ? error.code : null;
    if (reason === 'invite_required') {
      // C (or B without a usable code): no account → A, the payload waits for a code (decision 4).
      clearAccountMarker();
      setHeld(data);
      setNoAccount(true);
      setAccepted(null);
      setCodeError(null);
      setFormError(null);
      goTo('code');
    } else if (reason && CODE_ERRORS[reason]) {
      // B: the code went bad between the check and the click → A with the code and the error (decision 3).
      setHeld(data);
      setAccepted(null);
      setCodeError(CODE_ERRORS[reason]);
      setFormError(null);
      goTo('code');
    } else if (reason === 'Expired' || reason === 'Replayed') {
      // The payload is stale (older than an hour, or burnt): a new Telegram click is needed.
      setHeld(null);
      setFormError(LOGIN_TEXT.again);
    } else if (reason === 'user_blocked') {
      setHeld(null);
      setFormError(LOGIN_TEXT.blocked);
    } else if (isRateLimited(error)) {
      // Rejected before the payload was checked: «Повторить» may resend it later.
      setHeld(data);
      setFormError(LOGIN_TEXT.rateLimited);
    } else {
      setHeld(null);
      setFormError(LOGIN_TEXT.generic);
    }
  }

  // Stable callback identity for the widget (re-creating it reloads the iframe); it calls the latest handler.
  const widgetRef = useRef<(data: TelegramAuthData) => void>(() => {});
  useEffect(() => {
    widgetRef.current = (data) => {
      if (signingIn) return;
      if (step === 'accepted' && accepted) signIn(data, accepted.value);
      else if (step === 'account') signIn(data, null);
    };
  });
  const [handleWidget] = useState(() => (data: TelegramAuthData) => widgetRef.current(data));

  // ----- Code check (A) -----

  /** Runs `/invites/check` for an already normalised code; `checking` is set by the caller. */
  function runCheck(value: string, at: number, payload: TelegramAuthData | null) {
    checkInvite(value).then(
      (result) => {
        if (stale(at)) return;
        setChecking(false);
        setCodeError(null);
        setFormError(null);
        setNoAccount(false);
        setAccepted({ value, appId: result.appId });
        goTo('accepted');
        // A payload refused earlier for the code goes again at once — no new Telegram click (decision 3).
        if (payload) signIn(payload, value);
      },
      (error: unknown) => {
        if (stale(at)) return;
        setChecking(false);
        const reason = error instanceof AuthRequestError ? error.code : null;
        if (reason && CODE_ERRORS[reason]) {
          setCodeError(CODE_ERRORS[reason]);
          setFormError(null);
        } else if (isRateLimited(error)) {
          setFormError(LOGIN_TEXT.rateLimited);
        } else {
          setFormError(LOGIN_TEXT.checkFailed);
        }
        setFocusRequest((n) => n + 1);
      },
    );
  }

  /** Validates the field on the client (bad format → no request) and starts the check. */
  function submitCode(raw: string): boolean {
    const normalized = normalizeInviteCode(raw);
    if (!normalized.ok) {
      setChecking(false);
      setCodeError(LOGIN_TEXT.badFormat);
      setFormError(null);
      setFocusRequest((n) => n + 1);
      return false;
    }
    setChecking(true);
    setCodeError(null);
    setFormError(null);
    runCheck(normalized.value, openingRef.current, held);
    return true;
  }

  // Automatic check of a pending invite / draft — once per opening (the ref survives StrictMode's double effect).
  const autoChecked = useRef(0);
  useEffect(() => {
    if (!autoCheck || autoChecked.current === autoCheck.opening) return;
    autoChecked.current = autoCheck.opening;
    const normalized = normalizeInviteCode(autoCheck.code);
    if (normalized.ok) {
      runCheck(normalized.value, autoCheck.opening, null);
    } else {
      // Show the format error asynchronously (setState in an effect body would cascade renders).
      void Promise.resolve().then(() => {
        if (stale(autoCheck.opening)) return;
        setChecking(false);
        setCodeError(LOGIN_TEXT.badFormat);
      });
    }
    // runCheck / stale read refs and stable setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck]);

  function onCodeChange(value: string) {
    setCode(value);
    setCodeError(null);
    saveInviteDraft(value);
  }

  function toAccount() {
    setHeld(null);
    setNoAccount(false);
    setCodeError(null);
    setFormError(null);
    goTo('account');
  }

  function toCode() {
    setAccepted(null);
    setFormError(null);
    goTo('code');
  }

  const subtitle = message ? <p className={classes.text}>{message}</p> : null;
  const retry =
    held && formError === LOGIN_TEXT.rateLimited && step !== 'code' ? (
      <Button
        variant="default"
        mt="sm"
        onClick={() => signIn(held, step === 'accepted' ? (accepted?.value ?? null) : null)}
      >
        Повторить
      </Button>
    ) : null;
  const telegramArea = (
    <>
      {/* The widget stays mounted while a request runs (a new click must stay possible afterwards). */}
      <div className={classes.widgetArea} aria-busy={signingIn} data-pending={signingIn || undefined}>
        <TelegramWidget onAuth={handleWidget} />
        {signingIn && (
          <p className={classes.pending} role="status">
            Входим…
          </p>
        )}
      </div>
      {formError && (
        <p className={classes.error} role="alert">
          {formError}
        </p>
      )}
      {retry}
    </>
  );

  let content;
  if (step === 'code') {
    content = (
      <>
        <p className={classes.lead}>Вход только по приглашению</p>
        <form
          className={classes.codeForm}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!checking && !signingIn) submitCode(code);
          }}
        >
          {noAccount && (
            <p className={classes.callout} role="alert">
              {LOGIN_TEXT.noAccount}
            </p>
          )}
          <TextInput
            ref={codeRef}
            data-autofocus
            label="Код приглашения"
            placeholder="XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => onCodeChange(e.currentTarget.value)}
            error={codeError ? <span role="alert">{codeError}</span> : null}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            classNames={{ input: classes.codeInput, label: classes.codeLabel }}
            disabled={checking}
          />
          {formError && (
            <p className={classes.error} role="alert">
              {formError}
            </p>
          )}
          <Button type="submit" fullWidth mt="md" loading={checking} disabled={!code.trim()}>
            Продолжить
          </Button>
        </form>
        <p className={classes.note}>
          Нет кода — напишите в Telegram{' '}
          <TextLink href={OWNER_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" fz="inherit" className={classes.noteLink}>
            @mvv42
          </TextLink>
        </p>
        <button type="button" className={classes.switch} onClick={toAccount} disabled={checking}>
          У меня уже есть аккаунт
        </button>
      </>
    );
  } else if (step === 'accepted' && accepted) {
    content = (
      <>
        <div className={classes.accepted}>
          <div className={classes.acceptedHead}>
            <IconCircleCheckFilled size={18} className={classes.acceptedIcon} aria-hidden="true" />
            <p className={classes.acceptedTitle}>Код принят</p>
          </div>
          <p className={classes.acceptedService}>
            {accepted.appId ? `Код даёт доступ к «${appName(accepted.appId)}»` : 'Код для входа'}
          </p>
          <div className={classes.acceptedFoot}>
            <span className={classes.acceptedCode}>{formatInviteCode(accepted.value)}</span>
            <button type="button" className={classes.change} onClick={toCode} disabled={signingIn}>
              Изменить код
            </button>
          </div>
        </div>
        <p className={classes.lead}>Теперь войдите через Telegram</p>
        {telegramArea}
        <p className={classes.hint}>Telegram передаст имя, username и фото профиля.</p>
      </>
    );
  } else {
    content = (
      <>
        <p className={classes.lead}>Войдите через Telegram</p>
        {telegramArea}
        <p className={classes.note}>Если аккаунта нет, вход не выполнится и данные не сохранятся.</p>
        <p className={classes.hint}>Telegram передаст имя, username и фото профиля.</p>
        <button type="button" className={classes.switch} onClick={toCode} disabled={signingIn}>
          Новый пользователь? Ввести код
        </button>
      </>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      zIndex="var(--shell-z-modal)"
      size={400}
      radius="lg"
      padding={0}
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 1, blur: 4, className: classes.overlay }}
      transitionProps={{ transition: 'pop', duration: 200, timingFunction: 'cubic-bezier(.2,.8,.2,1)' }}
      classNames={{ content: classes.content }}
      aria-labelledby="mvv42-login-title"
    >
      <div className={classes.body} data-step={step}>
        <span className={classes.mark} aria-hidden="true">
          m
        </span>
        <h2 id="mvv42-login-title" ref={titleRef} tabIndex={-1} className={classes.title}>
          Вход в mvv42
        </h2>
        {subtitle}
        {content}
        <VisuallyHidden aria-live="polite" data-testid="login-step-live">
          {announce}
        </VisuallyHidden>
      </div>

      <button type="button" className={classes.close} onClick={onClose}>
        Отмена
      </button>
    </Modal>
  );
}
