import { Box, Title, Text, SimpleGrid, Card, Group, Stack } from '@mantine/core';
import type { Service } from '../types';

interface WelcomeProps {
  services: Service[];
  onSelect: (service: Service) => void;
}

export function Welcome({ services, onSelect }: WelcomeProps) {
  return (
    <Box p="xl" style={{ overflowY: 'auto', height: '100%' }}>
      <Stack gap="xl" maw={960} mx="auto">
        {/* Heading */}
        <Stack gap={4} pt="md">
          <Title order={1} fw={800} style={{ letterSpacing: '-1px' }}>
            mvv42.ru
          </Title>
          <Text c="dimmed" size="lg">
            Выберите сервис
          </Text>
        </Stack>

        {/* Service cards grid */}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
          {services.map((service) => (
            <Card
              key={service.id}
              padding="lg"
              radius="md"
              withBorder
              style={{
                borderColor: service.color,
                cursor: 'pointer',
                transition: 'transform 120ms ease, box-shadow 120ms ease',
              }}
              onClick={() => onSelect(service)}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLElement).style.boxShadow =
                  `0 4px 20px ${service.color}40`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.transform = '';
                (e.currentTarget as HTMLElement).style.boxShadow = '';
              }}
            >
              <Stack gap="sm">
                <Group gap="sm" align="center">
                  <Text size="2rem" style={{ lineHeight: 1 }}>
                    {service.icon}
                  </Text>
                  <Text fw={700} size="md">
                    {service.name}
                  </Text>
                </Group>
                <Text size="sm" c="dimmed" lineClamp={2}>
                  {service.description}
                </Text>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      </Stack>
    </Box>
  );
}
