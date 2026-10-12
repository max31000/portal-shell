import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import { errorText } from './format';

export function notifySuccess(message: string) {
  notifications.show({ message, color: 'green', icon: <IconCheck size={16} />, autoClose: 3000 });
}

export function notifyError(error: unknown, prefix?: string) {
  const text = errorText(error);
  notifications.show({
    title: prefix,
    message: text,
    color: 'red',
    icon: <IconX size={16} />,
    autoClose: 5000,
  });
}

/**
 * Runs a mutation with a success / failure notification. Resolves `true` on success; never throws.
 */
export async function mutate(run: () => Promise<unknown>, success: string, failure: string): Promise<boolean> {
  try {
    await run();
    notifySuccess(success);
    return true;
  } catch (error) {
    notifyError(error, failure);
    return false;
  }
}

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Red confirm button (destructive). Default true. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * Promise-based confirm dialog: `const [dialog, confirm] = useConfirm(); if (await confirm({...})) …`.
 * Render `dialog` once in the component.
 */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        const next = { ...options, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  const close = (ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  };

  const dialog = (
    <Modal opened={pending !== null} onClose={() => close(false)} title={pending?.title} size="sm" zIndex={350}>
      <Stack gap="lg">
        <Text size="sm" c="var(--mvv-text-2)">
          {pending?.message}
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => close(false)}>
            Отмена
          </Button>
          <Button color={pending?.danger === false ? undefined : 'red'} onClick={() => close(true)} data-autofocus>
            {pending?.confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  return [dialog, confirm];
}
