import { useState, useEffect, useRef } from 'react';
import { Box, Center, Loader, Text, Button, Stack } from '@mantine/core';
import type { Service } from '../types';

const TIMEOUT_MS = 15_000;

interface ServiceFrameProps {
  service: Service;
}

export function ServiceFrame({ service }: ServiceFrameProps) {
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state on service change
  useEffect(() => {
    setLoading(true);
    setTimedOut(false);

    timerRef.current = setTimeout(() => {
      setTimedOut(true);
      setLoading(false);
    }, TIMEOUT_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [service.id]);

  function handleLoad() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLoading(false);
    setTimedOut(false);
  }

  return (
    <Box style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* iframe — always in DOM so it starts loading */}
      <iframe
        key={service.id}
        src={service.path}
        title={service.name}
        onLoad={handleLoad}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: timedOut ? 'none' : 'block',
        }}
      />

      {/* Loading overlay */}
      {loading && !timedOut && (
        <Center
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--mantine-color-body)',
            zIndex: 10,
          }}
        >
          <Stack align="center" gap="md">
            <Loader size="lg" color={service.color} />
            <Text c="dimmed" size="sm">
              Загрузка {service.name}…
            </Text>
          </Stack>
        </Center>
      )}

      {/* Timeout message */}
      {timedOut && (
        <Center style={{ height: '100%' }}>
          <Stack align="center" gap="md">
            <Text size="xl">{service.icon}</Text>
            <Text fw={500}>Сервис не отвечает</Text>
            <Text c="dimmed" size="sm" ta="center" maw={320}>
              {service.name} не загрузился за {TIMEOUT_MS / 1000} секунд.
            </Text>
            <Button
              variant="light"
              color={service.color}
              onClick={() => window.open(service.path, '_blank')}
            >
              Открыть напрямую
            </Button>
          </Stack>
        </Center>
      )}
    </Box>
  );
}
