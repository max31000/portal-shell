import { isApiError } from '@mvv42/kit/platform';
import type { AccessMode, InviteStatus, LoginResult } from './api';

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «12 окт. 2026 г., 10:40» (local time); `fallback` for null. */
export function formatDateTime(iso: string | null | undefined, fallback = '—'): string {
  const d = parse(iso);
  return d ? dateTime.format(d) : fallback;
}

export function formatDate(iso: string | null | undefined, fallback = '—'): string {
  const d = parse(iso);
  return d ? dateOnly.format(d) : fallback;
}

/** «только что», «5 мин назад», «3 ч назад», «2 дн назад», then the date. */
export function formatRelative(iso: string | null | undefined, fallback = 'никогда', now: number = Date.now()): string {
  const d = parse(iso);
  if (!d) return fallback;
  const diff = Math.round((now - d.getTime()) / 1000);
  if (diff < 0) return formatDateTime(iso);
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)} дн назад`;
  return formatDate(iso);
}

/** Label of an invite without a service (`appId: null`). */
export const LOGIN_ONLY_LABEL = 'Только вход';

export const ACCESS_LABEL: Record<AccessMode, string> = {
  public: 'Всем после входа',
  invite: 'По приглашению',
  admin: 'Только админам',
};

export const ACCESS_SHORT: Record<AccessMode, string> = {
  public: 'Публичный',
  invite: 'По инвайту',
  admin: 'Админ',
};

export const LOGIN_RESULT: Record<LoginResult, { label: string; color: string }> = {
  ok: { label: 'Успех', color: 'green' },
  denied_blocked: { label: 'Заблокирован', color: 'red' },
  invalid: { label: 'Неверная подпись', color: 'orange' },
  replayed: { label: 'Повтор', color: 'orange' },
  denied_unregistered: { label: 'Без приглашения', color: 'gray' },
  invite_check_failed: { label: 'Неверный код', color: 'gray' },
};

export const INVITE_STATUS: Record<InviteStatus, { label: string; color: string }> = {
  active: { label: 'Активен', color: 'green' },
  expired: { label: 'Истёк', color: 'gray' },
  exhausted: { label: 'Использован', color: 'gray' },
};

const ERROR_TEXT: Record<string, string> = {
  user_not_found: 'Пользователь не найден',
  session_not_found: 'Сессия не найдена',
  invite_not_found: 'Инвайт не найден',
  cannot_block_owner: 'Владельца нельзя заблокировать',
  cannot_change_owner: 'Права владельца не меняются',
  invalid_limit: 'Неверный размер страницы',
  invalid_before: 'Неверная позиция журнала',
  invalid_app_id: 'Неверный id сервиса',
  invalid_name: 'Неверное название',
  invalid_access: 'Неверный режим доступа',
  unknown_user: 'Пользователь не найден',
  unknown_app: 'Сервис не найден',
  invalid_max_uses: 'Число использований — от 1 до 1000',
  invalid_expiry: 'Срок — от 1 часа до 1 года',
  origin_not_allowed: 'Запрос отклонён: чужой Origin',
};

/** Human message for a failed admin request. */
export function errorText(error: unknown): string {
  if (isApiError(error)) {
    if (error.code && ERROR_TEXT[error.code]) return ERROR_TEXT[error.code];
    if (error.status === 401) return 'Сессия истекла — войдите снова';
    if (error.status === 403) return 'Нет доступа';
    if (error.status === 404) return 'Не найдено';
    if (error.status >= 500) return `Ошибка сервера (HTTP ${error.status})`;
    return error.code ? `Ошибка: ${error.code}` : `Ошибка HTTP ${error.status}`;
  }
  return 'Нет связи с сервером';
}

/** «Chrome · Windows», «Safari · iOS» — a short label for a User-Agent; null → «—». */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return '—';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /YaBrowser/.test(ua)
        ? 'Яндекс Браузер'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : /TelegramBot|Telegram/.test(ua)
                ? 'Telegram'
                : null;
  if (!browser && !os) return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
  return [browser, os].filter(Boolean).join(' · ');
}

/** «1 сессия», «2 сессии», «5 сессий». */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
