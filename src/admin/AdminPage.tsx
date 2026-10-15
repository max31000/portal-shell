import { lazy, Suspense, useEffect } from 'react';
import { Skeleton, Tabs } from '@mantine/core';
import { Page } from '@mvv42/kit';
import {
  IconActivityHeartbeat,
  IconAddressBook,
  IconApps,
  IconHistory,
  IconLayoutDashboard,
  IconTicket,
} from '@tabler/icons-react';
import type { Service } from '../types';
import { AppsTab } from './AppsTab';
import { InvitesTab } from './InvitesTab';
import { LoginsTab } from './LoginsTab';
import { OverviewTab } from './OverviewTab';
import { UsersTab } from './UsersTab';
import { onAdminAuthLost } from './api';
import { isAdminTab, type AdminTab } from './route';
import classes from './Admin.module.css';

// Monitoring is its own chunk: Recharts stays out of the other admin tabs.
const MonitoringTab = lazy(() => import('./monitoring/MonitoringTab').then((m) => ({ default: m.MonitoringTab })));

interface AdminPageProps {
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  /** Registry entries: icons and colours for app ids. */
  services: Service[];
  /** Telegram id of the signed-in owner (marks «вы» in lists). */
  currentUserId?: number;
  /** An admin call answered 401/403: re-read `/me` (the route then shows sign-in or 404). */
  onAuthLost?: () => void;
}

const TABS: { value: AdminTab; label: string; Icon: typeof IconApps }[] = [
  { value: 'overview', label: 'Обзор', Icon: IconLayoutDashboard },
  { value: 'users', label: 'Пользователи', Icon: IconAddressBook },
  { value: 'apps', label: 'Сервисы', Icon: IconApps },
  { value: 'invites', label: 'Инвайты', Icon: IconTicket },
  { value: 'log', label: 'Журнал', Icon: IconHistory },
  { value: 'monitoring', label: 'Мониторинг', Icon: IconActivityHeartbeat },
];

/** Owner console (spec §3.2): Mantine Tabs over the admin API; the shell has no router. */
export function AdminPage({ tab, onTabChange, services, currentUserId, onAuthLost }: AdminPageProps) {
  useEffect(() => (onAuthLost ? onAdminAuthLost(onAuthLost) : undefined), [onAuthLost]);

  return (
    <div className={classes.scroll}>
      <Page
        title="Админка"
        description="Пользователи, доступ к сервисам, инвайты, журнал входов и мониторинг сервера"
        width="wide"
        className={classes.page}
      >
        <Tabs
          value={tab}
          onChange={(v) => isAdminTab(v) && onTabChange(v)}
          keepMounted={false}
          classNames={{ list: classes.tabsList, tab: classes.tab }}
        >
          <Tabs.List aria-label="Разделы админки">
            {TABS.map(({ value, label, Icon }) => (
              <Tabs.Tab key={value} value={value} leftSection={<Icon size={16} stroke={1.75} />}>
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          <Tabs.Panel value="overview" className={classes.panel}>
            <OverviewTab services={services} onOpenApps={() => onTabChange('apps')} />
          </Tabs.Panel>
          <Tabs.Panel value="users" className={classes.panel}>
            <UsersTab services={services} currentUserId={currentUserId} />
          </Tabs.Panel>
          <Tabs.Panel value="apps" className={classes.panel}>
            <AppsTab services={services} />
          </Tabs.Panel>
          <Tabs.Panel value="invites" className={classes.panel}>
            <InvitesTab services={services} />
          </Tabs.Panel>
          <Tabs.Panel value="log" className={classes.panel}>
            <LoginsTab />
          </Tabs.Panel>
          <Tabs.Panel value="monitoring" className={classes.panel}>
            <Suspense fallback={<Skeleton height={320} radius="md" aria-label="Загрузка мониторинга" />}>
              <MonitoringTab />
            </Suspense>
          </Tabs.Panel>
        </Tabs>
      </Page>
    </div>
  );
}
