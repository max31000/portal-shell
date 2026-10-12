import { useEffect, useRef, useState } from 'react';
import { Button, Modal, TextInput } from '@mantine/core';
import { TextLink } from '@mvv42/kit';
import { AuthRequestError, type TelegramAuthData } from '../auth/api';
import { normalizeInviteCode } from '../invite/code';
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
  /** Why sign-in is asked for (e.g. an invite); replaces the default subtitle. */
  message?: string;
  /** Pending code from an invite link (`?invite=`): prefills the code field. */
  inviteCode?: string | null;
}

type Phase = 'idle' | 'pending';

const LOGIN_TEXT = {
  generic: 'Не получилось войти. Попробуйте ещё раз.',
  again: 'Нажмите кнопку Telegram ещё раз',
  blocked: 'Аккаунт заблокирован — вход невозможен',
  rateLimited: 'Слишком много попыток — повторите через минуту',
  badFormat: 'Неверный формат кода',
  notFound: 'Код не найден',
  expired: 'Срок действия кода истёк',
  exhausted: 'Код уже использован',
} as const;

const CODE_ERRORS: Record<string, string> = {
  invite_not_found: LOGIN_TEXT.notFound,
  invite_expired: LOGIN_TEXT.expired,
  invite_exhausted: LOGIN_TEXT.exhausted,
  invalid_invite_format: LOGIN_TEXT.badFormat,
};

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
 * Sign-in with the Telegram widget; registration is closed (spec 2026-10-12): a new user also needs an invite code,
 * sent as `X-Invite-Code`. After `invite_required` / a bad code the widget payload is kept in memory (the server does
 * not burn it), so «Продолжить» resubmits it with the code without another Telegram click.
 */
export function LoginModal({ opened, onClose, onAuth, message, inviteCode }: LoginModalProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  /** Widget payload awaiting a code (after `invite_required` or a code error). */
  const [held, setHeld] = useState<TelegramAuthData | null>(null);
  /** `invite_required` was answered: highlight the field and explain. */
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Every opening starts clean (a previous error / pending state must not stick); the code field is prefilled
  // from what was typed before (sessionStorage) or the invite link.
  const [wasOpened, setWasOpened] = useState(false);
  if (opened !== wasOpened) {
    setWasOpened(opened);
    if (opened) {
      setPhase('idle');
      setHeld(null);
      setNeedCode(false);
      setCodeError(null);
      setFormError(null);
      setCode(readInviteDraft() ?? inviteCode ?? '');
    }
  }
  const codeRef = useRef<HTMLInputElement>(null);

  function fail(error: unknown, data: TelegramAuthData) {
    const reason = error instanceof AuthRequestError ? error.code : null;
    const status = error instanceof AuthRequestError ? error.status : null;
    setPhase('idle');
    if (reason === 'invite_required') {
      setHeld(data);
      setNeedCode(true);
      setCodeError(null);
      setFormError(null);
      codeRef.current?.focus();
    } else if (reason && CODE_ERRORS[reason]) {
      setHeld(data);
      setCodeError(CODE_ERRORS[reason]);
      setFormError(null);
      codeRef.current?.focus();
    } else if (reason === 'Expired' || reason === 'Replayed') {
      // The payload is stale (older than an hour, or burnt): a new Telegram click is needed; the code stays.
      setHeld(null);
      setFormError(LOGIN_TEXT.again);
    } else if (reason === 'user_blocked') {
      setHeld(null);
      setNeedCode(false);
      setFormError(LOGIN_TEXT.blocked);
    } else if (reason === 'rate_limited' || status === 429) {
      // Rejected before the payload was checked: «Продолжить» may retry it later.
      setFormError(LOGIN_TEXT.rateLimited);
    } else {
      setHeld(null);
      setFormError(LOGIN_TEXT.generic);
    }
  }

  function submit(data: TelegramAuthData) {
    if (phase === 'pending') return;
    let header: string | null = null;
    if (code.trim()) {
      const normalized = normalizeInviteCode(code);
      if (!normalized.ok) {
        setHeld(data);
        setCodeError(LOGIN_TEXT.badFormat);
        setFormError(null);
        codeRef.current?.focus();
        return;
      }
      header = normalized.value;
    }
    setPhase('pending');
    setCodeError(null);
    setFormError(null);
    onAuth(data, header).then(
      () => {
        setPhase('idle');
        setHeld(null);
        setNeedCode(false);
      },
      (error: unknown) => fail(error, data),
    );
  }

  // Stable callback identity for the widget (re-creating it reloads the iframe); it calls the latest `submit`.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  const [handleWidget] = useState(() => (data: TelegramAuthData) => submitRef.current(data));

  function onCodeChange(value: string) {
    setCode(value);
    setCodeError(null);
    saveInviteDraft(value);
  }

  const pending = phase === 'pending';
  const canContinue = held !== null && code.trim() !== '' && !pending;

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
      <div className={classes.body}>
        <span className={classes.mark} aria-hidden="true">
          m
        </span>
        <h2 id="mvv42-login-title" className={classes.title}>
          Вход в mvv42
        </h2>
        <p className={classes.text}>{message ?? 'Один аккаунт Telegram для всех сервисов.'}</p>

        {/* The widget stays mounted while a request runs and after `invite_required` (a new click must stay possible). */}
        <div className={classes.widgetArea} aria-busy={pending} data-pending={pending || undefined}>
          {opened && <TelegramWidget onAuth={handleWidget} />}
          {pending && (
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

        <form
          className={classes.invite}
          data-attention={needCode || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            if (canContinue && held) submit(held);
          }}
        >
          <p className={classes.inviteNote}>Вход только по приглашению</p>
          <TextInput
            ref={codeRef}
            label="Код приглашения (для новых пользователей)"
            placeholder="XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => onCodeChange(e.currentTarget.value)}
            error={codeError}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            classNames={{ input: classes.codeInput, label: classes.codeLabel }}
            disabled={pending}
          />
          {needCode && (
            <p className={classes.callout} role="alert">
              Новым пользователям нужен код приглашения. Нет кода — напишите в Telegram{' '}
              <TextLink href={OWNER_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" fz="inherit" className={classes.calloutLink}>
                @mvv42
              </TextLink>
            </p>
          )}
          {held && (
            <Button type="submit" fullWidth mt="sm" loading={pending} disabled={!canContinue}>
              Продолжить
            </Button>
          )}
        </form>

        <p className={classes.hint}>Telegram передаст имя, username и фото профиля.</p>
      </div>

      <button type="button" className={classes.close} onClick={onClose}>
        Отмена
      </button>
    </Modal>
  );
}
