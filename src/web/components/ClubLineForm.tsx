import { Button, Checkbox, Group, Input, Modal, NativeSelect, Paper, Radio, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState } from 'react';
import { PREF_DISCIPLINES, choosePref, kgText, orderedPrefs, tidyReclass, weightWarning, type ClubFormLine, type CombatDiscipline, type PrefDiscipline, type PrefRank } from '../../domain/club-form.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { entryKey } from '../../domain/closed-categories.js';
import type { DisciplineId, Ruleset } from '../../domain/types.js';
import { ApiError, RELOAD_STATUSES, useDeleteClubLine, useSaveClubLine, type ClubEntryView, type ClubLine } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { COMBATS, OneOf } from './PaperEntryTable.js';

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
      if (patch.ageBandCode === undefined && patch.sex === undefined) return tidyReclass(next);
      // La catégorie de poids dépend de la tranche et du sexe.
      if (!weightClasses.some((w) => w.id === next.weightClassId && w.ageBandCode === next.ageBandCode && w.sex === next.sex)) next.weightClassId = null;
      // Tranche ou sexe changé : un choix devenu fermé est retiré (le coach le voit, au lieu d'un refus à l'enregistrement).
      const open = openFor(next);
      if (next.combat && !open(next.combat, 'jiyu') && !open(next.combat, 'shobu')) Object.assign(next, { combat: null, ruleset: null });
      if (next.combat && next.ruleset && !open(next.combat, next.ruleset)) next.ruleset = null;
      if (next.kata && !open('kata', null)) next.kata = false;
      next.prefs = Object.fromEntries(orderedPrefs(next.prefs).filter((d) => open(d, 'jiyu') || open(d, 'shobu')).map((d, i) => [d, i + 1]));
      return tidyReclass(next);
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
  const otherChoices = PREF_DISCIPLINES.filter((d) => d !== form.combat).flatMap((d): [PrefDiscipline, string][] => {
    const { label } = DISCIPLINES[d];
    if (isOpen(d, 'jiyu') || isOpen(d, 'shobu')) return [[d, label]];
    return form.prefs[d] ? [[d, label + NOT_OPEN]] : [];
  });
  const chosen = orderedPrefs(form.prefs);
  // Un rang de plus s'affiche quand le précédent est choisi et qu'il reste une discipline à proposer.
  const shownRanks = ([1, 2, 3] as PrefRank[]).filter((rank) => rank === 1 || (chosen.length >= rank - 1 && otherChoices.length >= rank));
  const ownLabel = form.combat ? DISCIPLINES[form.combat].label.toLowerCase() : '';
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
        {form.combat && otherChoices.length > 0 && (
          <Paper withBorder p="md" radius="md" data-testid="line-reclass" style={{ background: 'var(--sk-bg)' }}>
            <Stack gap="sm">
              <div>
                <Text fw={600} size="sm">Reclassement : si {form.firstName.trim() || 'ce combattant'} se retrouve sans adversaire</Text>
                <Text size="sm" c="dimmed" mt={2}>Le jour de la compétition, un combattant peut se retrouver seul dans sa catégorie. L’organisation cherche alors à lui trouver un adversaire. Peut-on lui proposer une autre discipline ?</Text>
              </div>
              <SimpleGrid cols={{ base: 1, xs: shownRanks.length > 1 ? 2 : 1 }}>
                {shownRanks.map((rank) => (
                  <NativeSelect key={rank} label={rank === 1 ? '1er choix' : `${rank}e choix`} value={chosen[rank - 1] ?? ''}
                    data={[
                      { value: '', label: rank === 1 ? `Non, rester en ${ownLabel}` : `Pas de ${rank}e choix` },
                      // Les rangs précédents ne sont plus proposés ; le 1er choix peut reprendre une discipline choisie plus loin.
                      ...otherChoices.filter(([d]) => !chosen.slice(0, rank - 1).includes(d)).map(([value, label]) => ({ value, label })),
                    ]}
                    onChange={(e) => set({ prefs: choosePref(form.prefs, rank, (e.currentTarget.value || null) as PrefDiscipline | null) })} />
                ))}
              </SimpleGrid>
              {form.ruleset === 'shobu' && (chosen.length > 0 ? (
                <Radio.Group label="Que lui proposer d’abord ?" value={form.shobuKeep} onChange={(v) => set({ shobuKeep: v as 'ruleset' | 'discipline' })}>
                  <Stack gap={6} mt={6}>
                    <Radio value="ruleset" label="Changer de discipline, rester en shobu" />
                    <Radio value="discipline" label={`Rester en ${ownLabel}, passer en jiyu`} />
                  </Stack>
                </Radio.Group>
              ) : <Text size="xs" c="dimmed">Sans autre discipline, on pourra seulement lui proposer de passer en jiyu.</Text>)}
            </Stack>
          </Paper>
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
