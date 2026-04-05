import { useState, useEffect, useCallback } from 'react';
import { AppShell, Drawer, Center, Loader, Text, Stack, Alert } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { useRegistry } from './useRegistry';
import { Sidebar } from './components/Sidebar';
import { ServiceFrame } from './components/ServiceFrame';
import { Toolbar } from './components/Toolbar';
import type { Service } from './types';

function getAppFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('app');
}

export default function App() {
  const { services, loading, error } = useRegistry();
  const [active, setActive] = useState<Service | null>(null);
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);

  // Initialise active service from URL or first in list
  useEffect(() => {
    if (services.length === 0) return;
    const appId = getAppFromUrl();
    const found = appId ? services.find((s) => s.id === appId) : null;
    setActive(found ?? services[0]);
  }, [services]);

  // Push URL state on active change
  const selectService = useCallback(
    (service: Service) => {
      setActive(service);
      closeNav();
      history.pushState({ serviceId: service.id }, '', `/?app=${service.id}`);
    },
    [closeNav],
  );

  // Handle browser Back / Forward
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const id = (e.state as { serviceId?: string } | null)?.serviceId ?? getAppFromUrl();
      if (id && services.length > 0) {
        const found = services.find((s) => s.id === id);
        if (found) setActive(found);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [services]);

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
          <ServiceFrame service={active} />
        ) : (
          <Center h="100%">
            <Text c="dimmed">Нет доступных сервисов</Text>
          </Center>
        )}
      </AppShell.Main>
    </AppShell>
  );
}
