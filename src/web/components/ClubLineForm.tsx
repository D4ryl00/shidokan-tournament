import { Button, Checkbox, Group, Input, Modal, NativeSelect, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState } from 'react';
import { kgText, weightWarning, type ClubFormLine, type CombatDiscipline } from '../../domain/club-form.js';
import { entryKey } from '../../domain/closed-categories.js';
import type { DisciplineId, Ruleset } from '../../domain/types.js';
import { ApiError, RELOAD_STATUSES, useDeleteClubLine, useSaveClubLine, type ClubEntryView, type ClubLine } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { COMBATS, OneOf, PREFS } from './PaperEntryTable.js';

const RULESETS: [Ruleset, string][] = [['jiyu', 'Jiyu'], ['shobu', 'Shobu']];

export const EMPTY_LINE: ClubFormLine = {
  lastName: '', firstName: '', sex: null, ageBandCode: null, weightClassId: null, weightKg: null, combat: null, kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null,
};

/** Formulaire d'un seul combattant de la page du club (création : `line` null). */
export function ClubLineForm({ token, line, ageBands, weightClasses, closed, opened, onClose }: {
  token: string;
  line: ClubLine | null;
  ageBands: ClubEntryView['ageBands'];
  weightClasses: ClubEntryView['weightClasses'];
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
  const [weight, setWeight] = useState(line?.line.weightKg != null ? kgText(line.line.weightKg) : '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Choix ouverts pour une tranche et un sexe (tout est proposé tant qu'ils ne sont pas choisis).
  const shut = new Set(closed);
  const openFor = (f: ClubFormLine) => (discipline: DisciplineId, ruleset: Ruleset | null) => {
    const b = ageBands.find((x) => x.code === f.ageBandCode);
    return !b || !f.sex || (!shut.has(entryKey({ ageBandCode: b.code, sex: f.sex, discipline, ruleset })) && !(ruleset === 'shobu' && b.isMinor));
  };
  const set = (patch: Partial<ClubFormLine>) =>
    setForm((f) => {
      const next = { ...f, ...patch };
      if (patch.ageBandCode === undefined && patch.sex === undefined) return next;
      // La catégorie de poids dépend de la tranche et du sexe.
      if (!weightClasses.some((w) => w.id === next.weightClassId && w.ageBandCode === next.ageBandCode && w.sex === next.sex)) next.weightClassId = null;
      // Tranche ou sexe changé : un choix devenu fermé est retiré (le coach le voit, au lieu d'un refus à l'enregistrement).
      const open = openFor(next);
      if (next.combat && !open(next.combat, 'jiyu') && !open(next.combat, 'shobu')) Object.assign(next, { combat: null, ruleset: null });
      if (next.combat && next.ruleset && !open(next.combat, next.ruleset)) next.ruleset = null;
      if (next.kata && !open('kata', null)) next.kata = false;
      return next;
    });
  const band = ageBands.find((b) => b.code === form.ageBandCode);
  const classes = weightClasses.filter((w) => w.ageBandCode === form.ageBandCode && w.sex === form.sex);
  const warning = weightWarning(form, weightClasses);
  const isOpen = openFor(form);
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
  const kataShown = kataOpen || !!saved?.kata;
  const nothingOpen = !!band && !!form.sex && combats.length === 0 && !kataShown;
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
        <Input.Wrapper label="Sexe" required labelElement="div" role="group" aria-label="Sexe">
          <OneOf value={form.sex} options={[['F', 'Féminin'], ['M', 'Masculin']]} onChange={(sex) => set({ sex })} />
        </Input.Wrapper>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <Select data-testid="line-age" label="Catégorie d’âge" required data={ageBands.map((b) => ({ value: b.code, label: `${b.label} (${b.ages})` }))} value={form.ageBandCode}
            onChange={(ageBandCode) => set({ ageBandCode })} />
          {/* Obligatoire pour un combat (le kata n'a pas de catégorie de poids). */}
          <Select data-testid="line-weight-class" label="Catégorie de poids" required={!!form.combat} disabled={!classes.length}
            placeholder={classes.length ? undefined : 'Sexe et âge d’abord'}
            data={classes.map((w) => ({ value: w.id, label: `${w.label} kg` }))} value={form.weightClassId} onChange={(weightClassId) => set({ weightClassId })} />
          <TextInput data-testid="line-weight" label="Poids actuel (facultatif)" rightSection={<Text size="xs">kg</Text>} inputMode="decimal" value={weight}
            onChange={(e) => {
              const raw = e.currentTarget.value;
              setWeight(raw);
              const kg = Number(raw.replace(',', '.'));
              set({ weightKg: raw.trim() && kg > 0 ? kg : null });
            }} />
        </SimpleGrid>
        {warning && <Text size="sm" c="var(--sk-warn-text)" data-testid="line-weight-warning">{warning}</Text>}
        {/* Au moins une discipline : un combat, le kata, ou les deux (le poids et le règlement ne sont demandés que pour un combat). */}
        <Input.Wrapper label="Disciplines" required labelElement="div" description={kataShown ? 'Un combat, le kata, ou les deux.' : undefined}>
          <Stack gap="sm" mt={4}>
            <div role="group" aria-label="Discipline de combat">
              <OneOf value={form.combat} options={combats} onChange={(combat) => set({ combat })} />
            </div>
            {kataShown && (
              <Checkbox data-testid="line-kata" label={kataOpen ? 'Kata' : `Kata${NOT_OPEN}`} checked={form.kata} onChange={(e) => set({ kata: e.currentTarget.checked })} />
            )}
          </Stack>
        </Input.Wrapper>
        {nothingOpen && <Text size="sm" c="var(--sk-warn-text)" data-testid="line-nothing-open">Aucune catégorie ouverte pour cette tranche d’âge à cette compétition.</Text>}
        {form.combat && (
          <Input.Wrapper label="Règlement" required labelElement="div" role="group" aria-label="Règlement">
            <OneOf value={form.ruleset} options={rulesets} onChange={(ruleset) => set({ ruleset })} />
          </Input.Wrapper>
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
