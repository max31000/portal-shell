import type { Service } from '../types';

/** `#/admin[/<tab>]` — a shell route, not a service (`admin` is a reserved app id in mvv42-auth). */
export const ADMIN_ID = 'admin';

export const ADMIN_TABS = ['overview', 'users', 'apps', 'invites', 'log'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export function isAdminTab(v: unknown): v is AdminTab {
  return typeof v === 'string' && (ADMIN_TABS as readonly string[]).includes(v);
}

/** Path inside the admin route (`/`, `/users`, `/users?x`) → tab; unknown → overview. */
export function parseAdminTab(path: string): AdminTab {
  const first = path.split('?')[0].split('/').filter(Boolean)[0];
  return isAdminTab(first) ? first : 'overview';
}

export function adminHash(tab: AdminTab = 'overview'): string {
  return tab === 'overview' ? `#/${ADMIN_ID}` : `#/${ADMIN_ID}/${tab}`;
}

/** Launcher / top-bar entry for the admin console (rendered like a service tile). */
export const ADMIN_ENTRY: Service = {
  id: ADMIN_ID,
  name: 'Админка',
  description: 'Пользователи, доступы и инвайты',
  icon: 'shield-lock',
  path: '/',
  color: '#52525b',
};
