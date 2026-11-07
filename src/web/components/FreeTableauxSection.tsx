import { Alert, Button, Group, Loader, Modal, NativeSelect, Stack, Table, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { FREE_NAME_MAX, isFreeKey, type Category } from '../../domain/categories.js';
import { DISCIPLINES, RULESETS } from '../../domain/disciplines.js';
import { plural } from '../../domain/plural.js';
import type { DisciplineId, Ruleset } from '../../domain/types.js';
import { WAVE_NONE } from '../../domain/waves.js';
import { useCategories, useCreateFreeTableau, useDeleteFreeTableau, useUpdateCategory, useUpdateFreeTableau, useWaves } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { EmptyState } from './ui/EmptyState.js';

const DISCIPLINE_OPTIONS = (Object.entries(DISCIPLINES) as [DisciplineId, { label: string }][]).map(([value, d]) => ({ value, label: d.label }));
const RULESET_OPTIONS = (Object.entries(RULESETS) as [Ruleset, { label: string }][]).map(([value, r]) => ({ value, label: r.label }));
const LOCKED_NOTE = 'Tableau verrouillé : déverrouillez-le dans l’onglet Tableaux pour le modifier.';

type Draft = { cid: string | null; name: string; discipline: DisciplineId; ruleset: Ruleset | null };
const NEW_DRAFT: Draft = { cid: null, name: '', discipline: 'karate', ruleset: 'jiyu' };

const isLocked = (c: Category) => c.launchLocked || c.status === 'started' || c.status === 'finished';

/** Tableaux libres de la compétition : liste, ajout, modification (nom, discipline, règlement), session, suppression. */
export function FreeTableauxSection({ competitionId }: { competitionId: string }) {
  const { data: categories } = useCategories(competitionId);
  const { data: waves = [] } = useWaves(competitionId);
  const create = useCreateFreeTableau(competitionId);
  const update = useUpdateFreeTableau(competitionId);
  const remove = useDeleteFreeTableau(competitionId);
  const setWave = useUpdateCategory(competitionId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const free = (categories ?? []).filter((c) => isFreeKey(c.key));
  const editing = draft?.cid ? free.find((c) => c.id === draft.cid) : undefined;
  const locked = !!editing && isLocked(editing);

  const close = () => { setDraft(null); create.reset(); update.reset(); };
  const save = () => {
    if (!draft) return;
    const ruleset = DISCIPLINES[draft.discipline].hasWeight ? draft.ruleset ?? 'jiyu' : null;
    const done = { onSuccess: close };
    if (draft.cid === null) create.mutate({ name: draft.name, discipline: draft.discipline, ruleset }, done);
    else if (!locked) update.mutate({ cid: draft.cid, name: draft.name, discipline: draft.discipline, ruleset }, done);
  };
  const waveValue = (c: Category) => (c.waveOverride === WAVE_NONE || c.waveOverride === null ? WAVE_NONE : c.waveOverride);
  const returned = deleting ? deleting.registrationIds.length : 0; // inscrits placés dans le tableau : ceux qui retournent

  return (
    <Stack gap="sm">
      <ApiErrorAlert error={setWave.error} />
      {/* Pas d'« Aucun tableau libre » tant que les catégories ne sont pas chargées. */}
      {!categories ? (
        <Loader size="sm" />
      ) : free.length === 0 ? (
        <EmptyState data-testid="free-none" title="Aucun tableau libre" text="Ajoutez-en un pour y placer des combattants à la main." />
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table className="sk-cell">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nom</Table.Th><Table.Th>Discipline</Table.Th><Table.Th>Règlement</Table.Th>
                <Table.Th>Session</Table.Th><Table.Th>Combattants</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {free.map((c) => (
                <Table.Tr key={c.id} data-testid="free-tableau">
                  <Table.Td fw={500}>{c.key.free}</Table.Td>
                  <Table.Td>{DISCIPLINES[c.key.discipline].label}</Table.Td>
                  <Table.Td>{c.key.ruleset ? RULESETS[c.key.ruleset].label : '—'}</Table.Td>
                  <Table.Td>
                    <NativeSelect size="xs" w={150} aria-label={`Session de ${c.key.free}`} value={waveValue(c)} disabled={c.launchLocked}
                      data={[{ value: WAVE_NONE, label: 'En attente' }, ...waves.map((w) => ({ value: w.id, label: w.name }))]}
                      onChange={(e) => setWave.mutate({ cid: c.id, waveOverride: e.currentTarget.value })} />
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{plural(c.registrationIds.length, 'combattant')}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap" justify="flex-end">
                      <Button size="compact-sm" variant="default" onClick={() => setDraft({ cid: c.id, name: c.key.free ?? '', discipline: c.key.discipline, ruleset: c.key.ruleset })}>Modifier</Button>
                      <Button size="compact-sm" variant="default" color="red" disabled={isLocked(c)} onClick={() => setDeleting(c)}>Supprimer</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Group>
        <Button variant="default" onClick={() => setDraft(NEW_DRAFT)}>Ajouter un tableau libre</Button>
      </Group>

      <Modal opened={draft !== null} onClose={close} title={draft?.cid ? 'Modifier le tableau libre' : 'Ajouter un tableau libre'}>
        {draft && (
          <Stack>
            {locked && <Alert color="yellow">{LOCKED_NOTE}</Alert>}
            <TextInput label="Nom du tableau" disabled={locked} maxLength={FREE_NAME_MAX} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} data-autofocus />
            <NativeSelect label="Discipline" disabled={locked} data={DISCIPLINE_OPTIONS} value={draft.discipline}
              onChange={(e) => {
                const discipline = e.currentTarget.value as DisciplineId;
                setDraft({ ...draft, discipline, ruleset: DISCIPLINES[discipline].hasWeight ? draft.ruleset ?? 'jiyu' : null });
              }} />
            {DISCIPLINES[draft.discipline].hasWeight && (
              <NativeSelect label="Règlement" disabled={locked} data={RULESET_OPTIONS} value={draft.ruleset ?? 'jiyu'}
                onChange={(e) => setDraft({ ...draft, ruleset: e.currentTarget.value as Ruleset })} />
            )}
            <ApiErrorAlert error={create.error ?? update.error} />
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>Annuler</Button>
              <Button onClick={save} loading={create.isPending || update.isPending} disabled={locked}>Enregistrer</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={deleting !== null} onClose={() => { setDeleting(null); remove.reset(); }} title={`Supprimer le tableau libre « ${deleting?.key.free ?? ''} » ?`}>
        <Stack>
          <Text size="sm">
            {returned === 0 ? 'Aucun combattant à renvoyer : le tableau est vide.'
              : `${plural(returned, 'combattant')} ${returned > 1 ? 'retourneront' : 'retournera'} dans leur catégorie précédente.`}
          </Text>
          <ApiErrorAlert error={remove.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setDeleting(null); remove.reset(); }}>Annuler</Button>
            <Button color="red" onClick={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })} loading={remove.isPending}>Supprimer le tableau</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
