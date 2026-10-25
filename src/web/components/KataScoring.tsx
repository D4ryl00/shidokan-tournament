import { ActionIcon, Group, NumberInput, Select, Stack, Table, Text, Title } from '@mantine/core';
import { StatusBadge } from './ui/StatusBadge.js';
import { useEffect, useState } from 'react';
import { kataScore, resolveKata, type KataBracket, type KataScores } from '../../domain/brackets/kata.js';
import { usePutKataNotes } from '../api.js';
import type { EntrantInfo } from './BracketView.js';
import { SectionHeader } from './Help.js';

function NotesRow({ label, club, grade, judges, notes, onSave, finalist }: { label: string; club: string; grade?: string | null; judges: number; notes: number[]; onSave: (n: number[]) => void; finalist?: boolean }) {
  const [values, setValues] = useState<(number | '')[]>([]);
  // Ne réinitialise la ligne que si ses notes enregistrées changent vraiment (pas à chaque rechargement des autres lignes).
  const saved = JSON.stringify(notes);
  useEffect(() => setValues((cur) => Array.from({ length: Math.max(judges, notes.length) }, (_, i) => notes[i] ?? (cur[i] !== undefined && notes.length === 0 ? cur[i]! : ''))), [judges, saved]);
  const filled = values.filter((v): v is number => v !== '');
  const dirty = JSON.stringify(filled) !== JSON.stringify(notes);
  return (
    <Table.Tr data-testid="kata-row">
      <Table.Td>
        <Text fw={500}>{label} {finalist && <StatusBadge tone="accent" size="sm">Finale</StatusBadge>}</Text>
        <Text size="xs" c="dimmed">{club}{grade ? ` · Grade : ${grade}` : ''}</Text>
      </Table.Td>
      {values.map((v, i) => (
        <Table.Td key={i}>
          <NumberInput data-testid="kata-note" w={70} size="xs" min={0} max={10} step={0.1} decimalScale={2} decimalSeparator="," hideControls value={v}
            onChange={(x) => setValues(values.map((y, j) => (j === i ? (x === '' ? '' : Number(x)) : y)))}
            onKeyDown={(e) => e.key === 'Enter' && dirty && onSave(filled)} />
        </Table.Td>
      ))}
      <Table.Td><Text fw={700}>{kataScore(filled)?.toLocaleString('fr-FR') ?? '—'}</Text></Table.Td>
      <Table.Td>
        <ActionIcon data-testid="kata-save" variant={dirty ? 'filled' : 'subtle'} disabled={!dirty} aria-label="Enregistrer" onClick={() => onSave(filled)}>✓</ActionIcon>
      </Table.Td>
    </Table.Tr>
  );
}

/** Notation des katas : tour 1 pour tous, puis finale des deux meilleurs (moyenne simple sous 5 arbitres). */
export function KataScoring({ competitionId, categoryId, bracket, scores, tieBreak, finalTieBreak, entrants }: { competitionId: string; categoryId: string; bracket: KataBracket; scores: KataScores; tieBreak: string[]; finalTieBreak: string[]; entrants: Map<string, EntrantInfo> }) {
  const put = usePutKataNotes(competitionId);
  const used = Math.max(0, ...Object.values(scores.round1).map((n) => n.length), ...Object.values(scores.final).map((n) => n.length));
  const [chosen, setJudges] = useState(used || 5);
  // Jamais moins de colonnes que de notes déjà saisies (sinon des notes seraient masquées).
  const judges = Math.max(chosen, used);
  const { finalists, round1Ranking } = resolveKata(bracket, scores, tieBreak, finalTieBreak);
  const header = (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Kataka</Table.Th>
        {Array.from({ length: judges }, (_, i) => <Table.Th key={i}>Arbitre {i + 1}</Table.Th>)}
        <Table.Th>Note</Table.Th>
        <Table.Th />
      </Table.Tr>
    </Table.Thead>
  );
  const info = (id: string) => entrants.get(id) ?? { name: '?', club: '' };
  const round1Complete = bracket.order.length <= 2 || round1Ranking.every((r) => r.score !== null);
  return (
    <Stack>
      <SectionHeader topic="combats.kata" order={5} />
      <Group>
        <Select data-testid="kata-judges" label="Nombre d'arbitres" w={160} data={['1', '2', '3', '4', '5', '6', '7'].filter((n) => Number(n) >= used)} value={String(judges)} allowDeselect={false} onChange={(v) => v && setJudges(Number(v))} />
        <Text size="sm" c="dimmed">{judges < 5 ? 'Moins de 5 arbitres : moyenne des notes.' : 'Note la plus haute et la plus basse retirées, puis moyenne.'}</Text>
      </Group>
      {bracket.order.length > 2 && (
        <>
          <Title order={4} fz="md">Tour 1 (ordre de passage)</Title>
          <Table>
            {header}
            <Table.Tbody>
              {bracket.order.map((id) => (
                <NotesRow key={id} label={info(id).name} club={info(id).club} grade={info(id).grade} judges={judges} notes={scores.round1[id] ?? []} finalist={round1Complete && finalists.includes(id)}
                  onSave={(notes) => put.mutate({ cid: categoryId, rid: id, round: 'round1', notes })} />
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
      <Title order={4} fz="md">Finale</Title>
      {round1Complete ? (
        <Table>
          {header}
          <Table.Tbody>
            {finalists.map((id) => (
              <NotesRow key={id} label={info(id).name} club={info(id).club} grade={info(id).grade} judges={judges} notes={scores.final[id] ?? []}
                onSave={(notes) => put.mutate({ cid: categoryId, rid: id, round: 'final', notes })} />
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text size="sm" c="dimmed">La finale apparaîtra quand toutes les notes du tour 1 seront saisies.</Text>
      )}
    </Stack>
  );
}
