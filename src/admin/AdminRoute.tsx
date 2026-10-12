import { lazy, Suspense } from 'react';
import { Loader } from '@mantine/core';
import type { AuthStatus } from '../auth/useAuth';
import type { AuthUser } from '../auth/api';
import { NotFound } from '../components/NotFound';
import type { Service } from '../types';
import type { AdminTab } from './route';
import classes from './Admin.module.css';

// The console itself is a separate chunk, requested only once the signed-in user is the owner.
const AdminPage = lazy(() => import('./AdminPage').then((m) => ({ default: m.AdminPage })));

function Spinner() {
  return (
    <div className={classes.center} aria-busy="true">
      <Loader size="sm" />
    </div>
  );
}

interface AdminRouteProps {
  authStatus: AuthStatus;
  user: AuthUser | null;
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  services: Service[];
  onHome: () => void;
  /** An admin call answered 401/403. */
  onAuthLost?: () => void;
}

/** `#/admin`: the console for the owner (`me.user.isOwner`), a plain 404 for everyone else. */
export function AdminRoute({ authStatus, user, tab, onTabChange, services, onHome, onAuthLost }: AdminRouteProps) {
  if (authStatus === 'loading') return <Spinner />;
  if (!user?.isOwner) return <NotFound onHome={onHome} />;
  return (
    <Suspense fallback={<Spinner />}>
      <AdminPage
        tab={tab}
        onTabChange={onTabChange}
        services={services}
        currentUserId={user.telegramId}
        onAuthLost={onAuthLost}
      />
    </Suspense>
  );
}
