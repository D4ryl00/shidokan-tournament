import { Button, Checkbox, Group, Menu, Modal, Select, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { useState } from 'react';
import { normalizeName } from '../../domain/names.js';
import { plural } from '../../domain/plural.js';
import type { DirectoryEntry, DirectoryInput } from '../../domain/registration.js';
import { useCreateDirectoryEntry, useDirectory, useMergeDirectoryEntries, useUpdateDirectoryEntry } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { TableCard } from '../components/ui/TableCard.js';

const EMPTY: DirectoryInput = { name: '', affiliationNumber: null, coachName: null, coachPhone: null, coachEmail: null, notes: null };
const orNull = (v: string) => v.trim() || null;

/** Fenêtre de saisie d'une fiche (création ou modification). */
function EntryModal({ entry, onClose }: { entry: DirectoryEntry | 'new' | null; onClose: () => void }) {
  const create = useCreateDirectoryEntry();
  const update = useUpdateDirectoryEntry();
  // Le parent remonte la fenêtre (key) pour chaque fiche : l'état part de la fiche ouverte.
  const [form, setForm] = useState<DirectoryInput>(
    entry && entry !== 'new' ? { name: entry.name, affiliationNumber: entry.affiliationNumber, coachName: entry.coachName, coachPhone: entry.coachPhone, coachEmail: entry.coachEmail, notes: entry.notes } : EMPTY,
  );
  const set = (patch: Partial<DirectoryInput>) => setForm((f) => ({ ...f, ...patch }));
  const save = () => {
    const done = { onSuccess: onClose };
    if (entry === 'new') create.mutate(form, done);
    else if (entry) update.mutate({ id: entry.id, ...form }, done);
  };
  return (
    <Modal opened={entry !== null} onClose={onClose} title={entry === 'new' ? 'Ajouter un club' : 'Modifier le club'}>
      <Stack>
        <TextInput data-testid="directory-name" label="Nom" required value={form.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <TextInput data-testid="directory-number" label="N° d’affiliation FFK" description="Les chiffres en tête du club dans l’export FFK."
          value={form.affiliationNumber ?? ''} onChange={(e) => set({ affiliationNumber: orNull(e.currentTarget.value) })} />
        <TextInput label="Coach" value={form.coachName ?? ''} onChange={(e) => set({ coachName: orNull(e.currentTarget.value) })} />
        <TextInput label="Téléphone" value={form.coachPhone ?? ''} onChange={(e) => set({ coachPhone: orNull(e.currentTarget.value) })} />
        <TextInput data-testid="directory-email" label="E-mail" value={form.coachEmail ?? ''} onChange={(e) => set({ coachEmail: orNull(e.currentTarget.value) })} />
        <Textarea label="Notes" autosize minRows={2} value={form.notes ?? ''} onChange={(e) => set({ notes: orNull(e.currentTarget.value) })} />
        <ApiErrorAlert error={create.error ?? update.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Annuler</Button>
          <Button data-testid="directory-save" onClick={save} loading={create.isPending || update.isPending} disabled={!form.name.trim()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Fenêtre « Fusionner avec… » : la fiche `merged` disparaît au profit de celle choisie. */
function MergeModal({ merged, entries, onClose }: { merged: DirectoryEntry | null; entries: DirectoryEntry[]; onClose: () => void }) {
  const merge = useMergeDirectoryEntries();
  const [keepId, setKeepId] = useState<string | null>(null);
  const keep = entries.find((e) => e.id === keepId);
  const close = () => {
    setKeepId(null);
    merge.reset();
    onClose();
  };
  return (
    <Modal opened={merged !== null} onClose={close} title="Fusionner deux fiches du même club">
      {merged && (
        <Stack>
          <Select label="Fiche à garder" searchable data={entries.filter((e) => e.id !== merged.id).map((e) => ({ value: e.id, label: e.affiliationNumber ? `${e.name} (${e.affiliationNumber})` : e.name }))}
            value={keepId} onChange={setKeepId} />
          {keep && <Text size="sm">Les compétitions de « {merged.name} » passeront à « {keep.name} », puis « {merged.name} » sera supprimé.</Text>}
          <ApiErrorAlert error={merge.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Annuler</Button>
            <Button disabled={!keep} loading={merge.isPending} onClick={() => keep && merge.mutate({ keepId: keep.id, mergeId: merged.id }, { onSuccess: close })}>
              Fusionner
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

export function DirectoryPage() {
  const { data: entries = [], isLoading } = useDirectory();
  const update = useUpdateDirectoryEntry();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<DirectoryEntry | 'new' | null>(null);
  const [merging, setMerging] = useState<DirectoryEntry | null>(null);
  const key = normalizeName(search);
  const shown = entries.filter((e) => (showArchived || !e.archived) && (!key || normalizeName(e.name).includes(key) || (e.affiliationNumber ?? '').includes(search.trim())));

  const active = entries.filter((e) => !e.archived).length;
  return (
    <Stack gap="lg">
      <PageHeader title="Annuaire des clubs" help="annuaire"
        summary={entries.length > 0 ? `${plural(active, 'club')}${entries.length > active ? ` · ${plural(entries.length - active, 'archivé')}` : ''}` : undefined}
        actions={<Button data-testid="directory-new" onClick={() => setEditing('new')}>Ajouter un club</Button>} />
      <Group gap="md">
        <TextInput placeholder="Rechercher un nom ou un numéro" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={300} />
        <Checkbox label="Afficher les clubs archivés" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
      </Group>
      <ApiErrorAlert error={update.error} />
      {isLoading ? null : shown.length === 0 ? (
        entries.length === 0
          ? <EmptyState title="L’annuaire est vide" text="Les clubs s’y ajoutent à l’import FFK, ou à la main avec « Ajouter un club ». Il garde leurs coordonnées d’une compétition à l’autre." />
          : <EmptyState title="Aucun club ne correspond" text="Changez la recherche, ou affichez les clubs archivés." />
      ) : (
        <TableCard>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Club</Table.Th><Table.Th>N° d’affiliation</Table.Th><Table.Th>Coach</Table.Th><Table.Th>Téléphone</Table.Th>
                <Table.Th>E-mail</Table.Th><Table.Th ta="right">Compétitions</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((e) => (
                <Table.Tr key={e.id} data-testid="directory-row" c={e.archived ? 'dimmed' : undefined}>
                  <Table.Td fw={500}>
                    <Group gap="xs" wrap="nowrap">{e.name}{e.archived && <StatusBadge tone="neutral" size="sm">Archivé</StatusBadge>}</Group>
                  </Table.Td>
                  <Table.Td className="num">{e.affiliationNumber ?? '—'}</Table.Td>
                  <Table.Td>{e.coachName ?? '—'}</Table.Td>
                  <Table.Td className="num" style={{ whiteSpace: 'nowrap' }}>{e.coachPhone ?? '—'}</Table.Td>
                  <Table.Td>{e.coachEmail ?? '—'}</Table.Td>
                  <Table.Td ta="right" className="num">{e.competitions}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Button size="compact-sm" variant="subtle" onClick={() => setEditing(e)}>Modifier</Button>
                      <Menu position="bottom-end">
                        <Menu.Target><Button size="compact-sm" variant="subtle" color="gray" aria-label="Autres actions">…</Button></Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => update.mutate({ id: e.id, archived: !e.archived })}>{e.archived ? 'Désarchiver' : 'Archiver'}</Menu.Item>
                          <Menu.Item onClick={() => setMerging(e)}>Fusionner avec…</Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TableCard>
      )}
      <EntryModal key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id} entry={editing} onClose={() => setEditing(null)} />
      <MergeModal merged={merging} entries={entries} onClose={() => setMerging(null)} />
    </Stack>
  );
}
