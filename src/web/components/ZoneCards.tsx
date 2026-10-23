import { Alert, Badge, Button, Card, FileButton, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useDecideZoneCard, useImportZoneJournal, useZoneCards, type JournalReport } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
/** Compte rendu d'un journal reçu : « 12 saisies reçues de Tatami 2 : 9 appliquées, 1 déjà présente, 2 à trancher ». */
export function journalReportText(zoneName: string, r: JournalReport): string {
  const parts = [plural(r.applied, 'appliquée', 'appliquées'), plural(r.present, 'déjà présente', 'déjà présentes'), `${r.conflicts + r.waiting} à trancher`];
  if (r.alreadyReceived > 0) parts.push(plural(r.alreadyReceived, 'déjà reçue avant', 'déjà reçues avant'));
  return `${plural(r.received, 'saisie reçue', 'saisies reçues')} de ${zoneName} : ${parts.join(', ')}`;
}

/** « Importer un journal de zone (fichier) » : clé USB venue d'un portable de zone. */
function ImportJournalButton({ competitionId }: { competitionId: string }) {
  const imp = useImportZoneJournal(competitionId);
  const onFile = async (file: File | null) => {
    if (!file) return;
    let journal: { zoneName?: string };
    try {
      journal = JSON.parse(await file.text()) as { zoneName?: string };
    } catch {
      notifications.show({ color: 'red', message: 'Ce fichier n’est pas un journal de zone.' });
      return;
    }
    imp.mutate(journal, { onSuccess: (r) => notifications.show({ color: r.conflicts + r.waiting > 0 ? 'orange' : 'green', message: journalReportText(journal.zoneName ?? 'la zone', r), autoClose: false }) });
  };
  return (
    <Stack gap={4}>
      <FileButton onChange={onFile} accept="application/json,.json">
        {(props) => <Button variant="default" size="xs" data-testid="zone-journal-import" loading={imp.isPending} {...props}>Importer un journal de zone (fichier)</Button>}
      </FileButton>
      <ApiErrorAlert error={imp.error} />
    </Stack>
  );
}

/** Section « À trancher » de l'onglet Combats (postes Organisation et Table centrale) : saisies de zones autonomes en conflit. */
export function ZoneCards({ competitionId }: { competitionId: string }) {
  const { data: cards = [] } = useZoneCards(competitionId);
  const decide = useDecideZoneCard(competitionId);
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        {cards.length > 0 ? <Title order={5}>À trancher ({cards.length})</Title> : <span />}
        <ImportJournalButton competitionId={competitionId} />
      </Group>
      {cards.length > 0 && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          {cards.map((c) => (
            <Card key={c.id} withBorder data-testid="zone-card-item" style={{ borderColor: 'var(--mantine-color-orange-5)' }}>
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={600}>{c.categoryLabel} — {c.target}</Text>
                  <Badge size="xs" color={c.status === 'conflict' ? 'orange' : 'gray'}>{c.status === 'conflict' ? 'conflit' : 'en attente'}</Badge>
                </Group>
                {c.status === 'waiting' ? (
                  <Text size="xs" c="dimmed">Saisie de {c.zoneName} faite après une saisie à trancher de la même catégorie : elle s’appliquera toute seule si elle ne dépend plus d’un conflit.</Text>
                ) : (
                  c.reason && <Text size="xs" c="dimmed">{c.reason}</Text>
                )}
                <SimpleGrid cols={2} spacing="xs">
                  <Alert p="xs" color="blue" title={`Saisi par ${c.zoneName}`}><Text size="sm" data-testid="zone-card-zone">{c.zone}</Text></Alert>
                  <Alert p="xs" color="gray" title="Sur le PC principal"><Text size="sm" data-testid="zone-card-pc">{c.pc}</Text></Alert>
                </SimpleGrid>
                {c.status === 'conflict' && !c.canKeepZone && <Text size="xs" c="orange">Les combattants de ce combat ont changé : la saisie de la zone ne peut plus être gardée.</Text>}
                <Group justify="flex-end">
                  {c.status === 'conflict' && c.canKeepZone && (
                    <Button size="xs" variant="light" data-testid="zone-keep-zone" loading={decide.isPending && decide.variables?.entryId === c.id && decide.variables.keep === 'zone'}
                      onClick={() => decide.mutate({ entryId: c.id, keep: 'zone' })}>Garder celui de la zone</Button>
                  )}
                  <Button size="xs" variant="default" data-testid="zone-keep-pc" loading={decide.isPending && decide.variables?.entryId === c.id && decide.variables.keep === 'pc'}
                    onClick={() => decide.mutate({ entryId: c.id, keep: 'pc' })}>Garder celui du PC</Button>
                </Group>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}
      <ApiErrorAlert error={decide.error} />
    </Stack>
  );
}
