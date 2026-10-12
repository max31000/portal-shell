import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  CopyButton,
  Group,
  Modal,
  NumberInput,
  Select,
  Skeleton,
  Stack,
  Table,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { EmptyState, ErrorState, Section } from '@mvv42/kit';
import { IconCheck, IconCopy, IconPlus, IconTicket, IconTrash } from '@tabler/icons-react';
import type { Service } from '../types';
import { adminApi, inviteLink, type AdminApp, type AdminInvite, type CreatedInvite } from './api';
import { AppLabel } from './AppLabel';
import { INVITE_STATUS, formatDate, formatDateTime } from './format';
import { mutate, notifyError, useConfirm } from './feedback';
import { useResource } from './useResource';
import classes from './Admin.module.css';

const EXPIRY_OPTIONS = [
  { value: '24', label: '1 день' },
  { value: '72', label: '3 дня' },
  { value: '168', label: '7 дней' },
  { value: '720', label: '30 дней' },
  { value: '2160', label: '90 дней' },
  { value: '8760', label: '1 год' },
];

async function loadInvites() {
  const [invites, apps] = await Promise.all([adminApi.invites(), adminApi.apps()]);
  return { invites, apps };
}

export function InvitesTab({ services }: { services: Service[] }) {
  const { data, error, loading, reload } = useResource(loadInvites);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [dialog, confirm] = useConfirm();

  if (error && !data) return <ErrorState title="Не удалось загрузить инвайты" error={error} onRetry={() => void reload()} />;

  const apps = data?.apps ?? [];
  const invites = data?.invites ?? [];
  const appName = (id: string) => apps.find((a) => a.id === id)?.name ?? id;

  async function remove(invite: AdminInvite) {
    const ok = await confirm({
      title: 'Удалить инвайт?',
      message: `Ссылка на «${appName(invite.appId)}» перестанет работать. Уже выданные гранты останутся.`,
      confirmLabel: 'Удалить',
    });
    if (!ok) return;
    setBusy(invite.id);
    await mutate(() => adminApi.deleteInvite(invite.id), 'Инвайт удалён', 'Не удалось удалить инвайт');
    await reload();
    setBusy(null);
  }

  const createButton = (
    <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)} disabled={!data || apps.length === 0}>
      Создать инвайт
    </Button>
  );

  return (
    <>
      {dialog}
      <Section
        title="Инвайты"
        description="Ссылка-приглашение выдаёт грант на сервис тому, кто по ней войдёт."
        padding="none"
        actions={createButton}
      >
        {loading ? (
          <div style={{ padding: 'var(--mvv-sp-5)' }}>
            <Skeleton height={14} mb="sm" />
            <Skeleton height={14} mb="sm" />
            <Skeleton height={14} width="60%" />
          </div>
        ) : invites.length === 0 ? (
          <EmptyState
            icon={<IconTicket />}
            title="Инвайтов нет"
            description="Создайте приглашение, чтобы открыть сервис с режимом «по приглашению» новому человеку."
          />
        ) : (
          <Table className={classes.table}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Сервис</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th className={classes.num}>Использовано</Table.Th>
                <Table.Th>Действует до</Table.Th>
                <Table.Th>Создан</Table.Th>
                <Table.Th aria-label="Действия" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {invites.map((inv) => (
                <Table.Tr key={inv.id}>
                  <Table.Td>
                    <AppLabel appId={inv.appId} name={appName(inv.appId)} services={services} size={24} />
                  </Table.Td>
                  <Table.Td>
                    <Badge color={INVITE_STATUS[inv.status]?.color ?? 'gray'}>
                      {INVITE_STATUS[inv.status]?.label ?? inv.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td className={classes.num}>
                    {inv.uses} / {inv.maxUses}
                  </Table.Td>
                  <Table.Td title={formatDateTime(inv.expiresAt, 'бессрочно')}>{formatDate(inv.expiresAt, 'бессрочно')}</Table.Td>
                  <Table.Td className={classes.muted} title={formatDateTime(inv.createdAt)}>
                    {formatDate(inv.createdAt)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Tooltip label="Удалить">
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        aria-label={`Удалить инвайт #${inv.id}`}
                        loading={busy === inv.id}
                        disabled={busy !== null}
                        onClick={() => void remove(inv)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Section>

      <CreateInviteModal
        opened={createOpen}
        apps={apps}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void reload()}
      />
    </>
  );
}

interface CreateInviteModalProps {
  opened: boolean;
  apps: AdminApp[];
  onClose: () => void;
  onCreated: () => void;
}

function defaultApp(apps: AdminApp[]): string | null {
  return (apps.find((a) => a.access === 'invite') ?? apps.find((a) => a.access === 'admin') ?? apps[0])?.id ?? null;
}

/** Create → show the link once (the server keeps only a hash of the code). */
export function CreateInviteModal({ opened, apps, onClose, onCreated }: CreateInviteModalProps) {
  const compact = useMediaQuery('(max-width: 640px)');
  const [appId, setAppId] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState<number | string>(1);
  const [expiry, setExpiry] = useState<string>('168');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  // Each opening starts from a clean form.
  const [wasOpened, setWasOpened] = useState(opened);
  if (opened !== wasOpened) {
    setWasOpened(opened);
    if (opened) {
      setAppId(defaultApp(apps));
      setMaxUses(1);
      setExpiry('168');
      setCreated(null);
    }
  }

  const uses = typeof maxUses === 'number' ? maxUses : Number.parseInt(maxUses, 10);
  const valid = appId !== null && Number.isInteger(uses) && uses >= 1 && uses <= 1000;

  async function submit() {
    if (!valid || appId === null) return;
    setSaving(true);
    try {
      const result = await adminApi.createInvite({ appId, maxUses: uses, expiresInHours: Number(expiry) });
      setCreated(result);
      onCreated();
    } catch (e) {
      notifyError(e, 'Не удалось создать инвайт');
    } finally {
      setSaving(false);
    }
  }

  const link = created ? inviteLink(created.code) : '';
  const createdApp = created ? (apps.find((a) => a.id === created.appId)?.name ?? created.appId) : '';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={created ? 'Инвайт создан' : 'Новый инвайт'}
      size={compact ? '100%' : 'md'}
      fullScreen={compact}
      zIndex={300}
    >
      {created ? (
        <Stack gap="md">
          <Alert color="orange" title="Ссылка показывается один раз">
            Скопируйте её сейчас — сервер хранит только хеш кода, восстановить ссылку нельзя.
          </Alert>
          <div className={classes.link}>
            <span className={classes.linkText} data-testid="invite-link">
              {link}
            </span>
            <CopyButton value={link} timeout={2000}>
              {({ copied, copy }) => (
                <Button
                  size="xs"
                  variant={copied ? 'light' : 'default'}
                  color={copied ? 'green' : undefined}
                  leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  onClick={copy}
                >
                  {copied ? 'Скопировано' : 'Копировать'}
                </Button>
              )}
            </CopyButton>
          </div>
          <div className={classes.rowSub}>
            {createdApp} · {created.maxUses === 1 ? 'одно использование' : `до ${created.maxUses} использований`} · до{' '}
            {formatDateTime(created.expiresAt)}
          </div>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Готово
            </Button>
          </Group>
        </Stack>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Stack gap="md">
            <Select
              label="Сервис"
              data={apps.map((a) => ({ value: a.id, label: a.name }))}
              value={appId}
              onChange={setAppId}
              allowDeselect={false}
              required
              comboboxProps={{ zIndex: 400 }}
            />
            <Group grow align="flex-start">
              <NumberInput
                label="Использований"
                min={1}
                max={1000}
                value={maxUses}
                onChange={setMaxUses}
                allowDecimal={false}
                allowNegative={false}
                error={valid || appId === null ? undefined : 'От 1 до 1000'}
              />
              <Select
                label="Действует"
                data={EXPIRY_OPTIONS}
                value={expiry}
                onChange={(v) => v && setExpiry(v)}
                allowDeselect={false}
                comboboxProps={{ zIndex: 400 }}
              />
            </Group>
            <Group justify="flex-end" gap="sm" mt="xs">
              <Button variant="default" onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" loading={saving} disabled={!valid}>
                Создать
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
