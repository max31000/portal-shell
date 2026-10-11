import type { ReactNode } from 'react';
import { useMantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import type { Service } from '../types';
import { AppIcon } from './AppIcon';
import classes from './TopBar.module.css';
import ui from './ui.module.css';

interface TopBarProps {
  active: Service | null;
  onHome: () => void;
  /** Launcher button + popover. */
  launcher: ReactNode;
  /** User menu / sign-in button; omitted when auth is unavailable. */
  userSlot?: ReactNode;
}

const SCHEME_LABEL = { auto: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' } as const;

function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const next = colorScheme === 'auto' ? 'light' : colorScheme === 'light' ? 'dark' : 'auto';
  const Icon = colorScheme === 'dark' ? IconMoon : colorScheme === 'light' ? IconSun : IconDeviceDesktop;
  const label = SCHEME_LABEL[colorScheme];

  return (
    <button
      type="button"
      className={ui.iconButton}
      onClick={() => setColorScheme(next)}
      title={label}
      aria-label={`${label}. Переключить`}
    >
      <Icon size={18} stroke={1.75} />
    </button>
  );
}

export function TopBar({ active, onHome, launcher, userSlot }: TopBarProps) {
  return (
    <header className={classes.bar}>
      <div className={classes.left}>
        <a
          href="#/"
          className={classes.brand}
          onClick={(e) => {
            e.preventDefault();
            onHome();
          }}
          aria-label="mvv42 — на главную"
        >
          <span className={classes.mark} aria-hidden="true">
            m
          </span>
          <span className={classes.wordmark}>mvv42</span>
        </a>

        {active && (
          <div className={classes.crumb}>
            <span className={classes.slash} aria-hidden="true">
              /
            </span>
            <AppIcon icon={active.icon} name={active.name} color={active.color} size={20} />
            <span className={classes.serviceName}>{active.name}</span>
          </div>
        )}
      </div>

      <div className={classes.right}>
        {launcher}
        <ThemeToggle />
        {userSlot && <div className={classes.userSlot}>{userSlot}</div>}
      </div>
    </header>
  );
}
