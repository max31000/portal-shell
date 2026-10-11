import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AppIcon } from './AppIcon';
import { ICONS, resolveIcon } from './icons';

describe('resolveIcon', () => {
  it('maps known Tabler names', () => {
    expect(resolveIcon('chart-candle', 'Bonds')).toEqual({ kind: 'tabler', Icon: ICONS['chart-candle'] });
  });

  it('falls back to the first letter for unknown names', () => {
    expect(resolveIcon('no-such-icon', 'cashPulse')).toEqual({ kind: 'text', text: 'C' });
  });

  it('falls back to the first letter when icon is empty', () => {
    expect(resolveIcon('', 'ипотека')).toEqual({ kind: 'text', text: 'И' });
    expect(resolveIcon(undefined, 'x')).toEqual({ kind: 'text', text: 'X' });
  });

  it('tolerates legacy emoji', () => {
    expect(resolveIcon('📊', 'CashPulse')).toEqual({ kind: 'text', text: '📊' });
  });

  it('includes every registry icon', () => {
    for (const name of ['chart-area-line', 'home-dollar', 'chart-candle']) {
      expect(ICONS[name]).toBeDefined();
    }
  });
});

describe('AppIcon', () => {
  it('renders an svg for known icons and a letter otherwise', () => {
    const { container, rerender } = render(<AppIcon icon="home-dollar" name="Ипотека" color="#40c057" />);
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<AppIcon icon="unknown" name="Zeta" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('Z');
  });
});
