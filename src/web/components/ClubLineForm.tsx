import { Button, Checkbox, Group, Modal, NativeSelect, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState } from 'react';
import type { ClubFormLine, CombatDiscipline } from '../../domain/club-form.js';
import { entryKey } from '../../domain/closed-categories.js';
import type { DisciplineId, Ruleset } from '../../domain/types.js';
import { ApiError, RELOAD_STATUSES, useDeleteClubLine, useSaveClubLine, type ClubLine } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { COMBATS, OneOf, PREFS } from './PaperEntryTable.js';

const RULESETS: [Ruleset, string][] = [['jiyu', 'Jiyu'], ['shobu', 'Shobu']];

export const EMPTY_LINE: ClubFormLine = {
  lastName: '', firstName: '', sex: null, ageBandCode: null, weightKg: null, combat: null, kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null,
};

/** Formulaire d'un seul combattant de la page du club (création : `line` null). */
export function ClubLineForm({ token, line, ageBands, closed, opened, onClose }: {
  token: string;
  line: ClubLine | null;
  ageBands: { code: string; label: string; isMinor: boolean }[];
  /** Cases fermées (`entryKey`) : ces choix ne sont pas proposés, sauf la valeur déjà enregistrée. */
  closed: string[];
  opened: boolean;
  onClose: (message?: string) => void;
}) {
  const mobile = useMediaQuery('(max-width: 600px)');
  const save = useSaveClubLine(token);
  const remove = useDeleteClubLine(token);
  // Le parent remonte le formulaire (key) pour chaque combattant : l'état part de la ligne ouverte.
  const [form, setForm] = useState<ClubFormLine>(line?.line ?? EMPTY_LINE);
  const [weight, setWeight] = useState(line?.line.weightKg != null ? String(line.line.weightKg).replace('.', ',') : '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (patch: Partial<ClubFormLine>) => setForm((f) => ({ ...f, ...patch }));
  // Choix ouverts pour la tranche et le sexe choisis (tout est proposé tant qu'ils ne le sont pas).
  const shut = new Set(closed);
  const band = ageBands.find((b) => b.code === form.ageBandCode);
  const isOpen = (discipline: DisciplineId, ruleset: Ruleset | null) =>
    !band || !form.sex || (!shut.has(entryKey({ ageBandCode: band.code, sex: form.sex, discipline, ruleset })) && !(ruleset === 'shobu' && band.isMinor));
  const saved = line?.line;
  const NOT_OPEN = ' (non ouverte)';
  const combats = COMBATS.flatMap(([d, label]): [CombatDiscipline, string][] => {
    if (isOpen(d, 'jiyu') || isOpen(d, 'shobu')) return [[d, label]];
    return saved?.combat === d ? [[d, label + NOT_OPEN]] : [];
  });
  const rulesets = RULESETS.flatMap(([r, label]): [Ruleset, string][] => {
    if (!form.combat || isOpen(form.combat, r)) return [[r, label]];
    return saved?.combat === form.combat && saved.ruleset === r ? [[r, label + NOT_OPEN]] : [];
  });
  const kataOpen = isOpen('kata', null);
  const nothingOpen = !!band && !!form.sex && combats.length === 0 && !kataOpen && !saved?.kata;
  // Un refus parce que la ligne a changé ou disparu entre-temps (ou que les inscriptions sont closes) ferme le formulaire : la liste est rechargée.
  const onError = (e: Error) => {
    if (e instanceof ApiError && RELOAD_STATUSES.has(e.status)) onClose(e.message);
  };
  const submit = () =>
    save.mutate({ fighterId: line?.fighterId ?? null, line: form, version: line?.version ?? null }, { onSuccess: () => onClose(), onError });
  const doDelete = () => line && remove.mutate({ fighterId: line.fighterId, version: line.version }, { onSuccess: () => onClose(), onError });

  return (
    <Modal opened={opened} onClose={() => onClose()} fullScreen={mobile} title={line ? `${line.line.lastName} ${line.line.firstName}` : 'Ajouter un combattant'}>
      <Stack data-testid="club-line-form">
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput data-testid="line-last-name" label="Nom" required value={form.lastName} onChange={(e) => set({ lastName: e.currentTarget.value })} />
          <TextInput data-testid="line-first-name" label="Prénom" required value={form.firstName} onChange={(e) => set({ firstName: e.currentTarget.value })} />
        </SimpleGrid>
        <Stack gap={4} role="group" aria-label="Sexe">
          <Text size="sm" fw={500}>Sexe</Text>
          <OneOf value={form.sex} options={[['F', 'Féminin'], ['M', 'Masculin']]} onChange={(sex) => set({ sex })} />
        </Stack>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <Select data-testid="line-age" label="Catégorie d’âge" data={ageBands.map((b) => ({ value: b.code, label: b.label }))} value={form.ageBandCode}
            onChange={(ageBandCode) => set({ ageBandCode })} />
          <TextInput data-testid="line-weight" label="Poids actuel" rightSection={<Text size="xs">kg</Text>} inputMode="decimal" value={weight}
            onChange={(e) => {
              const raw = e.currentTarget.value;
              setWeight(raw);
              const kg = Number(raw.replace(',', '.'));
              set({ weightKg: raw.trim() && kg > 0 ? kg : null });
            }} />
        </SimpleGrid>
        <Stack gap={4} role="group" aria-label="Discipline de combat">
          <Text size="sm" fw={500}>Discipline de combat</Text>
          <OneOf value={form.combat} options={combats} onChange={(combat) => set({ combat })} />
        </Stack>
        {(kataOpen || saved?.kata) && (
          <Checkbox data-testid="line-kata" label={kataOpen ? 'Kata' : `Kata${NOT_OPEN}`} checked={form.kata} onChange={(e) => set({ kata: e.currentTarget.checked })} />
        )}
        {nothingOpen && <Text size="sm" c="var(--sk-warn-text)" data-testid="line-nothing-open">Aucune catégorie ouverte pour cette tranche d’âge à cette compétition.</Text>}
        {form.combat && (
          <Stack gap={4} role="group" aria-label="Règlement">
            <Text size="sm" fw={500}>Règlement</Text>
            <OneOf value={form.ruleset} options={rulesets} onChange={(ruleset) => set({ ruleset })} />
          </Stack>
        )}
        {form.kata && <TextInput data-testid="line-grade" label="Grade (pour le kata)" value={form.grade ?? ''} onChange={(e) => set({ grade: e.currentTarget.value || null })} />}
        {form.combat && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>Si reclassement : autres disciplines acceptées, par ordre de préférence</Text>
            <Group gap="xs">
              {PREFS.map(([d, label]) => (
                <NativeSelect key={d} size="xs" w={110} aria-label={`Reclassement ${label}`} label={label} data={['', '1', '2']}
                  value={form.prefs[d] ? String(form.prefs[d]) : ''}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    const prefs = { ...form.prefs };
                    if (v === '1' || v === '2') prefs[d] = Number(v) as 1 | 2;
                    else delete prefs[d];
                    set({ prefs });
                  }} />
              ))}
            </Group>
          </Stack>
        )}
        {form.ruleset === 'shobu' && (
          <Stack gap={4} role="group" aria-label="Shobu : garder en priorité">
            <Text size="sm" fw={500}>Shobu : en cas de reclassement, garder en priorité</Text>
            <OneOf value={form.shobuKeep} options={[['ruleset', 'Les règles shobu'], ['discipline', 'La discipline']]} onChange={(shobuKeep) => set({ shobuKeep })} />
          </Stack>
        )}
        <ApiErrorAlert error={save.error ?? remove.error} />
        <Group justify="space-between">
          {line ? (
            confirmDelete ? (
              <Group gap="xs">
                <Button color="red" data-testid="line-delete-confirm" loading={remove.isPending} onClick={doDelete}>Confirmer la suppression</Button>
                <Button variant="subtle" onClick={() => setConfirmDelete(false)}>Garder</Button>
              </Group>
            ) : (
              <Button variant="subtle" color="red" data-testid="line-delete" onClick={() => setConfirmDelete(true)}>Supprimer</Button>
            )
          ) : <span />}
          <Group gap="xs">
            <Button variant="default" onClick={() => onClose()}>Annuler</Button>
            <Button data-testid="line-save" loading={save.isPending} onClick={submit}>Enregistrer</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
