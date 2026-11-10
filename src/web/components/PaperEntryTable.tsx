import { Button, Checkbox, Chip, Group, NativeSelect, ScrollArea, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { SHOBU_KEEP_LABELS, ageBandAbbreviations, type ClubFormLine, type CombatDiscipline, type PrefDiscipline, type PrefRank } from '../../domain/club-form.js';
import type { CategoryGrid } from '../../domain/types.js';
import type { Club } from '../../domain/registration.js';
import { useClosedCategories, useCompetition, useImportPaperEntry, usePreviewPaperEntry, useResolveClub } from '../api.js';
import { entryKey, offeredAgeBands } from '../../domain/closed-categories.js';
import { useUnsaved } from '../unsaved.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { ClubFormPreviewTable } from './ClubFormPreviewTable.js';
import { plural } from '../../domain/plural.js';
import { ClubPicker } from './club-picker/ClubPicker.js';
import type { ClubChoice } from './club-picker/choice.js';
import { toggleCombat, type LineFormContext } from './club-line/lineForm.js';

const emptyLine = (): ClubFormLine => ({
  lastName: '', firstName: '', sex: null, ageBandCode: null, weightClassId: null, weightKg: null, combats: [], kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null,
});
export const COMBATS: [CombatDiscipline, string][] = [['karate', 'Karaté'], ['shido-boxing', 'Boxing'], ['shido-mix', 'Mix'], ['triathlon', 'Triathlon']];
export const PREFS: [PrefDiscipline, string, string][] = [['karate', 'Karaté', 'Ka'], ['shido-boxing', 'Boxing', 'Bx'], ['shido-mix', 'Mix', 'Mx'], ['triathlon', 'Triathlon', 'Tri']];

/** Cases à choix unique, comme sur la fiche : un second clic décoche. */
export function OneOf<T extends string>({ value, options, onChange }: { value: T | null; options: [T, string][]; onChange: (v: T | null) => void }) {
  return (
    <Group gap={4} wrap="wrap">
      {options.map(([v, label]) => (
        <Chip key={v} size="xs" checked={value === v} onChange={() => onChange(value === v ? null : v)}>{label}</Chip>
      ))}
    </Group>
  );
}

/** Saisie d'une fiche papier renvoyée par un club : mêmes colonnes et même ordre que la fiche. Rien n'est écrit avant « Enregistrer la fiche ». */
export function PaperEntryTable({ competitionId, grid }: { competitionId: string; grid: CategoryGrid }) {
  const [choice, setChoice] = useState<ClubChoice | null>(null);
  const [preApproval, setPreApproval] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<unknown>(null);
  const [lines, setLines] = useState<ClubFormLine[]>(() => Array.from({ length: 5 }, emptyLine));
  const [weights, setWeights] = useState<string[]>(() => Array(5).fill(''));
  const preview = usePreviewPaperEntry(competitionId);
  const save = useImportPaperEntry(competitionId);
  const resolveClub = useResolveClub(competitionId);
  const { data: competition } = useCompetition(competitionId);
  // Seule la règle « un ou plusieurs combats » sert ici : les choix fermés ne sont pas filtrés sur une fiche papier.
  const combatCtx: LineFormContext = { mode: 'organiser', multipleCombats: competition?.settings.multipleCombatDisciplinesPerDay ?? false, closed: new Set(), ageBands: [], weightClasses: [], saved: null };
  const { data: closedView } = useClosedCategories(competitionId);
  const offered = offeredAgeBands(grid, new Set((closedView?.closed ?? []).map(entryKey)));
  const abbr = ageBandAbbreviations(offered);
  const bands = offered.map((b) => [b.code, abbr.get(b.code)!] as [string, string]);
  const isEmpty = (l: ClubFormLine) => !l.lastName && !l.firstName && !l.sex && !l.ageBandCode && l.weightKg === null && !l.combats.length && !l.kata && !l.grade && !l.ruleset && !Object.keys(l.prefs).length && !l.shobuKeep;
  useUnsaved('paper-entry', !!choice || lines.some((l) => !isEmpty(l)));

  const changed = () => {
    preview.reset();
    save.reset();
    setResolveError(null);
  };
  const setLine = (i: number, patch: Partial<ClubFormLine>) => {
    changed();
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const pick = (next: ClubChoice | null, club: Club | null) => {
    changed();
    setChoice(next);
    // Le pré-accord est celui du club (coché en ligne par son coach) ; une fiche de l'annuaire n'en a pas encore.
    setPreApproval(club?.preApproval ?? false);
  };
  const reset = () => {
    setChoice(null);
    setPreApproval(false);
    setLines(Array.from({ length: 5 }, emptyLine));
    setWeights(Array(5).fill(''));
    preview.reset();
  };
  // « Vérifier » n'écrit rien : une fiche de l'annuaire n'entre dans la compétition qu'à « Enregistrer la fiche ».
  const doPreview = () => choice && preview.mutate({ header: choice.kind === 'club' ? { clubId: choice.id, preApproval } : { directoryId: choice.id, preApproval }, lines });
  const doSave = async () => {
    if (!choice) return;
    setResolving(true);
    setResolveError(null);
    try {
      const club = await resolveClub(choice);
      save.mutate({ header: { clubId: club.id, preApproval }, lines }, {
        onSuccess: (r) => {
          notifications.show({ color: 'green', message: `${r.club.name} : ${plural(r.imported, 'inscription enregistrée', 'inscriptions enregistrées')}, ${plural(r.replaced, 'remplacée', 'remplacées')}.` });
          reset();
        },
      });
    } catch (e) {
      setResolveError(e);
    } finally {
      setResolving(false);
    }
  };

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <ClubPicker competitionId={competitionId} value={choice} onChange={pick} />
        <Checkbox mt="lg" label="Pré-accord du coach (poids et âge)" checked={preApproval} onChange={(e) => { changed(); setPreApproval(e.currentTarget.checked); }} />
      </SimpleGrid>
      <ScrollArea type="auto" offsetScrollbars="x">
        <Table withTableBorder withColumnBorders miw={1440} verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nom</Table.Th><Table.Th>Prénom</Table.Th><Table.Th>Sexe</Table.Th><Table.Th>Catégorie d’âge</Table.Th>
              <Table.Th>Poids actuel</Table.Th><Table.Th>Disciplines</Table.Th><Table.Th>Grade</Table.Th><Table.Th>Règlement</Table.Th>
              <Table.Th>Si seul : autre discipline ? (1, 2, 3)</Table.Th><Table.Th>Shobu : si seul, d’abord…</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((l, i) => (
              <Table.Tr key={i} data-testid="paper-entry-row">
                <Table.Td w={150}><TextInput size="xs" aria-label="Nom" value={l.lastName} onChange={(e) => setLine(i, { lastName: e.currentTarget.value })} /></Table.Td>
                <Table.Td w={130}><TextInput size="xs" aria-label="Prénom" value={l.firstName} onChange={(e) => setLine(i, { firstName: e.currentTarget.value })} /></Table.Td>
                <Table.Td role="group" aria-label={`Ligne ${i + 1} — Sexe`}><OneOf value={l.sex} options={[['F', 'F'], ['M', 'M']]} onChange={(sex) => setLine(i, { sex })} /></Table.Td>
                <Table.Td role="group" aria-label={`Ligne ${i + 1} — Catégorie d’âge`} w={280}><OneOf value={l.ageBandCode} options={bands} onChange={(ageBandCode) => setLine(i, { ageBandCode })} /></Table.Td>
                <Table.Td w={90}>
                  <TextInput size="xs" aria-label="Poids actuel" rightSection={<Text size="xs">kg</Text>} value={weights[i]}
                    onChange={(e) => {
                      const raw = e.currentTarget.value;
                      setWeights((w) => w.map((x, j) => (j === i ? raw : x)));
                      const kg = Number(raw.replace(',', '.'));
                      setLine(i, { weightKg: raw.trim() && kg > 0 ? kg : null });
                    }} />
                </Table.Td>
                <Table.Td role="group" aria-label={`Ligne ${i + 1} — Disciplines`} w={230}>
                  <Group gap={4}>
                    {COMBATS.map(([d, label]) => (
                      <Chip key={d} size="xs" checked={l.combats.includes(d)} onChange={() => setLine(i, { combats: toggleCombat(l, d, combatCtx) })}>{label}</Chip>
                    ))}
                    <Chip size="xs" checked={l.kata} onChange={(kata) => setLine(i, { kata })}>Kata</Chip>
                  </Group>
                </Table.Td>
                <Table.Td w={100}><TextInput size="xs" aria-label="Grade" value={l.grade ?? ''} onChange={(e) => setLine(i, { grade: e.currentTarget.value || null })} /></Table.Td>
                <Table.Td role="group" aria-label={`Ligne ${i + 1} — Règlement`}><OneOf value={l.ruleset} options={[['jiyu', 'Jiyu'], ['shobu', 'Shobu']]} onChange={(ruleset) => setLine(i, { ruleset })} /></Table.Td>
                <Table.Td role="group" aria-label={`Ligne ${i + 1} — Si seul : autre discipline`}>
                  <Group gap={4} wrap="nowrap">
                    {PREFS.map(([d, label, short]) => (
                      <NativeSelect key={d} size="xs" w={78} aria-label={`Reclassement ${label}`} data={['', '1', '2', '3']} disabled={l.combats.includes(d)}
                        leftSection={<Text size="xs" c="dimmed">{short}</Text>}
                        value={l.prefs[d] ? String(l.prefs[d]) : ''}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          const prefs = { ...l.prefs };
                          if (v === '1' || v === '2' || v === '3') prefs[d] = Number(v) as PrefRank;
                          else delete prefs[d];
                          setLine(i, { prefs });
                        }} />
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td role="group" aria-label={`Ligne ${i + 1} — Shobu : si seul, d’abord`}><OneOf value={l.shobuKeep} options={[['ruleset', SHOBU_KEEP_LABELS.ruleset], ['discipline', SHOBU_KEEP_LABELS.discipline]]} onChange={(shobuKeep) => setLine(i, { shobuKeep })} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Group>
        <Button variant="default" onClick={() => { changed(); setLines((ls) => [...ls, emptyLine()]); setWeights((w) => [...w, '']); }}>Ajouter une ligne</Button>
        <Button data-testid="paper-entry-check" variant="light" onClick={doPreview} loading={preview.isPending} disabled={!choice}>
          Vérifier
        </Button>
      </Group>
      <ApiErrorAlert error={preview.error ?? save.error ?? resolveError} />
      {preview.data && (
        <Stack data-testid="paper-entry-preview">
          <ClubFormPreviewTable parse={preview.data} grid={grid} paper />
          <Group>
            <Button data-testid="paper-entry-save" onClick={doSave} loading={save.isPending || resolving} disabled={!preview.data.rows.some((r) => r.input)}>
              Enregistrer la fiche ({plural(preview.data.rows.filter((r) => r.input).length, 'inscription valide', 'inscriptions valides')})
            </Button>
            <Text size="sm" c="dimmed">Chaque page saisie s’ajoute aux inscriptions déjà enregistrées pour ce club ; une ligne déjà saisie est mise à jour.</Text>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
