import { Alert, Button, Group, Modal, NumberInput, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAuthMe, useMirror, useMirrorCopies, useRestoreMirrorCopy, useSetMirror } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** Réglages de l'application (PC de secours) : adresse du PC principal et fréquence des copies. */
export function MirrorSettingsCard() {
  const { data: me } = useAuthMe();
  const local = me?.role === 'local';
  const { data } = useMirror(local);
  const set = useSetMirror();
  const [url, setUrl] = useState<string | null>(null);
  const [intervalMin, setIntervalMin] = useState<number | null>(null);
  if (!local || !data) return null;
  const shownUrl = url ?? data.url ?? '';
  const shownInterval = intervalMin ?? data.intervalMin;
  return (
    <Stack>
      <Text size="sm">Sur un second PC, gardez une copie récente du PC principal : en cas de panne, restaurez-la ici (section Sauvegardes), puis ouvrez l’application de ce PC sur les autres postes.</Text>
      <Group align="end">
        <TextInput data-testid="mirror-url" label="Adresse du PC principal" placeholder="http://192.168.1.10:3000" value={shownUrl} onChange={(e) => setUrl(e.currentTarget.value)} w={300} />
        <NumberInput label="Toutes les (minutes)" min={1} max={60} value={shownInterval} onChange={(v) => setIntervalMin(Number(v) || 5)} w={140} />
        <Button data-testid="mirror-save" loading={set.isPending} onClick={() => set.mutate({ url: shownUrl.trim() || null, intervalMin: shownInterval }, { onSuccess: () => notifications.show({ color: 'green', message: shownUrl.trim() ? 'Copie de secours réglée.' : 'Copie de secours arrêtée.' }) })}>
          Enregistrer
        </Button>
      </Group>
      {data.url && (
        <Text size="sm" c={data.lastError ? 'red' : 'dimmed'} data-testid="mirror-status">
          Dernière copie réussie : {when(data.lastSuccessAt)}{data.lastError ? ` — dernier essai en erreur : ${data.lastError}` : ''}
        </Text>
      )}
      <ApiErrorAlert error={set.error} />
    </Stack>
  );
}

/** Section Sauvegardes : copies du PC principal, restaurables. */
export function MirrorCopies() {
  const { data: me } = useAuthMe();
  const local = me?.role === 'local';
  const { data: mirror } = useMirror(local);
  const { data: copies = [] } = useMirrorCopies(local);
  const restore = useRestoreMirrorCopy();
  const [confirm, setConfirm] = useState<string | null>(null);
  // Visibles même sans adresse réglée (arrêtée après une restauration) : on peut encore restaurer une autre copie.
  if (!local || (!mirror?.url && copies.length === 0)) return null;
  return (
    <Stack gap="xs">
      <Text fw={600}>Copies du PC principal{mirror?.url ? ` (${mirror.url})` : ''}</Text>
      {copies.length === 0 && <Text size="sm" c="dimmed">Aucune copie pour l’instant.</Text>}
      {copies.length > 0 && (
        <Table maw={560}>
          <Table.Tbody>
            {copies.slice(0, 10).map((c) => (
              <Table.Tr key={c.name} data-testid="mirror-copy">
                <Table.Td className="num">{when(c.createdAt)}</Table.Td>
                <Table.Td className="num" ta="right">{Math.round(c.size / 1024).toLocaleString('fr-FR')} Ko</Table.Td>
                <Table.Td ta="right"><Button size="compact-sm" variant="subtle" color="red" onClick={() => setConfirm(c.name)}>Restaurer</Button></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <ApiErrorAlert error={restore.error} />
      <Modal opened={confirm !== null} onClose={() => setConfirm(null)} title="Restaurer la copie du PC principal ?">
        <Stack>
          <Alert color="red">Toutes les données de ce PC seront remplacées par la copie du PC principal ; ce PC en devient le PC principal. Une sauvegarde de l’état actuel est faite juste avant.</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>Annuler</Button>
            <Button color="red" loading={restore.isPending} onClick={() => confirm && restore.mutate(confirm, { onSuccess: () => { setConfirm(null); notifications.show({ color: 'green', message: 'Copie restaurée : ce PC a pris le relais.' }); } })}>
              Restaurer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
