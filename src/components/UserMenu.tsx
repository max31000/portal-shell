import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu } from '@mantine/core';
import { IconLogout } from '@tabler/icons-react';
import type { AuthUser } from '../auth/api';
import classes from './UserMenu.module.css';
import ui from './ui.module.css';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((p) => [...p][0]?.toUpperCase() ?? '').join('') || '?';
}

function Avatar({ user, size }: { user: AuthUser; size: number }) {
  const [broken, setBroken] = useState(false);
  if (user.photoUrl && !broken) {
    return (
      <img
        className={classes.avatar}
        src={user.photoUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className={classes.avatar} style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials(user.name)}
    </span>
  );
}

interface UserMenuProps {
  user: AuthUser;
  onLogout: () => void;
}

export function UserMenu({ user, onLogout }: UserMenuProps) {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <Menu
        opened={opened}
        onChange={setOpened}
        position="bottom-end"
        offset={8}
        width={240}
        zIndex={200}
        transitionProps={{ transition: 'pop-top-right', duration: 180 }}
        classNames={{ dropdown: classes.dropdown, item: classes.item, divider: classes.divider }}
      >
        <Menu.Target>
          <button type="button" className={`${ui.iconButton} ${classes.trigger}`} aria-label={`Аккаунт: ${user.name}`}>
            <Avatar user={user} size={26} />
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          <div className={classes.header}>
            <Avatar user={user} size={36} />
            <div className={classes.who}>
              <div className={classes.name}>{user.name}</div>
              {user.username && <div className={classes.handle}>@{user.username}</div>}
            </div>
          </div>
          <Menu.Divider />
          <Menu.Item leftSection={<IconLogout size={16} stroke={1.75} />} onClick={onLogout}>
            Выйти
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {/* Clicks inside the service iframe never reach the document; this layer catches them. */}
      {opened &&
        createPortal(<div className={classes.backdrop} onMouseDown={() => setOpened(false)} />, document.body)}
    </>
  );
}

interface SignInButtonProps {
  onClick: () => void;
}

export function SignInButton({ onClick }: SignInButtonProps) {
  return (
    <button type="button" className={ui.pillButton} onClick={onClick}>
      Войти
    </button>
  );
}
