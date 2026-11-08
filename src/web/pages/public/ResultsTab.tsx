import { Box, Group, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useMemo, useState } from 'react';
import type { DisciplineId } from '../../../domain/types.js';
import { finishedPodiums, highlightedRegistrations } from '../../components/public/bracketsModel.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { DISCIPLINE_OPTIONS, disciplineLabel } from '../../labels.js';
import type { PublicTabProps } from './tabProps.js';

const cardStyle = { background: 'var(--sk-card)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-md)' } as const;
const PLACES = { 1: '1er', 2: '2e', 3: '3e' } as const;

/** Onglet « Résultats » : podiums des catégories terminées (les plus récentes d'abord), puis le tableau des médailles par club. */
export function ResultsTab({ pub, followed }: PublicTabProps) {
  const [discipline, setDiscipline] = useState<DisciplineId | 'all'>('all');
  const [q, setQ] = useState('');
  const podiums = useMemo(() => finishedPodiums(pub.categories, discipline), [pub, discipline]);
  const highlighted = useMemo(() => highlightedRegistrations(pub, q), [pub, q]);
  const isFollowed = (rid: string) => { const f = pub.entrants[rid]?.fighterId; return f != null && followed.has(f); };

  return (
    <Stack gap="sm" data-testid="public-results">
      <TextInput value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Chercher un combattant ou un club (surligné)" aria-label="Chercher dans les résultats" data-testid="public-results-search" />
      <Select size="xs" label="Discipline" allowDeselect={false} value={discipline} onChange={(v) => setDiscipline((v ?? 'all') as typeof discipline)}
        data={[{ value: 'all', label: 'Toutes' }, ...DISCIPLINE_OPTIONS]} data-testid="public-results-discipline" />
      {podiums.length === 0 ? <EmptyState title="Aucun podium pour le moment." data-testid="public-results-empty" /> : podiums.map(({ category: c, lines }) => (
        <Stack key={c.id} gap={2} p="sm" data-testid="public-podium" style={cardStyle}>
          <Text fw={700} style={{ overflowWrap: 'anywhere' }}>{c.label}</Text>
          <Text size="xs" c="dimmed">{disciplineLabel(c.discipline)}</Text>
          {lines.map((l) => {
            const e = pub.entrants[l.registrationId];
            const on = highlighted.has(l.registrationId);
            return (
              <Group key={`${l.place}:${l.registrationId}`} gap="xs" wrap="nowrap" align="baseline" data-highlighted={on ? 'true' : undefined}
                style={{ background: on ? 'color-mix(in srgb, var(--sk-accent) 18%, transparent)' : undefined, borderRadius: 4, padding: '2px 4px' }}>
                <Text span size="sm" fw={700} style={{ flexShrink: 0, minWidth: 32 }}>{PLACES[l.place]}</Text>
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{e?.name ?? '—'}{isFollowed(l.registrationId) && <Text span aria-label="Combattant suivi" style={{ color: 'var(--sk-accent)' }}> ★</Text>}</Text>
                  <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{e?.club}</Text>
                </Box>
              </Group>
            );
          })}
        </Stack>
      ))}
      {pub.medals.length > 0 && (
        <Stack gap={4} data-testid="public-medals">
          <Text fw={700}>Par club</Text>
          <Box style={{ overflowX: 'auto' }}>
            <Table withTableBorder>
              <Table.Thead><Table.Tr><Table.Th>Club</Table.Th><Table.Th ta="right">Or</Table.Th><Table.Th ta="right">Argent</Table.Th><Table.Th ta="right">Bronze</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {pub.medals.map((m) => (
                  <Table.Tr key={m.clubId} data-testid="public-medal-row">
                    <Table.Td style={{ overflowWrap: 'anywhere' }}>{m.club}</Table.Td>
                    <Table.Td ta="right">{m.gold}</Table.Td><Table.Td ta="right">{m.silver}</Table.Td><Table.Td ta="right">{m.bronze}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
