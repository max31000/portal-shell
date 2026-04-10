import { useState, useEffect, useRef } from 'react';
import { Box, Center, Loader, Text, Button, Stack } from '@mantine/core';
import type { Service } from '../types';

const TIMEOUT_MS = 15_000;

interface ServiceFrameProps {
  service: Service;
  /**
   * Initial path inside the service (relative to service root).
   * E.g. "/operations" or "/" (default).
   * Combined with service.path to build the iframe src.
   */
  initialPath?: string;
}

/**
 * Builds the full src URL for the iframe.
 * service.path = "/cashpulse/" (always has trailing slash)
 * initialPath  = "/operations" or "/"
 * result       = "/cashpulse/operations" or "/cashpulse/"
 */
function buildSrc(servicePath: string, initialPath: string): string {
  const base = servicePath.replace(/\/$/, ''); // "/cashpulse"
  const path = initialPath === '/' ? '/' : initialPath;
  return base + path; // "/cashpulse/operations" or "/cashpulse/"
}

export function ServiceFrame({ service, initialPath = '/' }: ServiceFrameProps) {
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const src = buildSrc(service.path, initialPath);

  // Reset loading state when service changes (synchronous update during render,
  // per React docs: react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [prevServiceId, setPrevServiceId] = useState(service.id);
  if (service.id !== prevServiceId) {
    setPrevServiceId(service.id);
    setLoading(true);
    setTimedOut(false);
  }

  // Set up load timeout
  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
      setLoading(false);
    }, TIMEOUT_MS);
    timerRef.current = timer;
    return () => clearTimeout(timer);
  }, [service.id]);

  function handleLoad() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLoading(false);
    setTimedOut(false);
  }

  return (
    <Box style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* key ensures full remount on service change */}
      <iframe
        key={service.id}
        src={src}
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
              onClick={() => window.open(src, '_blank')}
            >
              Открыть напрямую
            </Button>
          </Stack>
        </Center>
      )}
    </Box>
  );
}
