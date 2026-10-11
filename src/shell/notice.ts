import { notifications } from '@mantine/notifications';

/** Short, de-duplicated toast (same `id` while visible = shown once). */
export function showNotice(id: string, message: string, tone: 'info' | 'error' = 'info') {
  notifications.show({
    id,
    message,
    color: tone === 'error' ? 'red' : 'zinc',
    autoClose: 3500,
    withCloseButton: false,
    radius: 'md',
  });
}

export const NO_ACCESS_NOTICE = 'Нет доступа к сервису';
