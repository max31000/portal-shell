import { AppShell, Group, Text, ActionIcon, Burger, useMantineColorScheme } from '@mantine/core';
import { IconSun, IconMoon, IconDeviceDesktop } from '@tabler/icons-react';
import type { Service } from '../types';

interface ToolbarProps {
  active: Service | null;
  navOpened: boolean;
  onBurgerClick: () => void;
}

export function Toolbar({ active, navOpened, onBurgerClick }: ToolbarProps) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  function cycleTheme() {
    if (colorScheme === 'auto') setColorScheme('light');
    else if (colorScheme === 'light') setColorScheme('dark');
    else setColorScheme('auto');
  }

  const ThemeIcon =
    colorScheme === 'dark' ? IconMoon : colorScheme === 'light' ? IconSun : IconDeviceDesktop;

  return (
    <AppShell.Header>
      <Group h="100%" px="md" justify="space-between">
        {/* Left: burger (mobile) + service name */}
        <Group gap="sm">
          <Burger
            opened={navOpened}
            onClick={onBurgerClick}
            hiddenFrom="sm"
            size="sm"
          />
          {active && (
            <Group gap="xs">
              <Text size="lg" style={{ lineHeight: 1 }}>
                {active.icon}
              </Text>
              <Text fw={600} size="sm">
                {active.name}
              </Text>
            </Group>
          )}
        </Group>

        {/* Right: theme toggle */}
        <ActionIcon
          variant="subtle"
          size="lg"
          onClick={cycleTheme}
          title="Переключить тему"
          aria-label="Переключить тему"
        >
          <ThemeIcon size={18} />
        </ActionIcon>
      </Group>
    </AppShell.Header>
  );
}
