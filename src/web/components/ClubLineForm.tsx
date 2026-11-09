import { Button, Checkbox, Chip, Group, Input, Modal, NativeSelect, Paper, Radio, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState, type ReactNode } from 'react';
import { choosePref, kgText, orderedPrefs, weightWarning, type ClubFormLine, type PrefDiscipline, type PrefRank } from '../../domain/club-form.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { ApiError, RELOAD_STATUSES, type ClubEntryView, type ClubLine, type LineOps } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { ageBandChoices, applyChange, combatChoices, kataOffered, NOT_OPEN, reclassChoices, rulesetChoices, toggleCombat, type LineFormContext } from './club-line/lineForm.js';
import { OneOf } from './PaperEntryTable.js';

export const EMPTY_LINE: ClubFormLine = {
  lastName: '', firstName: '', sex: null, ageBandCode: null, weightClassId: null, weightKg: null, combats: [], kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null,
};

/** Fenêtre d'un combattant, pour le coach (page du club) et pour l'organisateur (création : `line` null). */
export function ClubLineForm({ ops, mode, multipleCombats, line, ageBands, weightClasses, closed, opened, onClose, title, footerExtra }: {
  ops: LineOps;
  mode: 'coach' | 'organiser';
  multipleCombats: boolean;
  line: ClubLine | null;
  ageBands: ClubEntryView['ageBands'];
  weightClasses: ClubEntryView['weightClasses'];
  /** Cases fermées (`entryKey`) : ces choix ne sont pas proposés au coach, sauf la valeur déjà enregistrée. */
  closed: string[];
  opened: boolean;
  onClose: (message?: string) => void;
  /** Remplace le titre par défaut. */
  title?: string;
  /** Boutons de plus, à côté de « Enregistrer ». */
  footerExtra?: ReactNode;
}) {
  const mobile = useMediaQuery('(max-width: 600px)');
  // Le parent remonte le formulaire (key) pour chaque combattant : l'état part de la ligne ouverte.
  const [form, setForm] = useState<ClubFormLine>(line?.line ?? EMPTY_LINE);
  const [weight, setWeight] = useState(line?.line.weightKg != null ? kgText(line.line.weightKg) : '');
  const [nameHidden, setNameHidden] = useState(line?.publicNameHidden ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saved = line?.line ?? null;
  const ctx: LineFormContext = { mode, multipleCombats, closed: new Set(closed), ageBands, weightClasses, saved };
  const set = (patch: Partial<ClubFormLine>) => setForm((f) => applyChange(f, patch, ctx));
  const band = ageBands.find((b) => b.code === form.ageBandCode);
  const classes = weightClasses.filter((w) => w.ageBandCode === form.ageBandCode && w.sex === form.sex);
  const warning = weightWarning(form, weightClasses);
  const hasCombat = form.combats.length > 0;
  const combats = combatChoices(form, ctx);
  const rulesets = rulesetChoices(form, ctx);
  const kataOpen = kataOffered(form, ctx);
  const otherChoices = reclassChoices(form, ctx);
  const chosen = orderedPrefs(form.prefs);
  // Un rang de plus s'affiche quand le précédent est choisi et qu'il reste une discipline à proposer.
  const shownRanks = ([1, 2, 3] as PrefRank[]).filter((rank) => rank === 1 || (chosen.length >= rank - 1 && otherChoices.length >= rank));
  const ownLabel = form.combats.map((c) => DISCIPLINES[c].label.toLowerCase()).join(' et ');
  const kataShown = kataOpen || !!saved?.kata;
  const nothingOpen = mode === 'coach' && !!band && !!form.sex && combats.length === 0 && !kataShown;
  // Un refus parce que la ligne a changé ou disparu entre-temps (ou que les inscriptions sont closes) ferme le formulaire : la liste est rechargée.
  const onError = (e: unknown) => {
    if (e instanceof ApiError && RELOAD_STATUSES.has(e.status)) onClose(e.message);
  };
  const submit = () =>
    ops.save({ fighterId: line?.fighterId ?? null, line: form, version: line?.version ?? null, publicNameHidden: nameHidden })
      // L'organisateur peut choisir une catégorie fermée : le serveur l'enregistre avec un avis, qu'on lui montre.
      .then((done) => onClose(mode === 'organiser' && done.notices.length ? done.notices.join(' ') : undefined), onError);
  const doDelete = () => line && ops.remove({ fighterId: line.fighterId, version: line.version }).then(() => onClose(), onError);

  return (
    <Modal opened={opened} onClose={() => onClose()} fullScreen={mobile} title={title ?? (line ? `${line.line.lastName} ${line.line.firstName}` : 'Ajouter un combattant')}>
      <Stack data-testid="club-line-form">
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput data-testid="line-last-name" label="Nom" required value={form.lastName} onChange={(e) => set({ lastName: e.currentTarget.value })} />
          <TextInput data-testid="line-first-name" label="Prénom" required value={form.firstName} onChange={(e) => set({ firstName: e.currentTarget.value })} />
        </SimpleGrid>
        <Input.Wrapper label="Sexe" required labelElement="div" role="group" aria-label="Sexe">
          <OneOf value={form.sex} options={[['F', 'Féminin'], ['M', 'Masculin']]} onChange={(sex) => set({ sex })} />
        </Input.Wrapper>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <Select data-testid="line-age" label="Catégorie d’âge" required data={ageBandChoices(form, ctx)} value={form.ageBandCode}
            onChange={(ageBandCode) => set({ ageBandCode })} />
          {/* Obligatoire pour un combat (le kata n'a pas de catégorie de poids). */}
          <Select data-testid="line-weight-class" label="Catégorie de poids" required={hasCombat} disabled={!classes.length}
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
              <Group gap={4} wrap="wrap">
                {combats.map(([d, label]) => (
                  <Chip key={d} size="xs" checked={form.combats.includes(d)} onChange={() => set({ combats: toggleCombat(form, d, ctx) })}>{label}</Chip>
                ))}
              </Group>
            </div>
            {kataShown && (
              <Checkbox data-testid="line-kata" label={kataOpen ? 'Kata' : `Kata${NOT_OPEN}`} checked={form.kata} onChange={(e) => set({ kata: e.currentTarget.checked })} />
            )}
          </Stack>
        </Input.Wrapper>
        {nothingOpen && <Text size="sm" c="var(--sk-warn-text)" data-testid="line-nothing-open">Aucune catégorie ouverte pour cette tranche d’âge à cette compétition.</Text>}
        {hasCombat && (
          <Input.Wrapper label="Règlement" required labelElement="div" role="group" aria-label="Règlement">
            <OneOf value={form.ruleset} options={rulesets} onChange={(ruleset) => set({ ruleset })} />
          </Input.Wrapper>
        )}
        {form.kata && <TextInput data-testid="line-grade" label="Grade (pour le kata)" value={form.grade ?? ''} onChange={(e) => set({ grade: e.currentTarget.value || null })} />}
        <Checkbox data-testid="line-name-hidden" label="Masquer le nom sur la page publique" description="Le public voit « Combattant masqué » ; le club reste affiché."
          checked={nameHidden} onChange={(e) => setNameHidden(e.currentTarget.checked)} />
        {hasCombat && otherChoices.length > 0 && (
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
        <ApiErrorAlert error={ops.error} />
        <Group justify="space-between">
          {line ? (
            confirmDelete ? (
              <Group gap="xs">
                <Button color="red" data-testid="line-delete-confirm" loading={ops.pending} onClick={doDelete}>Confirmer la suppression</Button>
                <Button variant="subtle" onClick={() => setConfirmDelete(false)}>Garder</Button>
              </Group>
            ) : (
              <Button variant="subtle" color="red" data-testid="line-delete" onClick={() => setConfirmDelete(true)}>Supprimer</Button>
            )
          ) : <span />}
          <Group gap="xs">
            <Button variant="default" onClick={() => onClose()}>Annuler</Button>
            {footerExtra}
            <Button data-testid="line-save" loading={ops.pending} onClick={submit}>Enregistrer</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
