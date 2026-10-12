import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Badge, Button, Skeleton, Table, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { EmptyState, ErrorState, Section } from '@mvv42/kit';
import { IconHistory, IconRefresh } from '@tabler/icons-react';
import { adminApi, type LoginEvent } from './api';
import { LOGIN_RESULT, describeUserAgent, formatDateTime } from './format';
import { notifyError } from './feedback';
import classes from './Admin.module.css';

const LOGINS_PAGE_SIZE = 50;

interface State {
  items: LoginEvent[];
  nextBefore: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
}

/** Login journal, newest first, paged with `before = nextBefore`. */
export function LoginsTab() {
  const [state, setState] = useState<State>({
    items: [],
    nextBefore: null,
    loading: true,
    loadingMore: false,
    error: null,
  });
  const seq = useRef(0);
  const compact = useMediaQuery('(max-width: 640px)');

  const loadFirst = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: s.items.length === 0, error: null }));
    try {
      const page = await adminApi.logins({ limit: LOGINS_PAGE_SIZE });
      if (id === seq.current)
        setState({ items: page.items, nextBefore: page.nextBefore, loading: false, loadingMore: false, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  async function loadMore() {
    if (state.nextBefore === null) return;
    const id = ++seq.current;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const page = await adminApi.logins({ limit: LOGINS_PAGE_SIZE, before: state.nextBefore });
      if (id === seq.current) {
        setState((s) => ({
          ...s,
          items: [...s.items, ...page.items.filter((e) => !s.items.some((x) => x.id === e.id))],
          nextBefore: page.nextBefore,
          loadingMore: false,
        }));
      }
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, loadingMore: false }));
      notifyError(error, 'Не удалось загрузить журнал');
    }
  }

  if (state.error && state.items.length === 0) {
    return <ErrorState title="Не удалось загрузить журнал" error={state.error} onRetry={() => void loadFirst()} />;
  }

  return (
    <Section
      title="Журнал входов"
      description="Каждая попытка входа через Telegram: успешные, отклонённые и с неверной подписью."
      padding="none"
      actions={
        <Tooltip label="Обновить">
          <ActionIcon variant="default" size="lg" aria-label="Обновить журнал" onClick={() => void loadFirst()}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      }
    >
      {state.loading ? (
        <div style={{ padding: 'var(--mvv-sp-5)' }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={14} mb="sm" width={i === 3 ? '60%' : undefined} />
          ))}
        </div>
      ) : state.items.length === 0 ? (
        <EmptyState icon={<IconHistory />} title="Журнал пуст" description="Здесь появятся попытки входа." />
      ) : (
        <>
          {compact ? (
            <ul className={classes.list}>
              {state.items.map((e) => (
                <li key={e.id} className={`${classes.listItem} ${classes.listRow}`}>
                  <span className={classes.listMain}>
                    <span className={classes.whoText}>
                      <span className={classes.whoName}>
                        {e.userName ?? (e.telegramId ? 'Удалённый пользователь' : 'Не проверен')}
                      </span>
                      <span className={classes.whoSub}>
                        {formatDateTime(e.at)} · <span className={classes.mono}>{e.ip ?? '—'}</span> ·{' '}
                        {describeUserAgent(e.userAgent)}
                      </span>
                    </span>
                  </span>
                  <Badge color={LOGIN_RESULT[e.result]?.color ?? 'gray'}>
                    {LOGIN_RESULT[e.result]?.label ?? e.result}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Table className={classes.table}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Время</Table.Th>
                  <Table.Th>Пользователь</Table.Th>
                  <Table.Th>Результат</Table.Th>
                  <Table.Th>IP</Table.Th>
                  <Table.Th>Браузер</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {state.items.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>{formatDateTime(e.at)}</Table.Td>
                    <Table.Td>
                      {e.userName || e.telegramId ? (
                        <span className={classes.whoText}>
                          <span className={classes.whoName}>{e.userName ?? 'Удалённый пользователь'}</span>
                          {e.telegramId !== null && (
                            <span className={`${classes.whoSub} ${classes.mono}`}>tg {e.telegramId}</span>
                          )}
                        </span>
                      ) : (
                        <span className={classes.muted}>не проверен</span>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge color={LOGIN_RESULT[e.result]?.color ?? 'gray'}>
                        {LOGIN_RESULT[e.result]?.label ?? e.result}
                      </Badge>
                    </Table.Td>
                    <Table.Td className={classes.mono}>{e.ip ?? '—'}</Table.Td>
                    <Table.Td title={e.userAgent ?? undefined}>{describeUserAgent(e.userAgent)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {state.nextBefore !== null && (
            <div className={classes.more}>
              <Button variant="default" loading={state.loadingMore} onClick={() => void loadMore()}>
                Показать ещё
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
