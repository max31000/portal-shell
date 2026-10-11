import { useEffect, useRef, useState } from 'react';
import { Modal } from '@mantine/core';
import type { TelegramAuthData } from '../auth/api';
import classes from './LoginModal.module.css';

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'mv_cashpulse_bot';
const CALLBACK = '__mvv42OnTelegramAuth';

declare global {
  interface Window {
    [CALLBACK]?: (user: TelegramAuthData) => void;
  }
}

interface LoginModalProps {
  opened: boolean;
  onClose: () => void;
  onAuth: (data: TelegramAuthData) => Promise<void>;
}

type Phase = 'idle' | 'pending' | 'error';

function TelegramWidget({ onAuth }: { onAuth: (data: TelegramAuthData) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    window[CALLBACK] = onAuth;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', `${CALLBACK}(user)`);
    script.onerror = () => setFailed(true);
    host.appendChild(script);

    return () => {
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

export function LoginModal({ opened, onClose, onAuth }: LoginModalProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  // Stable callback identity for the widget; it reads the latest props through a ref.
  const onAuthRef = useRef(onAuth);
  useEffect(() => {
    onAuthRef.current = onAuth;
  }, [onAuth]);

  const [handleAuth] = useState(() => (data: TelegramAuthData) => {
    setPhase('pending');
    onAuthRef.current(data).then(
      () => setPhase('idle'),
      () => setPhase('error'),
    );
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
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
        <p className={classes.text}>Один аккаунт Telegram для всех сервисов.</p>

        <div className={classes.widgetArea} aria-busy={phase === 'pending'}>
          {phase === 'pending' ? (
            <p className={classes.pending} role="status">
              Входим…
            </p>
          ) : (
            opened && <TelegramWidget onAuth={handleAuth} />
          )}
        </div>

        {phase === 'error' && (
          <p className={classes.error} role="alert">
            Не получилось войти. Попробуйте ещё раз.
          </p>
        )}

        <p className={classes.hint}>Telegram передаст имя, username и фото профиля.</p>
      </div>

      <button type="button" className={classes.close} onClick={onClose}>
        Отмена
      </button>
    </Modal>
  );
}
