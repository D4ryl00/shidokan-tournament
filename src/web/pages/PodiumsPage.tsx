import { Alert, Anchor, Badge, Button, Card, Group, Modal, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useBackupNow, useBackups, usePodiums, useRestore } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionHeader } from '../components/Help.js';
import { useEntrantInfo } from './BracketsPage.js';

export function PodiumsPage() {
  const { id = '' } = useParams();
  const { data } = usePodiums(id);
  const entrants = useEntrantInfo(id);
  const { data: backups = [] } = useBackups();
  const backupNow = useBackupNow();
  const restore = useRestore();
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const name = (rid: string | null) => (rid ? `${entrants.get(rid)?.name ?? '?'} (${entrants.get(rid)?.club ?? ''})` : '—');
  const done = (data?.categories ?? []).filter((c) => c.complete).length;

  return (
    <Stack>
      <Group>
        <Button component={Link} to={`/competitions/${id}/impression/podiums`} target="_blank" data-testid="print-podiums">Imprimer les podiums</Button>
        <Button component={Link} to={`/competitions/${id}/impression?resultats=1`} target="_blank" variant="light" data-testid="print-results">Feuilles de résultats</Button>
        <Anchor href={`/api/competitions/${id}/exports/results.xlsx`} download data-testid="export-results-xlsx">Résultats .xlsx</Anchor>
        <Anchor href={`/api/competitions/${id}/exports/results.ods`} download>Résultats .ods</Anchor>
        <Anchor href={`/api/competitions/${id}/exports/podiums.xlsx`} download data-testid="export-podiums-xlsx">Podiums .xlsx</Anchor>
        <Anchor href={`/api/competitions/${id}/exports/podiums.ods`} download>Podiums .ods</Anchor>
      </Group>
      <Text size="sm" c="dimmed">{done} catégorie(s) terminée(s) sur {data?.categories.length ?? 0}.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {(data?.categories ?? []).map((c) => (
          <Card key={c.id} withBorder data-testid="podium-card">
            <Group justify="space-between" mb={4}>
              <Text fw={600} size="sm">{c.label}</Text>
              <Badge color={c.complete ? 'green' : 'gray'} variant="light">{c.complete ? 'Terminée' : 'En cours'}</Badge>
            </Group>
            {c.complete ? (
              <Stack gap={2}>
                <Text size="sm">🥇 {name(c.podium.first)}</Text>
                <Text size="sm">🥈 {name(c.podium.second)}</Text>
                {c.podium.thirds.map((t) => <Text key={t} size="sm">🥉 {name(t)}</Text>)}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">Podium connu à la fin de la catégorie.</Text>
            )}
          </Card>
        ))}
      </SimpleGrid>

      <SectionHeader topic="podiums.clubs" />
      <Table striped>
        <Table.Thead><Table.Tr><Table.Th>Club</Table.Th><Table.Th>🥇 Or</Table.Th><Table.Th>🥈 Argent</Table.Th><Table.Th>🥉 Bronze</Table.Th><Table.Th>Total</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(data?.medals ?? []).map((m) => (
            <Table.Tr key={m.clubId} data-testid="medal-row">
              <Table.Td>{m.club}</Table.Td><Table.Td>{m.gold}</Table.Td><Table.Td>{m.silver}</Table.Td><Table.Td>{m.bronze}</Table.Td><Table.Td>{m.gold + m.silver + m.bronze}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <SectionHeader topic="podiums.sauvegardes" />
      <Group>
        <Button variant="light" data-testid="backup-now" loading={backupNow.isPending}
          onClick={() => backupNow.mutate(undefined, { onSuccess: () => notifications.show({ color: 'green', message: 'Sauvegarde effectuée.' }) })}>
          Sauvegarder maintenant
        </Button>
        <Anchor href="/api/backup.sqlite" download>Télécharger la base complète</Anchor>
        <Button variant="subtle" color="red" component="label">
          Restaurer une sauvegarde…
          <input type="file" accept=".sqlite" hidden data-testid="restore-file" onChange={(e) => setRestoreFile(e.currentTarget.files?.[0] ?? null)} />
        </Button>
      </Group>
      <Table>
        <Table.Tbody>
          {backups.slice(0, 10).map((b) => (
            <Table.Tr key={b.name} data-testid="backup-row">
              <Table.Td>{new Date(b.createdAt).toLocaleString('fr-FR')}</Table.Td>
              <Table.Td>{Math.round(b.size / 1024)} Ko</Table.Td>
              <Table.Td><Anchor href={`/api/backups/${b.name}`} download>Télécharger</Anchor></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <ApiErrorAlert error={restore.error ?? backupNow.error} />
      <Modal opened={restoreFile !== null} onClose={() => setRestoreFile(null)} title="Restaurer cette sauvegarde ?">
        <Stack>
          <Alert color="red">Toutes les données actuelles seront remplacées par celles de « {restoreFile?.name} ». Une sauvegarde de l'état actuel est faite juste avant.</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRestoreFile(null)}>Annuler</Button>
            <Button color="red" data-testid="restore-confirm" loading={restore.isPending}
              onClick={() => restoreFile && restore.mutate(restoreFile, { onSuccess: () => { setRestoreFile(null); notifications.show({ color: 'green', message: 'Sauvegarde restaurée.' }); } })}>
              Restaurer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
