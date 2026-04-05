import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell, Drawer, Center, Loader, Text, Stack, Alert } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { useRegistry } from './useRegistry';
import { Sidebar } from './components/Sidebar';
import { ServiceFrame } from './components/ServiceFrame';
import { Toolbar } from './components/Toolbar';
import { Welcome } from './components/Welcome';
import type { Service } from './types';

const SHELL_ORIGIN = 'https://mvv42.ru';

interface UrlState {
  appId: string | null;
  /** Path inside the service, e.g. "/operations" or "/" */
  path: string;
}

function parseUrl(): UrlState {
  const params = new URLSearchParams(window.location.search);
  return {
    appId: params.get('app'),
    path: params.get('path') ?? '/',
  };
}

function buildShellUrl(serviceId: string, path: string): string {
  const p = path && path !== '/' ? `&path=${encodeURIComponent(path)}` : '';
  return `/?app=${serviceId}${p}`;
}

export default function App() {
  const { services, loading, error } = useRegistry();
  const [active, setActive] = useState<Service | null>(null);
  const [initialPath, setInitialPath] = useState<string>('/');
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);

  // Track active service id in a ref so postMessage handler always has fresh value
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = active?.id ?? null;
  }, [active]);

  // Initialise from URL on first load (after registry is ready)
  useEffect(() => {
    if (services.length === 0) return;
    const { appId, path } = parseUrl();
    const found = appId ? (services.find((s) => s.id === appId) ?? null) : null;
    setActive(found);
    setInitialPath(path);
  }, [services]);

  // Select a service from sidebar/welcome (always starts at root of service)
  const selectService = useCallback(
    (service: Service) => {
      setActive(service);
      setInitialPath('/');
      closeNav();
      history.pushState({ serviceId: service.id, path: '/' }, '', `/?app=${service.id}`);
    },
    [closeNav],
  );

  // Handle browser Back / Forward
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const state = e.state as { serviceId?: string; path?: string } | null;
      const { appId, path } = parseUrl();
      const id = state?.serviceId ?? appId;
      const restoredPath = state?.path ?? path;

      if (!id) {
        setActive(null);
        setInitialPath('/');
        return;
      }
      if (services.length > 0) {
        const found = services.find((s) => s.id === id) ?? null;
        setActive(found);
        setInitialPath(restoredPath ?? '/');
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [services]);

  // Listen for NAVIGATE messages from iframe (service internal navigation)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== SHELL_ORIGIN) return;

      const data = e.data as { type?: string; serviceId?: string; path?: string };
      if (data?.type !== 'NAVIGATE') return;

      const { serviceId, path } = data;
      if (!serviceId || !path) return;

      // Only update URL if the message is from the currently active service
      if (serviceId !== activeIdRef.current) return;

      const url = buildShellUrl(serviceId, path);
      history.replaceState({ serviceId, path }, '', url);
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (loading) {
    return (
      <Center h="100vh">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text c="dimmed">Загрузка портала...</Text>
        </Stack>
      </Center>
    );
  }

  if (error) {
    return (
      <Center h="100vh" p="xl">
        <Alert icon={<IconAlertCircle size={18} />} color="red" title="Ошибка загрузки" maw={420}>
          Не удалось загрузить registry.json: {error}
        </Alert>
      </Center>
    );
  }

  return (
    <AppShell
      header={{ height: 48 }}
      navbar={{
        width: 240,
        breakpoint: 'sm',
        collapsed: { mobile: !navOpened },
      }}
      padding={0}
    >
      <Toolbar active={active} navOpened={navOpened} onBurgerClick={toggleNav} />

      {/* Desktop sidebar */}
      <Sidebar services={services} active={active} onSelect={selectService} />

      {/* Mobile drawer */}
      <Drawer
        opened={navOpened}
        onClose={closeNav}
        size={240}
        hiddenFrom="sm"
        withCloseButton={false}
        padding={0}
      >
        <Sidebar services={services} active={active} onSelect={selectService} />
      </Drawer>

      <AppShell.Main style={{ height: '100dvh', paddingTop: 48 }}>
        {active ? (
          <ServiceFrame service={active} initialPath={initialPath} />
        ) : (
          <Welcome services={services} onSelect={selectService} />
        )}
      </AppShell.Main>
    </AppShell>
  );
}
