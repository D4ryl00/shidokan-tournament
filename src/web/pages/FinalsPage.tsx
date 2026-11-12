import { Alert, Box, Button, Card, Group, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core';
import { Link, useParams } from 'react-router';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { plural } from '../../domain/plural.js';
import { useCategories, useFinals, useSetCategoryFinals, useSetFinalsZone, useZones, type FinalsRow, type FinalsView, type FinalsWhen, type FinalsWhere } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { useSelectedWave } from '../useSelectedWave.js';

const WHEN_OPTIONS: { value: FinalsWhen; label: string }[] = [{ value: 'ready', label: 'Dès que finie' }, { value: 'end', label: 'Fin de session' }];

/** Ce que joue une zone pour la session : « Tatami 3 : 14 passages, puis 1 finale dès que prête, puis 2 finales en fin de session. » */
function summaryLine(name: string, s: FinalsView['summary'][number]): string {
  const parts = [
    s.ownPassages > 0 ? plural(s.ownPassages, 'passage') : null,
    s.ready > 0 ? `${plural(s.ready, 'finale')} dès que ${s.ready > 1 ? 'prêtes' : 'prête'}` : null,
    s.end > 0 ? `${plural(s.end, 'finale')} en fin de session` : null,
  ].filter((p): p is string => p !== null);
  return `${name} : ${parts.join(', puis ')}.`;
}

/**
 * Onglet « Finales » (Préparer) : pour une session, la zone des finales, puis « Où » et « Quand » de la finale de chaque
 * catégorie. Chaque changement s'enregistre tout de suite ; une session figée est en lecture seule.
 */
export function FinalsPage() {
  const { id = '' } = useParams();
  // Par défaut, la première session (null : une compétition sans session travaille sur sa session unique).
  const { waves, waveId, select, ready } = useSelectedWave(id, () => null);
  const { data: view, error: loadError } = useFinals(id, waveId, ready);
  const { data: zones = [] } = useZones(id);
  const { data: categories = [] } = useCategories(id);
  const setZone = useSetFinalsZone(id);
  const setChoice = useSetCategoryFinals(id);
  const zoneName = (zid: string | null) => zones.find((z) => z.id === zid)?.name ?? null;

  // Avec une zone des finales, la colonne « Où » (son nom attendu le temps que les zones se chargent).
  const finalsZone = view?.finalsZoneId ? (zoneName(view.finalsZoneId) ?? '…') : null;
  const locked = view?.locked ?? false;
  const choose = (patch: { categoryIds?: string[]; where?: FinalsWhere; when?: FinalsWhen }) => {
    setZone.reset();
    setChoice.mutate({ waveId, ...patch });
  };
  const disciplineOf = (cid: string) => {
    const d = categories.find((c) => c.id === cid)?.key.discipline;
    return d ? DISCIPLINES[d].label.toLowerCase() : '';
  };

  const whereCell = (r: FinalsRow) => {
    if (r.fixed === 'finals-zone') return <Text size="sm">sur {finalsZone}</Text>;
    if (r.fixed === 'not-accepted') return <Text size="sm" c="dimmed">{finalsZone} n’accueille pas {disciplineOf(r.categoryId)}</Text>;
    return (
      <SegmentedControl size="xs" data-testid="finals-where" value={r.where} disabled={locked}
        data={[{ value: 'own', label: 'Sa zone' }, { value: 'finals', label: finalsZone ?? '…' }]}
        onChange={(v) => choose({ categoryIds: [r.categoryId], where: v as FinalsWhere })} />
    );
  };

  return (
    <Stack gap="md">
      {waves.length > 0 && (
        <Group gap="xs" wrap="nowrap" maw="100%">
          <Text size="sm" fw={600}>Session :</Text>
          {/* Noms de session longs sur un téléphone : le sélecteur défile au lieu de déborder. */}
          <Box style={{ overflowX: 'auto', minWidth: 0 }}>
            <SegmentedControl data-testid="finals-wave" value={waveId ?? ''} onChange={select} data={waves.map((w) => ({ value: w.id, label: w.name }))} />
          </Box>
        </Group>
      )}
      <ApiErrorAlert error={loadError} />
      {view && (
        <Card withBorder padding="md">
          <Stack gap="md">
            {locked && (
              <Alert color="orange" title="Session figée" data-testid="finals-locked">
                <Group gap="sm" justify="space-between">
                  <Text size="sm">Rouvrez la session dans Combats pour changer.</Text>
                  <Button size="xs" variant="default" component={Link} to={`../combats${waveId ? `?session=${encodeURIComponent(waveId)}` : ''}`} relative="path">
                    Ouvrir Combats
                  </Button>
                </Group>
              </Alert>
            )}
            <Group gap="sm" align="flex-end" wrap="wrap">
              <Select data-testid="finals-zone" label="Zone des finales" w={260} maw="100%" allowDeselect={false} disabled={locked}
                value={view.finalsZoneId ?? ''}
                data={[{ value: '', label: 'Aucune' }, ...zones.map((z) => ({ value: z.id, label: z.name }))]}
                onChange={(v) => { setChoice.reset(); setZone.mutate({ waveId, finalsZoneId: v || null }); }} />
              <Text size="sm" c="dimmed" pb={8} style={{ flex: '1 1 240px' }}>« Aucune » : chaque finale reste sur la zone de sa catégorie.</Text>
            </Group>
            <ApiErrorAlert error={setZone.error ?? setChoice.error} />
            {view.rows.length === 0 ? (
              <EmptyState title="Aucune catégorie dans cette session" text="Les catégories apparaissent ici dès qu’elles ont des inscrits." />
            ) : (
              <>
                {/* Écran étroit : le tableau défile de côté dans sa carte au lieu de déborder de la page. */}
                <Box style={{ overflowX: 'auto' }}>
                  <Table miw={finalsZone ? 760 : 540} verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Catégorie</Table.Th>
                        <Table.Th>Zone</Table.Th>
                        {finalsZone && <Table.Th>Où</Table.Th>}
                        <Table.Th>Quand</Table.Th>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td />
                        <Table.Td />
                        {finalsZone && (
                          <Table.Td>
                            <Group gap={4} wrap="nowrap">
                              <Button size="compact-xs" variant="light" disabled={locked} onClick={() => choose({ where: 'finals' })}>Tout sur {finalsZone}</Button>
                              <Button size="compact-xs" variant="light" disabled={locked} onClick={() => choose({ where: 'own' })}>Tout sur sa zone</Button>
                            </Group>
                          </Table.Td>
                        )}
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Button size="compact-xs" variant="light" disabled={locked} onClick={() => choose({ when: 'ready' })}>Tout dès que finie</Button>
                            <Button size="compact-xs" variant="light" disabled={locked} onClick={() => choose({ when: 'end' })}>Tout en fin de session</Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {view.rows.map((r) => (
                        <Table.Tr key={r.categoryId} data-testid="finals-row">
                          <Table.Td>
                            <Group gap="xs" wrap="nowrap">
                              <Text size="sm" fw={500}>{r.label}</Text>
                              {r.kata && <StatusBadge tone="neutral" size="sm">finale = tour 2</StatusBadge>}
                            </Group>
                          </Table.Td>
                          <Table.Td><Text size="sm" style={{ whiteSpace: 'nowrap' }}>{zoneName(r.zoneId) ?? 'Sans zone'}</Text></Table.Td>
                          {r.noFinal ? (
                            <Table.Td colSpan={finalsZone ? 2 : 1}><Text size="sm" c="dimmed">pas de finale (poule)</Text></Table.Td>
                          ) : (
                            <>
                              {finalsZone && <Table.Td>{whereCell(r)}</Table.Td>}
                              <Table.Td>
                                <SegmentedControl size="xs" data-testid="finals-when" value={r.when} disabled={locked} data={WHEN_OPTIONS}
                                  onChange={(v) => choose({ categoryIds: [r.categoryId], when: v as FinalsWhen })} />
                              </Table.Td>
                            </>
                          )}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Box>
                {view.summary.length > 0 && (
                  <Stack gap={2} data-testid="finals-summary">
                    {view.summary.map((s) => <Text key={s.zoneId} size="sm">{summaryLine(zoneName(s.zoneId) ?? '?', s)}</Text>)}
                  </Stack>
                )}
              </>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
