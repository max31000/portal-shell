import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { AuthRequestError, type TelegramAuthData } from '../auth/api';
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
  return () => vi.unstubAllGlobals();
});

function renderModal(opened: boolean) {
  const ui = (o: boolean) => (
    <StrictMode>
      <MantineProvider>
        <LoginModal opened={o} onClose={vi.fn()} onAuth={vi.fn().mockResolvedValue(undefined)} />
      </MantineProvider>
    </StrictMode>
  );
  const r = render(ui(opened));
  return { ...r, setOpened: (o: boolean) => r.rerender(ui(o)) };
}

const widgetScripts = () => document.querySelectorAll('script[data-telegram-login]');

describe('LoginModal', () => {
  it('inserts exactly one Telegram widget script under StrictMode', () => {
    renderModal(true);
    expect(widgetScripts()).toHaveLength(1);
  });

  it('removes the widget when closed', () => {
    const { setOpened } = renderModal(true);
    setOpened(false);
    expect(widgetScripts()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- closed registration

const PAYLOAD: TelegramAuthData = { id: 4242, first_name: 'Аня', auth_date: 1_760_000_000, hash: 'abc' };

function deny(code: string, status = 400) {
  return new AuthRequestError(status, `Login failed (${status})`, code);
}

function renderInviteModal(onAuth: LoginModalProps['onAuth'], inviteCode: string | null = null) {
  return renderWithKit(<LoginModal opened onClose={vi.fn()} onAuth={onAuth} inviteCode={inviteCode} />);
}

/** What the Telegram widget does after a click: calls the global callback with the signed payload. */
function clickTelegram(payload: TelegramAuthData = PAYLOAD) {
  const cb = window.__mvv42OnTelegramAuth;
  if (!cb) throw new Error('widget callback not registered');
  act(() => cb(payload));
}

const codeField = () => screen.getByLabelText('Код приглашения (для новых пользователей)') as HTMLInputElement;

describe('LoginModal: invite code', () => {
  it('shows the closed-registration note and an empty optional code field', () => {
    renderInviteModal(vi.fn().mockResolvedValue(undefined));
    expect(screen.getByText('Вход только по приглашению')).toBeTruthy();
    expect(codeField().value).toBe('');
    expect(screen.queryByRole('button', { name: 'Продолжить' })).toBeNull();
  });

  it('prefills the code from the invite link; a typed draft wins after a reload', () => {
    const { unmount } = renderInviteModal(vi.fn(), 'K7PM-2XQ9-HD4T');
    expect(codeField().value).toBe('K7PM-2XQ9-HD4T');
    fireEvent.change(codeField(), { target: { value: 'ABCD-EFGH-JKMN' } });
    expect(sessionStorage.getItem(INVITE_DRAFT_KEY)).toBe('ABCD-EFGH-JKMN');
    unmount();
    renderInviteModal(vi.fn(), 'K7PM-2XQ9-HD4T');
    expect(codeField().value).toBe('ABCD-EFGH-JKMN');
  });

  it('known user without a code: sends no code', async () => {
    const onAuth = vi.fn().mockResolvedValue(undefined);
    renderInviteModal(onAuth);
    clickTelegram();
    await waitFor(() => expect(onAuth).toHaveBeenCalledWith(PAYLOAD, null));
  });

  it('sends the normalised code with the widget payload', async () => {
    const onAuth = vi.fn().mockResolvedValue(undefined);
    renderInviteModal(onAuth);
    fireEvent.change(codeField(), { target: { value: ' к7рм-2хq9-нd4т ' } });
    clickTelegram();
    await waitFor(() => expect(onAuth).toHaveBeenCalledWith(PAYLOAD, 'K7PM2XQ9HD4T'));
  });

  it('invite_required: highlights the field, keeps the payload; «Продолжить» resubmits it with the code', async () => {
    const onAuth = vi.fn().mockRejectedValueOnce(deny('invite_required', 403)).mockResolvedValueOnce(undefined);
    renderInviteModal(onAuth);
    clickTelegram();
    const callout = await screen.findByText(/Новым пользователям нужен код приглашения\. Нет кода — напишите в Telegram/);
    const link = within(callout).getByRole('link', { name: '@mvv42' }) as HTMLAnchorElement;
    expect(link.href).toBe('https://t.me/mvv42');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    // The widget stays mounted (a fresh click remains possible).
    expect(widgetScripts()).toHaveLength(1);
    expect(document.activeElement).toBe(codeField());

    const cont = screen.getByRole('button', { name: 'Продолжить' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    fireEvent.change(codeField(), { target: { value: 'k7pm 2xq9 hd4t' } });
    fireEvent.click(cont);
    await waitFor(() => expect(onAuth).toHaveBeenCalledTimes(2));
    expect(onAuth.mock.calls[1]).toEqual([PAYLOAD, 'K7PM2XQ9HD4T']);
    // The very same payload: no new Telegram click.
    expect(onAuth.mock.calls[1][0]).toBe(onAuth.mock.calls[0][0]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Продолжить' })).toBeNull());
  });

  it.each([
    ['invite_not_found', 'Код не найден'],
    ['invite_expired', 'Срок действия кода истёк'],
    ['invite_exhausted', 'Код уже использован'],
    ['invalid_invite_format', 'Неверный формат кода'],
  ])('%s: «%s» on the field, payload kept for another try', async (code, text) => {
    const onAuth = vi.fn().mockRejectedValueOnce(deny(code)).mockResolvedValueOnce(undefined);
    renderInviteModal(onAuth, 'K7PM-2XQ9-HD4T');
    clickTelegram();
    expect(await screen.findByText(text)).toBeTruthy();
    expect(codeField().getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(codeField(), { target: { value: 'ABCD-EFGH-JKMN' } });
    expect(screen.queryByText(text)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(onAuth).toHaveBeenLastCalledWith(PAYLOAD, 'ABCDEFGHJKMN'));
  });

  it('a malformed code is rejected on the client: no request', async () => {
    const onAuth = vi.fn().mockResolvedValue(undefined);
    renderInviteModal(onAuth);
    fireEvent.change(codeField(), { target: { value: 'привет' } });
    clickTelegram();
    expect(await screen.findByText('Неверный формат кода')).toBeTruthy();
    expect(onAuth).not.toHaveBeenCalled();
    fireEvent.change(codeField(), { target: { value: 'K7PM-2XQ9-HD4T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(onAuth).toHaveBeenCalledWith(PAYLOAD, 'K7PM2XQ9HD4T'));
  });

  it.each(['Expired', 'Replayed'])('%s after «Продолжить»: asks for a new Telegram click, keeps the code', async (code) => {
    const onAuth = vi
      .fn()
      .mockRejectedValueOnce(deny('invite_required', 403))
      .mockRejectedValueOnce(deny(code, 401))
      .mockResolvedValueOnce(undefined);
    renderInviteModal(onAuth);
    clickTelegram();
    await screen.findByRole('button', { name: 'Продолжить' });
    fireEvent.change(codeField(), { target: { value: 'K7PM-2XQ9-HD4T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    expect(await screen.findByText('Нажмите кнопку Telegram ещё раз')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Продолжить' })).toBeNull();
    expect(codeField().value).toBe('K7PM-2XQ9-HD4T');
    expect(sessionStorage.getItem(INVITE_DRAFT_KEY)).toBe('K7PM-2XQ9-HD4T');
    const fresh = { ...PAYLOAD, auth_date: PAYLOAD.auth_date + 4000, hash: 'def' };
    clickTelegram(fresh);
    await waitFor(() => expect(onAuth).toHaveBeenLastCalledWith(fresh, 'K7PM2XQ9HD4T'));
  });

  it.each([
    ['user_blocked', 403, 'Аккаунт заблокирован — вход невозможен'],
    ['rate_limited', 429, 'Слишком много попыток — повторите через минуту'],
    ['InvalidHash', 401, 'Не получилось войти. Попробуйте ещё раз.'],
  ])('%s: clear message', async (code, status, text) => {
    renderInviteModal(vi.fn().mockRejectedValue(deny(code, status)));
    clickTelegram();
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('a network failure shows the generic message', async () => {
    renderInviteModal(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    clickTelegram();
    expect(await screen.findByText('Не получилось войти. Попробуйте ещё раз.')).toBeTruthy();
  });
});
