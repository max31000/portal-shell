import { AppShell, NavLink, Text, Box, Divider, Stack } from '@mantine/core';
import type { Service } from '../types';

interface SidebarProps {
  services: Service[];
  active: Service | null;
  onSelect: (service: Service) => void;
}

export function Sidebar({ services, active, onSelect }: SidebarProps) {
  return (
    <AppShell.Navbar p="sm">
      <Stack gap={0} h="100%">
        {/* Header */}
        <Box pb="sm">
          <Text fw={700} size="lg" c="dimmed" style={{ letterSpacing: '-0.5px' }}>
            mvv42.ru
          </Text>
        </Box>

        <Divider mb="sm" />

        {/* Services list */}
        <Stack gap={4} style={{ flex: 1, overflowY: 'auto' }}>
          {services.map((service) => (
            <NavLink
              key={service.id}
              label={service.name}
              description={service.description}
              leftSection={
                <Text size="lg" style={{ lineHeight: 1 }}>
                  {service.icon}
                </Text>
              }
              active={active?.id === service.id}
              variant={active?.id === service.id ? 'filled' : 'subtle'}
              color={service.color}
              onClick={() => onSelect(service)}
              style={{ borderRadius: 8 }}
            />
          ))}
        </Stack>

        {/* Footer */}
        <Box pt="sm">
          <Divider mb="sm" />
          <Text size="xs" c="dimmed" ta="center">
            v1.0.0
          </Text>
        </Box>
      </Stack>
    </AppShell.Navbar>
  );
}
