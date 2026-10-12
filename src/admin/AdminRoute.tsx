import { Loader } from '@mantine/core';
import type { AuthStatus } from '../auth/useAuth';
import type { AuthUser } from '../auth/api';
import { NotFound } from '../components/NotFound';
import type { Service } from '../types';
import { AdminPage } from './AdminPage';
import type { AdminTab } from './route';
import classes from './Admin.module.css';

interface AdminRouteProps {
  authStatus: AuthStatus;
  user: AuthUser | null;
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  services: Service[];
  onHome: () => void;
}

/** `#/admin`: the console for the owner (`me.user.isOwner`), a plain 404 for everyone else. */
export function AdminRoute({ authStatus, user, tab, onTabChange, services, onHome }: AdminRouteProps) {
  if (authStatus === 'loading') {
    return (
      <div className={classes.center} aria-busy="true">
        <Loader size="sm" />
      </div>
    );
  }
  if (!user?.isOwner) return <NotFound onHome={onHome} />;
  return <AdminPage tab={tab} onTabChange={onTabChange} services={services} currentUserId={user.telegramId} />;
}
