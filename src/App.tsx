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
import { parseHash, buildHash, type HashState } from './shell/hash';

const SHELL_ORIGIN = 'https://mvv42.ru';

export default function App() {
  const { services, loading, error } = useRegistry();
  const [active, setActive] = useState<Service | null>(null);
  const [initialPath, setInitialPath] = useState<string>('/');
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);

  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = active?.id ?? null;
  }, [active]);

  /** Resolve service from parsed hash once registry is loaded */
  const applyHash = useCallback(
    (state: HashState) => {
      if (services.length === 0) return;
      const found = state.serviceId
        ? (services.find((s) => s.id === state.serviceId) ?? null)
        : null;
      setActive(found);
      setInitialPath(state.servicePath);
    },
    [services],
  );

  // Initialise from hash on first load (intentional — runs once when registry loads)
  useEffect(() => {
    if (services.length === 0) return;
    applyHash(parseHash(window.location.hash)); // eslint-disable-line react-hooks/set-state-in-effect
  }, [services, applyHash]);

  // Handle browser Back / Forward (hashchange fires for hash navigation)
  useEffect(() => {
    function onHashChange() {
      applyHash(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applyHash]);

  // Select a service (sidebar / welcome card click) — always at service root
  const selectService = useCallback(
    (service: Service) => {
      setActive(service);
      setInitialPath('/');
      closeNav();
      window.location.hash = buildHash(service.id, '/');
    },
    [closeNav],
  );

  // Listen for NAVIGATE postMessage from iframe → update hash
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== SHELL_ORIGIN) return;
      const data = e.data as { type?: string; serviceId?: string; path?: string };
      if (data?.type !== 'NAVIGATE' || !data.serviceId || !data.path) return;
      if (data.serviceId !== activeIdRef.current) return;

      // Update hash without triggering hashchange (replaceState on hash)
      const newHash = buildHash(data.serviceId, data.path);
      // Use replaceState so Back button skips over intermediate navigation steps
      history.replaceState(null, '', newHash);
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

      <Sidebar services={services} active={active} onSelect={selectService} />

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
