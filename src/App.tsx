import { useState, useEffect, useCallback, useRef } from 'react';
import { useComputedColorScheme, AppShell, Drawer, Center, Loader, Text, Stack, Alert } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { useRegistry } from './useRegistry';
import { Sidebar } from './components/Sidebar';
import { ServiceFrame } from './components/ServiceFrame';
import { Toolbar } from './components/Toolbar';
import { Home } from './components/Home';
import type { Service } from './types';
import type { AuthRequiredMessage, NavigateMessage } from './shell/messages';
import { parseHash, buildHash, type HashState } from './shell/hash';

export default function App() {
  const { services, loading, error } = useRegistry();
  const scheme = useComputedColorScheme('light');
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

  // Validated messages from the active service iframe (origin + source + serviceId checked in ServiceFrame).
  const onServiceMessage = useCallback((msg: NavigateMessage | AuthRequiredMessage) => {
    if (msg.type === 'NAVIGATE') {
      // replaceState: Back skips intermediate in-service steps and no hashchange fires.
      history.replaceState(null, '', buildHash(msg.serviceId, msg.path));
    }
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
          <ServiceFrame
            key={active.id}
            service={active}
            initialPath={initialPath}
            scheme={scheme}
            onServiceMessage={onServiceMessage}
          />
        ) : (
          <Home services={services} onSelect={selectService} />
        )}
      </AppShell.Main>
    </AppShell>
  );
}
