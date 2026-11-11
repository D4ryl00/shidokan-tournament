import { Button, Checkbox, Group, Menu, Modal, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link } from 'react-router';
import { normalizeName } from '../../domain/names.js';
import { plural } from '../../domain/plural.js';
import type { DirectoryEntry, DirectoryInput } from '../../domain/registration.js';
import { fetchDirectoryUpcoming, useAppSettings, useAuthMe, useClubChanges, useCreateDirectoryEntry, useDirectory, useMergeDirectoryEntries, useUpdateDirectoryEntry, type UpcomingLine } from '../api.js';
import { useDocumentTitle } from '../documentTitle.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ClubEntryModal } from '../components/club-picker/ClubEntryModal.js';
import { ClubChangePill, DirectoryChangesBanner } from '../components/club-changes/ClubChangeBanners.js';
import { ApplyToClubsModal } from '../components/club-changes/ApplyToClubsModal.js';
import { useClubChangeDialog } from '../components/club-changes/ClubChangeModal.js';
import { EmailsList } from '../components/EmailsInput.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { TableCard } from '../components/ui/TableCard.js';

/** Fenêtre de la fiche ouverte (création ou modification) ; après une modification, la page propose de reporter la fiche sur les compétitions à venir. */
function EntryModal({ entry, onClose, onUpcoming }: { entry: DirectoryEntry | 'new' | null; onClose: () => void; onUpcoming: (entryId: string, lines: UpcomingLine[]) => void }) {
  const create = useCreateDirectoryEntry();
  const update = useUpdateDirectoryEntry();
  // `mutateAsync` et non les rappels de `mutate` : fermée (Annuler, croix) pendant l'enregistrement, la fenêtre est remontée et un rappel de `mutate` serait
  // perdu ; la fiche est pourtant enregistrée, et la page doit encore proposer le report.
  const submit = (input: DirectoryInput): Promise<{ id: string; upcoming: UpcomingLine[] } | null> =>
    entry && entry !== 'new' ? update.mutateAsync({ id: entry.id, ...input }) : create.mutateAsync(input).then(() => null);
  return (
    <ClubEntryModal opened={entry !== null} title={entry === 'new' ? 'Ajouter un club' : 'Modifier le club'} onClose={onClose} onSubmit={submit}
      // Après la fermeture : la proposition de report s'ouvre une fois la fiche fermée.
      onSaved={(saved) => saved && onUpcoming(saved.id, saved.upcoming)}
      initial={entry && entry !== 'new' ? { name: entry.name, affiliationNumber: entry.affiliationNumber, coachName: entry.coachName, coachPhone: entry.coachPhone, coachEmails: entry.coachEmails, notes: entry.notes } : undefined} />
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
  useDocumentTitle('Annuaire');
  const { data: entries = [], isLoading } = useDirectory();
  const update = useUpdateDirectoryEntry();
  const { data: settings } = useAppSettings();
  const { data: me } = useAuthMe();
  const { data: changes = [] } = useClubChanges();
  const comparison = useClubChangeDialog(changes);
  // Synchronisation : sur le serveur en ligne seulement, là où Google est disponible, avec un compte connecté (quel que soit le mode d'envoi des mails).
  const canSync = me?.role === 'serveur' && !!settings?.googleAvailable && !!settings.google;
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<DirectoryEntry | 'new' | null>(null);
  const [merging, setMerging] = useState<DirectoryEntry | null>(null);
  const [applying, setApplying] = useState<{ entryId: string; lines: UpcomingLine[]; intro?: string } | null>(null);
  // Fiche déjà à jour (synchronisation Google, décision passée) : ses différences restées avec les clubs des compétitions à venir.
  const askUpcoming = (e: DirectoryEntry) =>
    fetchDirectoryUpcoming(e.id).then(
      (lines) => lines.length > 0
        ? setApplying({ entryId: e.id, lines, intro: `Ces clubs de compétitions à venir diffèrent de la fiche « ${e.name} ». Choisissez « Prendre l’annuaire » pour y reporter la fiche.` })
        : notifications.show({ message: `Aucun club d’une compétition à venir ne diffère de la fiche « ${e.name} ».` }),
      (err: unknown) => notifications.show({ color: 'red', message: err instanceof Error ? err.message : String(err) }),
    );
  const key = normalizeName(search);
  const shown = entries.filter((e) => (showArchived || !e.archived) && (!key || normalizeName(e.name).includes(key) || (e.affiliationNumber ?? '').includes(search.trim())));

  const active = entries.filter((e) => !e.archived).length;
  return (
    <Stack gap="lg">
      <PageHeader title="Annuaire des clubs" help={me?.role === 'serveur' ? 'annuaire' : 'annuaire.pc'}
        summary={entries.length > 0 ? `${plural(active, 'club')}${entries.length > active ? ` · ${plural(entries.length - active, 'archivé')}` : ''}` : undefined}
        actions={<>
          {canSync && <Button variant="default" component={Link} to="/annuaire/google">Synchroniser avec Google</Button>}
          <Button data-testid="directory-new" onClick={() => setEditing('new')}>Ajouter un club</Button>
        </>} />
      <DirectoryChangesBanner onOpen={() => comparison.openFirst()} />
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
                <Table.Th>E-mails</Table.Th><Table.Th ta="right">Compétitions</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((e) => {
                const change = changes.find((c) => c.directoryId === e.id);
                return (
                <Table.Tr key={e.id} data-testid="directory-row" c={e.archived ? 'dimmed' : undefined}>
                  <Table.Td fw={500}>
                    <Group gap="xs" wrap="wrap">
                      {e.name}
                      {e.googleContactId && <StatusBadge tone="accent" size="sm" title="Lié à un contact Google">Google</StatusBadge>}
                      {e.archived && <StatusBadge tone="neutral" size="sm">Archivé</StatusBadge>}
                      {change && <ClubChangePill origin={change.origin} />}
                    </Group>
                  </Table.Td>
                  <Table.Td className="num">{e.affiliationNumber ?? '—'}</Table.Td>
                  <Table.Td>{e.coachName ?? '—'}</Table.Td>
                  <Table.Td className="num" style={{ whiteSpace: 'nowrap' }}>{e.coachPhone ?? '—'}</Table.Td>
                  <Table.Td><EmailsList emails={e.coachEmails} /></Table.Td>
                  <Table.Td ta="right" className="num">{e.competitions}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      {/* Tous les changements de la fiche, compétition par compétition. */}
                      {change && <Button size="compact-sm" variant="light" onClick={() => comparison.openFirst(e.id)}>Comparer</Button>}
                      <Button size="compact-sm" variant="subtle" onClick={() => setEditing(e)}>Modifier</Button>
                      <Menu position="bottom-end">
                        <Menu.Target><Button size="compact-sm" variant="subtle" color="gray" aria-label="Autres actions">…</Button></Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => update.mutate({ id: e.id, archived: !e.archived })}>{e.archived ? 'Désarchiver' : 'Archiver'}</Menu.Item>
                          {!e.archived && e.competitions > 0 && <Menu.Item onClick={() => void askUpcoming(e)}>Appliquer aux compétitions à venir…</Menu.Item>}
                          <Menu.Item onClick={() => setMerging(e)}>Fusionner avec…</Menu.Item>
                          {e.googleContactId && <Menu.Item onClick={() => update.mutate({ id: e.id, googleContactId: null })}>Ne plus synchroniser avec Google</Menu.Item>}
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  </Table.Td>
                </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </TableCard>
      )}
      <EntryModal key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id} entry={editing} onClose={() => setEditing(null)}
        onUpcoming={(entryId, lines) => lines.length > 0 && setApplying({ entryId, lines })} />
      {applying && <ApplyToClubsModal key={applying.entryId} entryId={applying.entryId} lines={applying.lines} intro={applying.intro} onClose={() => setApplying(null)} />}
      {comparison.element}
      <MergeModal merged={merging} entries={entries} onClose={() => setMerging(null)} />
    </Stack>
  );
}
