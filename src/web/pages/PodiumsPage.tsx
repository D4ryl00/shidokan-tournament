import { Alert, Button, Card, Group, Modal, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useBackupNow, useBackups, useIsOrganiser, usePodiums, useRestore } from '../api.js';
import { MirrorCopies } from '../components/MirrorPanels.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { HELP } from '../help.js';
import { PODIUM_TONES, podiumState } from '../podiums.js';
import { plural } from '../../domain/plural.js';
import { useEntrantInfo } from './BracketsPage.js';

export function PodiumsPage() {
  const { id = '' } = useParams();
  const { data } = usePodiums(id);
  const entrants = useEntrantInfo(id);
  // Sauvegardes : réservées à l'organisateur (un compte Table centrale ou Zone ne les voit pas).
  const organiser = useIsOrganiser();
  const { data: backups = [] } = useBackups(organiser);
  const backupNow = useBackupNow();
  const restore = useRestore();
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const name = (rid: string | null) => (rid ? `${entrants.get(rid)?.name ?? '?'} (${entrants.get(rid)?.club ?? ''})` : '—');
  const done = (data?.categories ?? []).filter((c) => c.complete).length;

  const total = data?.categories.length ?? 0;
  const exportButton = (path: string, label: string, testId?: string) => (
    <Button component="a" href={`/api/competitions/${id}/exports/${path}`} download variant="default" data-testid={testId}>{label}</Button>
  );
  return (
    <Stack gap="lg">
      <PageHeader title="Podiums" summary={total > 0 ? `${plural(done, 'catégorie terminée', 'catégories terminées')} sur ${total}` : undefined}
        actions={<>
          <Button component={Link} to={`/competitions/${id}/impression?resultats=1`} target="_blank" variant="default" data-testid="print-results">Feuilles de résultats</Button>
          <Button component={Link} to={`/competitions/${id}/impression/podiums`} target="_blank" data-testid="print-podiums">Imprimer les podiums</Button>
        </>} />
      <Group gap="lg" data-testid="exports">
        <Group gap="xs">
          <Text size="sm" c="dimmed">Résultats :</Text>
          <Button.Group>{exportButton('results.xlsx', '.xlsx', 'export-results-xlsx')}{exportButton('results.ods', '.ods')}</Button.Group>
        </Group>
        <Group gap="xs">
          <Text size="sm" c="dimmed">Podiums :</Text>
          <Button.Group>{exportButton('podiums.xlsx', '.xlsx', 'export-podiums-xlsx')}{exportButton('podiums.ods', '.ods')}</Button.Group>
        </Group>
      </Group>
      {total === 0 ? (
        <EmptyState title="Aucune catégorie à disputer" text="Les podiums apparaissent ici au fil des combats, catégorie par catégorie." />
      ) : (
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }}>
        {(data?.categories ?? []).map((c) => {
          const state = podiumState(c);
          return (
            <Card key={c.id} withBorder padding="md" data-testid="podium-card">
              <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs" gap="xs">
                <Text fw={600} size="sm">{c.label}</Text>
                <StatusBadge tone={PODIUM_TONES[state]}>{state}</StatusBadge>
              </Group>
              {c.complete ? (
                <Stack gap={4}>
                  <Text size="sm">🥇 {name(c.podium.first)}</Text>
                  <Text size="sm">🥈 {name(c.podium.second)}</Text>
                  {c.podium.thirds.map((t) => <Text key={t} size="sm">🥉 {name(t)}</Text>)}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">Podium connu à la fin de la catégorie.</Text>
              )}
            </Card>
          );
        })}
      </SimpleGrid>
      )}

      <SectionCard title={HELP['podiums.clubs'].title} help="podiums.clubs">
        {(data?.medals ?? []).length === 0 ? (
          <Text size="sm" c="dimmed">Aucune médaille pour l’instant.</Text>
        ) : (
          <Table>
            <Table.Thead><Table.Tr><Table.Th>Club</Table.Th><Table.Th ta="right">🥇 Or</Table.Th><Table.Th ta="right">🥈 Argent</Table.Th><Table.Th ta="right">🥉 Bronze</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {(data?.medals ?? []).map((m) => (
                <Table.Tr key={m.clubId} data-testid="medal-row">
                  <Table.Td fw={500}>{m.club}</Table.Td>
                  <Table.Td ta="right" className="num">{m.gold}</Table.Td><Table.Td ta="right" className="num">{m.silver}</Table.Td>
                  <Table.Td ta="right" className="num">{m.bronze}</Table.Td><Table.Td ta="right" className="num" fw={700}>{m.gold + m.silver + m.bronze}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </SectionCard>

      {organiser && (
      <SectionCard title={HELP['podiums.sauvegardes'].title} help="podiums.sauvegardes"
        actions={
          <Button data-testid="backup-now" loading={backupNow.isPending}
            onClick={() => backupNow.mutate(undefined, { onSuccess: () => notifications.show({ color: 'green', message: 'Sauvegarde effectuée.' }) })}>
            Sauvegarder maintenant
          </Button>
        }>
        <Group gap="sm">
          <Button component="a" href="/api/backup.sqlite" download variant="default">Télécharger la base complète</Button>
          <Button variant="subtle" color="red" component="label">
            Restaurer une sauvegarde…
            <input type="file" accept=".sqlite" hidden data-testid="restore-file" onChange={(e) => setRestoreFile(e.currentTarget.files?.[0] ?? null)} />
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
        <MirrorCopies />
      </SectionCard>
      )}
      <ApiErrorAlert error={restore.error ?? backupNow.error} />
      <Modal opened={restoreFile !== null} onClose={() => setRestoreFile(null)} title="Restaurer cette sauvegarde ?">
        <Stack>
          <Alert color="red">Toutes les données actuelles seront remplacées par celles de « {restoreFile?.name} ». Une sauvegarde de l’état actuel est faite juste avant.</Alert>
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
