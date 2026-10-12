import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AuthRequestError, type InviteCheck, type TelegramAuthData } from '../auth/api';
import { ACCOUNT_MARKER_KEY } from '../auth/accountMarker';
import { INVITE_DRAFT_KEY } from '../invite/invite';
import { renderWithKit } from '../test/utils';
import { LoginModal } from './LoginModal';

type LoginModalProps = Parameters<typeof LoginModal>[0];

beforeEach(() => {
  // jsdom lacks these; Mantine's provider and transitions use them.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  sessionStorage.clear();
  localStorage.clear();
  return () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  };
});

const PAYLOAD: TelegramAuthData = { id: 4242, first_name: 'Аня', auth_date: 1_760_000_000, hash: 'abc' };
const NAMES: Record<string, string> = { bonds: 'Bond Analytics' };
const appName = (id: string) => NAMES[id] ?? id;

function deny(code: string | null, status = 400) {
  return new AuthRequestError(status, `Failed (${status})`, code);
}

const ok = (appId: string | null = 'bonds') => vi.fn(async (): Promise<InviteCheck> => ({ appId }));

/** DOM of the Telegram widget (decision 10): its script tag and the iframe the script would create. */
const telegramScripts = () => document.querySelectorAll('script[src*="telegram-widget"]');
const telegramIframes = () => document.querySelectorAll('iframe[src*="telegram"], iframe[id^="telegram-login"]');
function expectNoTelegram() {
  expect(telegramScripts()).toHaveLength(0);
  expect(telegramIframes()).toHaveLength(0);
  expect(window.__mvv42OnTelegramAuth).toBeUndefined();
  expect(screen.queryByText('Telegram передаст имя, username и фото профиля.')).toBeNull();
}
/** What telegram-widget.js does once loaded: puts an iframe next to its script tag. */
function simulateWidgetIframe() {
  const script = telegramScripts()[0];
  const iframe = document.createElement('iframe');
  iframe.id = 'telegram-login-mv_cashpulse_bot';
  iframe.src = 'https://oauth.telegram.org/embed/mv_cashpulse_bot';
  script.after(iframe);
}

/** What the Telegram widget does after a click: calls the global callback with the signed payload. */
function clickTelegram(payload: TelegramAuthData = PAYLOAD) {
  const cb = window.__mvv42OnTelegramAuth;
  if (!cb) throw new Error('widget callback not registered');
  act(() => cb(payload));
}

interface Setup {
  onAuth?: LoginModalProps['onAuth'];
  checkInvite?: LoginModalProps['checkInvite'];
  inviteCode?: string | null;
  message?: string;
}

function renderModal({ onAuth = vi.fn().mockResolvedValue(undefined), checkInvite = ok(), inviteCode = null, message }: Setup = {}) {
  const ui = (opened: boolean) => (
    <LoginModal
      opened={opened}
      onClose={vi.fn()}
      onAuth={onAuth}
      checkInvite={checkInvite}
      inviteCode={inviteCode}
      message={message}
      appName={appName}
    />
  );
  const r = renderWithKit(ui(true));
  return { ...r, onAuth, checkInvite, setOpened: (o: boolean) => r.rerender(ui(o)) };
}

const codeField = () => screen.getByLabelText('Код приглашения') as HTMLInputElement;
const liveRegion = () => screen.getByTestId('login-step-live');

async function enterCode(value = 'k7pm 2xq9 hd4t') {
  fireEvent.change(codeField(), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
}

describe('LoginModal — A «Код»', () => {
  it('is the default without a marker: fixed text, code field, contact, «У меня уже есть аккаунт» button; no Telegram', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'Вход в mvv42' })).toBeTruthy();
    expect(screen.getByText('Вход только по приглашению')).toBeTruthy();
    expect(codeField().value).toBe('');
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeTruthy();
    const contact = screen.getByText(/Нет кода — напишите в Telegram/);
    const link = within(contact).getByRole('link', { name: '@mvv42' }) as HTMLAnchorElement;
    expect(link.href).toBe('https://t.me/mvv42');
    expect(link.rel).toContain('noopener');
    const toAccount = screen.getByRole('button', { name: 'У меня уже есть аккаунт' });
    expect(toAccount.tagName).toBe('BUTTON');
    expectNoTelegram();
  });

  it('shows the caller subtitle above the fixed text (decision 9)', () => {
    renderModal({ message: 'Чтобы открыть «Bond Analytics», войдите' });
    expect(screen.getByText('Чтобы открыть «Bond Analytics», войдите')).toBeTruthy();
    expect(screen.getByText('Вход только по приглашению')).toBeTruthy();
  });

  it('valid code → B with the service; Telegram appears only now; focus + live region', async () => {
    const { checkInvite } = renderModal();
    await enterCode();
    expect(checkInvite).toHaveBeenCalledWith('K7PM2XQ9HD4T');
    expect(await screen.findByText('Код принят')).toBeTruthy();
    expect(screen.getByText('Код даёт доступ к «Bond Analytics»')).toBeTruthy();
    expect(screen.getByText('K7PM-2XQ9-HD4T')).toBeTruthy();
    expect(telegramScripts()).toHaveLength(1);
    expect(screen.getByText('Telegram передаст имя, username и фото профиля.')).toBeTruthy();
    expect(liveRegion().getAttribute('aria-live')).toBe('polite');
    expect(liveRegion().textContent).toMatch(/код принят/i);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Вход в mvv42' })));
    expect(screen.getByRole('button', { name: 'Изменить код' }).tagName).toBe('BUTTON');
  });

  it('login-only code → «Код для входа»', async () => {
    renderModal({ checkInvite: ok(null) });
    await enterCode();
    expect(await screen.findByText('Код для входа')).toBeTruthy();
  });

  it('malformed code: «Неверный формат кода», no request, still no Telegram', async () => {
    const { checkInvite } = renderModal();
    await enterCode('привет');
    expect(await screen.findByText('Неверный формат кода')).toBeTruthy();
    expect(checkInvite).not.toHaveBeenCalled();
    expectNoTelegram();
  });

  it.each([
    ['invite_not_found', 'Код не найден'],
    ['invite_expired', 'Срок действия кода истёк'],
    ['invite_exhausted', 'Код уже использован'],
    ['invalid_invite_format', 'Неверный формат кода'],
  ])('check %s → «%s» on the field, stays on A', async (code, text) => {
    renderModal({ checkInvite: vi.fn().mockRejectedValue(deny(code)) });
    await enterCode();
    expect(await screen.findByText(text)).toBeTruthy();
    expect(codeField().getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(codeField()));
    expectNoTelegram();
    // Typing clears the error.
    fireEvent.change(codeField(), { target: { value: 'ABCD-EFGH-JKMN' } });
    expect(screen.queryByText(text)).toBeNull();
  });

  it('429 is recognised by status alone (nginx HTML body → no code)', async () => {
    renderModal({ checkInvite: vi.fn().mockRejectedValue(deny(null, 429)) });
    await enterCode();
    expect(await screen.findByText('Слишком много попыток — повторите через минуту')).toBeTruthy();
    expectNoTelegram();
  });

  it('network failure → a generic check error', async () => {
    renderModal({ checkInvite: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) });
    await enterCode();
    expect(await screen.findByText('Не удалось проверить код. Попробуйте ещё раз.')).toBeTruthy();
  });

  it('the typed code is kept as a draft (sessionStorage)', () => {
    renderModal();
    fireEvent.change(codeField(), { target: { value: 'ABCD-EFGH-JKMN' } });
    expect(sessionStorage.getItem(INVITE_DRAFT_KEY)).toBe('ABCD-EFGH-JKMN');
  });

  it('«У меня уже есть аккаунт» → C', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'У меня уже есть аккаунт' }));
    expect(await screen.findByText('Если аккаунта нет, вход не выполнится и данные не сохранятся.')).toBeTruthy();
    expect(telegramScripts()).toHaveLength(1);
    expect(liveRegion().textContent).toMatch(/существующий аккаунт/);
  });
});

describe('LoginModal — B «Код принят»', () => {
  it('Telegram click sends the payload with the checked code', async () => {
    const { onAuth } = renderModal();
    await enterCode();
    await screen.findByText('Код принят');
    clickTelegram();
    await waitFor(() => expect(onAuth).toHaveBeenCalledWith(PAYLOAD, 'K7PM2XQ9HD4T'));
  });

  it('«Изменить код» → A: script and iframe gone, code kept, focus in the field', async () => {
    renderModal();
    await enterCode();
    await screen.findByText('Код принят');
    simulateWidgetIframe();
    expect(telegramIframes()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить код' }));
    expect(await screen.findByText('Вход только по приглашению')).toBeTruthy();
    expectNoTelegram();
    expect(codeField().value).toBe('k7pm 2xq9 hd4t');
    await waitFor(() => expect(document.activeElement).toBe(codeField()));
    expect(liveRegion().textContent).toMatch(/код приглашения/i);
  });

  it.each([
    ['invite_not_found', 'Код не найден'],
    ['invite_expired', 'Срок действия кода истёк'],
    ['invite_exhausted', 'Код уже использован'],
    ['invalid_invite_format', 'Неверный формат кода'],
  ])('%s from /telegram → A with the code and «%s»; a re-check resends the held payload by itself', async (code, text) => {
    const onAuth = vi.fn().mockRejectedValueOnce(deny(code)).mockResolvedValueOnce(undefined);
    const checkInvite = ok();
    renderModal({ onAuth, checkInvite });
    await enterCode();
    await screen.findByText('Код принят');
    clickTelegram();
    expect(await screen.findByText(text)).toBeTruthy();
    expect(codeField().value).toBe('k7pm 2xq9 hd4t');
    expectNoTelegram();

    await enterCode('ABCD-EFGH-JKMN');
    await waitFor(() => expect(onAuth).toHaveBeenCalledTimes(2));
    expect(onAuth.mock.calls[1]).toEqual([PAYLOAD, 'ABCDEFGHJKMN']);
    // The very same payload — no new Telegram click.
    expect(onAuth.mock.calls[1][0]).toBe(onAuth.mock.calls[0][0]);
    expect(screen.getByText('Код принят')).toBeTruthy();
  });

  it.each(['Expired', 'Replayed'])('%s → asks for a new Telegram click, stays on B', async (code) => {
    const onAuth = vi.fn().mockRejectedValueOnce(deny(code, 401)).mockResolvedValueOnce(undefined);
    renderModal({ onAuth });
    await enterCode();
    await screen.findByText('Код принят');
    clickTelegram();
    expect(await screen.findByText('Нажмите кнопку Telegram ещё раз')).toBeTruthy();
    expect(screen.getByText('Код принят')).toBeTruthy();
    const fresh = { ...PAYLOAD, hash: 'def' };
    clickTelegram(fresh);
    await waitFor(() => expect(onAuth).toHaveBeenLastCalledWith(fresh, 'K7PM2XQ9HD4T'));
  });

  it('429 → rate-limit text; «Повторить» resends the held payload with the code', async () => {
    const onAuth = vi.fn().mockRejectedValueOnce(deny(null, 429)).mockResolvedValueOnce(undefined);
    renderModal({ onAuth });
    await enterCode();
    await screen.findByText('Код принят');
    clickTelegram();
    expect(await screen.findByText('Слишком много попыток — повторите через минуту')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(onAuth).toHaveBeenCalledTimes(2));
    expect(onAuth.mock.calls[1]).toEqual([PAYLOAD, 'K7PM2XQ9HD4T']);
  });

  it.each([
    ['user_blocked', 403, 'Аккаунт заблокирован — вход невозможен'],
    ['InvalidHash', 401, 'Не получилось войти. Попробуйте ещё раз.'],
  ])('%s → clear message', async (code, status, text) => {
    renderModal({ onAuth: vi.fn().mockRejectedValue(deny(code, status)) });
    await enterCode();
    await screen.findByText('Код принят');
    clickTelegram();
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('the widget payload never lands in storage', async () => {
    const onAuth = vi.fn().mockRejectedValueOnce(deny('invite_expired'));
    renderModal({ onAuth });
    await enterCode();
    await screen.findByText('Код принят');
    clickTelegram();
    await screen.findByText('Срок действия кода истёк');
    for (const store of [sessionStorage, localStorage])
      for (let i = 0; i < store.length; i++) expect(store.getItem(store.key(i) as string)).not.toContain(PAYLOAD.hash);
  });
});

describe('LoginModal — C «Есть аккаунт» and the device marker', () => {
  it('marker → opens on C: Telegram button, explanation, «Новый пользователь? Ввести код» button', () => {
    localStorage.setItem(ACCOUNT_MARKER_KEY, '1');
    renderModal();
    expect(screen.getByText('Если аккаунта нет, вход не выполнится и данные не сохранятся.')).toBeTruthy();
    expect(telegramScripts()).toHaveLength(1);
    expect(screen.queryByLabelText('Код приглашения')).toBeNull();
    expect(screen.getByRole('button', { name: 'Новый пользователь? Ввести код' }).tagName).toBe('BUTTON');
  });

  it('Telegram click in C sends no code', async () => {
    localStorage.setItem(ACCOUNT_MARKER_KEY, '1');
    const { onAuth } = renderModal();
    clickTelegram();
    await waitFor(() => expect(onAuth).toHaveBeenCalledWith(PAYLOAD, null));
  });

  it('«Новый пользователь? Ввести код» → A without the widget', async () => {
    localStorage.setItem(ACCOUNT_MARKER_KEY, '1');
    renderModal();
    simulateWidgetIframe();
    fireEvent.click(screen.getByRole('button', { name: 'Новый пользователь? Ввести код' }));
    expect(await screen.findByText('Вход только по приглашению')).toBeTruthy();
    expectNoTelegram();
    await waitFor(() => expect(document.activeElement).toBe(codeField()));
  });

  it('invite_required → marker removed, A with «Аккаунт не найден…»; a checked code resends the held payload', async () => {
    localStorage.setItem(ACCOUNT_MARKER_KEY, '1');
    const onAuth = vi.fn().mockRejectedValueOnce(deny('invite_required', 403)).mockResolvedValueOnce(undefined);
    renderModal({ onAuth });
    clickTelegram();
    expect(await screen.findByText('Аккаунт не найден. Нужен код приглашения')).toBeTruthy();
    expect(localStorage.getItem(ACCOUNT_MARKER_KEY)).toBeNull();
    expect(onAuth).toHaveBeenCalledWith(PAYLOAD, null);
    expectNoTelegram();
    await waitFor(() => expect(document.activeElement).toBe(codeField()));

    await enterCode();
    await waitFor(() => expect(onAuth).toHaveBeenCalledTimes(2));
    expect(onAuth.mock.calls[1]).toEqual([PAYLOAD, 'K7PM2XQ9HD4T']);
    expect(onAuth.mock.calls[1][0]).toBe(onAuth.mock.calls[0][0]);
  });

  it('a broken localStorage → A', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    renderModal();
    expect(screen.getByLabelText('Код приглашения')).toBeTruthy();
    expectNoTelegram();
  });
});

describe('LoginModal — pending invite / draft (decision 1) and reopening (decision 11)', () => {
  it('a pending invite wins over the marker: A, prefilled, checked automatically → B', async () => {
    localStorage.setItem(ACCOUNT_MARKER_KEY, '1');
    const checkInvite = ok();
    renderModal({ checkInvite, inviteCode: 'K7PM-2XQ9-HD4T' });
    // While the check runs: A, prefilled, no Telegram.
    expect(codeField().value).toBe('K7PM-2XQ9-HD4T');
    expectNoTelegram();
    expect(await screen.findByText('Код принят')).toBeTruthy();
    expect(checkInvite).toHaveBeenCalledTimes(1);
    expect(checkInvite).toHaveBeenCalledWith('K7PM2XQ9HD4T');
  });

  it('a typed draft (after a reload) is checked automatically too, and wins over the link code', async () => {
    sessionStorage.setItem(INVITE_DRAFT_KEY, 'abcd efgh jkmn');
    const checkInvite = ok(null);
    renderModal({ checkInvite, inviteCode: 'K7PM-2XQ9-HD4T' });
    expect(await screen.findByText('Код для входа')).toBeTruthy();
    expect(checkInvite).toHaveBeenCalledWith('ABCDEFGHJKMN');
  });

  it('a failing automatic check stays on A with the error', async () => {
    renderModal({ checkInvite: vi.fn().mockRejectedValue(deny('invite_expired')), inviteCode: 'K7PM-2XQ9-HD4T' });
    expect(await screen.findByText('Срок действия кода истёк')).toBeTruthy();
    expectNoTelegram();
  });

  it('auto-check at most once per opening (StrictMode); reopening starts afresh and checks again', async () => {
    const checkInvite = ok();
    const ui = (opened: boolean) => (
      <StrictMode>
        <MantineProvider>
          <LoginModal opened={opened} onClose={vi.fn()} onAuth={vi.fn()} checkInvite={checkInvite} inviteCode="K7PM-2XQ9-HD4T" />
        </MantineProvider>
      </StrictMode>
    );
    const r = render(ui(true));
    await screen.findByText('Код принят');
    expect(checkInvite).toHaveBeenCalledTimes(1);
    // StrictMode mounts effects twice: still exactly one widget script.
    expect(telegramScripts()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить код' }));
    await screen.findByText('Вход только по приглашению');
    expect(checkInvite).toHaveBeenCalledTimes(1);

    r.rerender(ui(false));
    await waitFor(() => expect(telegramScripts()).toHaveLength(0));
    r.rerender(ui(true));
    await screen.findByText('Код принят');
    expect(checkInvite).toHaveBeenCalledTimes(2);
  });

  it('reopening after C → A starts from the marker rules again', async () => {
    localStorage.setItem(ACCOUNT_MARKER_KEY, '1');
    const { setOpened } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Новый пользователь? Ввести код' }));
    await screen.findByText('Вход только по приглашению');
    setOpened(false);
    setOpened(true);
    expect(await screen.findByText('Если аккаунта нет, вход не выполнится и данные не сохранятся.')).toBeTruthy();
  });

  it('closing removes the widget', async () => {
    localStorage.setItem(ACCOUNT_MARKER_KEY, '1');
    const { setOpened } = renderModal();
    expect(telegramScripts()).toHaveLength(1);
    setOpened(false);
    await waitFor(() => expect(telegramScripts()).toHaveLength(0));
  });
});
