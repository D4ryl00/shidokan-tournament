import { Button, Checkbox, Group, Modal, NativeSelect, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState } from 'react';
import type { ClubFormLine } from '../../domain/club-form.js';
import { ApiError, useDeleteClubLine, useSaveClubLine, type ClubLine } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { COMBATS, OneOf, PREFS } from './PaperEntryTable.js';

export const EMPTY_LINE: ClubFormLine = {
  lastName: '', firstName: '', sex: null, ageBandCode: null, weightKg: null, combat: null, kata: false, grade: null, ruleset: null, prefs: {}, shobuKeep: null,
};

/** Formulaire d'un seul combattant de la page du club (création : `line` null). */
export function ClubLineForm({ token, line, ageBands, opened, onClose }: {
  token: string;
  line: ClubLine | null;
  ageBands: { code: string; label: string }[];
  opened: boolean;
  onClose: (message?: string) => void;
}) {
  const mobile = useMediaQuery('(max-width: 600px)');
  const save = useSaveClubLine(token);
  const remove = useDeleteClubLine(token);
  const [form, setForm] = useState<ClubFormLine>(EMPTY_LINE);
  const [weight, setWeight] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shownFor, setShownFor] = useState<ClubLine | null | undefined>(undefined);
  if (opened && shownFor !== line) {
    setShownFor(line);
    setForm(line?.line ?? EMPTY_LINE);
    setWeight(line?.line.weightKg !== null && line?.line.weightKg !== undefined ? String(line.line.weightKg).replace('.', ',') : '');
    setConfirmDelete(false);
    save.reset();
    remove.reset();
  }
  if (!opened && shownFor !== undefined) setShownFor(undefined);

  const set = (patch: Partial<ClubFormLine>) => setForm((f) => ({ ...f, ...patch }));
  // Un refus parce que la ligne a changé entre-temps (ou que les inscriptions sont closes) ferme le formulaire : la liste est rechargée.
  const onError = (e: Error) => {
    if (e instanceof ApiError && (e.status === 409 || e.status === 403)) onClose(e.message);
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
          <OneOf value={form.combat} options={COMBATS} onChange={(combat) => set({ combat })} />
        </Stack>
        <Checkbox data-testid="line-kata" label="Kata" checked={form.kata} onChange={(e) => set({ kata: e.currentTarget.checked })} />
        {form.combat && (
          <Stack gap={4} role="group" aria-label="Règlement">
            <Text size="sm" fw={500}>Règlement</Text>
            <OneOf value={form.ruleset} options={[['jiyu', 'Jiyu'], ['shobu', 'Shobu']]} onChange={(ruleset) => set({ ruleset })} />
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
