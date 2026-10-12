import { Button } from '@mantine/core';
import { EmptyState } from '@mvv42/kit';
import { IconMapOff } from '@tabler/icons-react';
import classes from '../admin/Admin.module.css';

/** 404 view of the shell (unknown route, or `#/admin` for anyone but the owner). */
export function NotFound({ onHome }: { onHome: () => void }) {
  return (
    <div className={classes.center}>
      <EmptyState
        icon={<IconMapOff />}
        title="Страница не найдена"
        description="Такой страницы нет или она вам недоступна."
        action={
          <Button variant="default" onClick={onHome}>
            На главную
          </Button>
        }
        data-testid="not-found"
      />
    </div>
  );
}
