/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Telegram bot used by the login widget (BotFather domain must be mvv42.ru). Default: mv_cashpulse_bot. */
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
