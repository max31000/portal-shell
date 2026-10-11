import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LoginModal } from './LoginModal';

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
