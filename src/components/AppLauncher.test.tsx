import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppLauncher } from './AppLauncher';
import type { Service } from '../types';

const services: Service[] = [
  { id: 'a', name: 'Alpha', description: '', icon: 'chart-line', path: '/a/', color: '#123456' },
  { id: 'b', name: 'Beta', description: '', icon: 'wallet', path: '/b/', color: '#654321' },
  { id: 'c', name: 'Gamma', description: '', icon: 'coins', path: '/c/', color: '#111111' },
  { id: 'd', name: 'Delta', description: '', icon: 'notes', path: '/d/', color: '#222222' },
];

function setup(props: Partial<Parameters<typeof AppLauncher>[0]> = {}) {
  const onSelect = vi.fn();
  render(<AppLauncher services={services} activeId={null} onSelect={onSelect} {...props} />);
  const button = screen.getByRole('button', { name: 'Сервисы' });
  return { onSelect, button };
}

describe('AppLauncher', () => {
  it('opens a menu with «Главная» first and focuses it', () => {
    const { button } = setup();
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(5);
    expect(items[0].textContent).toContain('Главная');
    expect(document.activeElement).toBe(items[0]);
  });

  it('closes on Escape and returns focus to the button', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on outside click (backdrop)', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByTestId('launcher-backdrop'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('calls onSelect with the chosen service and closes', () => {
    const { button, onSelect } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: /Beta/ }));
    expect(onSelect).toHaveBeenCalledWith(services[1]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('calls onSelect(null) for «Главная»', () => {
    const { button, onSelect } = setup({ activeId: 'a' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: /Главная/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('moves focus with arrow keys across the 3-column grid', () => {
    const { button } = setup();
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    const items = () => screen.getAllByRole('menuitem');

    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(items()[1]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[4]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // no row below: stays
    expect(document.activeElement).toBe(items()[4]);

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items()[1]);

    fireEvent.keyDown(menu, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(items()[0]);

    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items()[4]);
  });

  it('marks locked tiles and routes them to onLockedSelect', () => {
    const onLockedSelect = vi.fn();
    const { button, onSelect } = setup({ isLocked: (s) => s.id === 'c', onLockedSelect });
    fireEvent.click(button);
    const locked = screen.getByRole('menuitem', { name: /Gamma/ });
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(locked);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onLockedSelect).toHaveBeenCalledWith(services[2]);
  });
});
