import { Alert, Button, Group, Modal, Stack, Table } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useBackupNow, useBackups, useIsOrganiser, useRestore } from '../api.js';
import { HELP } from '../help.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { SectionCard } from './ui/SectionCard.js';

/** Sauvegardes de toute l'installation : réservées à l'organisateur (un compte Table centrale ou Zone ne les voit pas). */
export function BackupsCard() {
  const organiser = useIsOrganiser();
  const { data: backups = [] } = useBackups(organiser);
  const backupNow = useBackupNow();
  const restore = useRestore();
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  if (!organiser) return null;
  return (
    <SectionCard id="sauvegardes" title={HELP['parametres.sauvegardes'].title} help="parametres.sauvegardes"
      actions={
        <Button data-testid="backup-now" loading={backupNow.isPending}
          onClick={() => backupNow.mutate(undefined, { onSuccess: () => notifications.show({ color: 'green', message: 'Sauvegarde effectuée.' }) })}>
          Sauvegarder maintenant
        </Button>
      }>
      <Group gap="sm">
        <Button component="a" href="/api/backup.sqlite" download variant="default">Télécharger une sauvegarde complète</Button>
        <Button variant="subtle" color="red" component="label">
          Restaurer une sauvegarde…
          <input type="file" accept=".sqlite" hidden data-testid="restore-file" onChange={(e) => { setRestoreFile(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ''; }} />
        </Button>
      </Group>
      {backups.length > 0 && (
        <Table maw={640}>
          <Table.Tbody>
            {backups.slice(0, 10).map((b) => (
              <Table.Tr key={b.name} data-testid="backup-row">
                <Table.Td className="num">{new Date(b.createdAt).toLocaleString('fr-FR')}</Table.Td>
                <Table.Td ta="right" className="num">{Math.round(b.size / 1024).toLocaleString('fr-FR')} Ko</Table.Td>
                <Table.Td ta="right"><Button component="a" href={`/api/backups/${b.name}`} download size="compact-sm" variant="subtle">Télécharger</Button></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <ApiErrorAlert error={restore.error ?? backupNow.error} />
      <Modal opened={restoreFile !== null} onClose={() => setRestoreFile(null)} title="Restaurer cette sauvegarde ?">
        <Stack>
          <Alert color="red">Toutes les données actuelles (compétitions, comptes, réglages, pièces jointes) seront remplacées par celles de « {restoreFile?.name} ». Une sauvegarde de l’état actuel est faite juste avant.</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRestoreFile(null)}>Annuler</Button>
            <Button color="red" data-testid="restore-confirm" loading={restore.isPending}
              onClick={() => restoreFile && restore.mutate(restoreFile, {
                onSuccess: () => { setRestoreFile(null); notifications.show({ color: 'green', message: 'Sauvegarde restaurée.' }); },
                onError: () => setRestoreFile(null),
              })}>
              Restaurer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </SectionCard>
  );
}
