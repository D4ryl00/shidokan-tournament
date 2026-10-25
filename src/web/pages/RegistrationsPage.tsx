import { ActionIcon, Button, Checkbox, Group, Modal, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { normalizeName } from '../../domain/names.js';
import { plural } from '../../domain/plural.js';
import { SOURCE_LABELS, type RegistrationRow } from '../../domain/registration.js';
import { useCategories, useDeleteRegistration, useGrid, useRegistrations } from '../api.js';
import { RegistrationForm } from '../components/RegistrationForm.js';
import { ReplacementBadge, useRecasementDetails } from '../components/ReplacementBadge.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { IconEdit, IconSearch, IconTrash } from '../components/ui/icons.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { DISCIPLINE_OPTIONS, ageBandLabel, disciplineLabel, prefsLabel, rulesetShort, weightLabel } from '../labels.js';
import { TableCard } from '../components/ui/TableCard.js';

export function RegistrationsPage() {
  const { id = '' } = useParams();
  const recasements = useRecasementDetails(id);
  const { data: rows = [], isLoading } = useRegistrations(id);
  const { data: grid } = useGrid(id);
  const { data: categories = [] } = useCategories(id);
  const remove = useDeleteRegistration(id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RegistrationRow | null>(null);
  const [deleting, setDeleting] = useState<RegistrationRow | null>(null);
  const [search, setSearch] = useState('');
  const [club, setClub] = useState<string | null>(null);
  const [discipline, setDiscipline] = useState<string | null>(null);
  const [age, setAge] = useState<string | null>(null);
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);

  const clubOptions = useMemo(
    () => [...new Map(rows.filter((r) => r.club).map((r) => [r.club!.id, r.club!.name])).entries()].map(([value, label]) => ({ value, label })),
    [rows],
  );
  const filtered = rows.filter(
    (r) =>
      (!search || normalizeName(`${r.fighter.lastName} ${r.fighter.firstName} ${r.club?.name ?? ''}`).includes(normalizeName(search))) &&
      (!club || r.club?.id === club) &&
      (!discipline || r.discipline === discipline) &&
      (!age || r.fighter.ageBandCode === age) &&
      (!onlyUnconfirmed || !r.ffkConfirmed),
  );

  const clubCount = new Set(rows.map((r) => r.club?.id).filter(Boolean)).size;
  const filteredOut = filtered.length !== rows.length;
  const tone = (r: RegistrationRow) => (r.source === 'onsite' ? 'warn' : r.source === 'online' ? 'accent' : 'neutral');

  return (
    <Stack gap="md">
      <PageHeader title={plural(rows.length, 'inscription')}
        summary={rows.length > 0 ? [plural(clubCount, 'club'), categories.length > 0 && plural(categories.length, 'catégorie')].filter(Boolean).join(' · ') : undefined}
        actions={<Button data-testid="registration-add" onClick={() => setAdding(true)}>Ajouter</Button>} />
      {isLoading ? null : rows.length === 0 ? (
        <EmptyState title="Aucune inscription pour l’instant"
          text="Elles arrivent par les inscriptions en ligne des clubs ou leurs fiches (onglet Fiche club), par l’import FFK, ou une à une avec « Ajouter »." />
      ) : (
      <>
      <Group gap="sm" wrap="wrap">
        <TextInput placeholder="Rechercher (nom, club)" leftSection={<IconSearch />} value={search} w={220} onChange={(e) => setSearch(e.currentTarget.value)} />
        <Select placeholder="Club" clearable searchable data={clubOptions} value={club} onChange={setClub} w={200} />
        <Select placeholder="Discipline" clearable data={DISCIPLINE_OPTIONS} value={discipline} onChange={setDiscipline} w={160} />
        <Select placeholder="Âge" clearable data={(grid?.ageBands ?? []).map((b) => ({ value: b.code, label: b.label }))} value={age} onChange={setAge} w={140} />
        <Checkbox data-testid="registrations-filter-unconfirmed" label="Sans inscription FFK" checked={onlyUnconfirmed}
          onChange={(e) => setOnlyUnconfirmed(e.currentTarget.checked)} />
      </Group>
      {filteredOut && <Text c="dimmed" size="sm" className="num">{filtered.length.toLocaleString('fr-FR')} sur {plural(rows.length, 'inscription')}</Text>}
      {filtered.length === 0 ? (
        <EmptyState title="Aucune inscription ne correspond" text="Changez la recherche ou retirez un filtre." />
      ) : (
      <TableCard>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Combattant</Table.Th><Table.Th>Club</Table.Th><Table.Th>Sexe</Table.Th>
              <Table.Th>Âge</Table.Th><Table.Th>Discipline</Table.Th><Table.Th>Règlement</Table.Th><Table.Th>Poids</Table.Th>
              <Table.Th>Préférences</Table.Th><Table.Th>Origine</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((r) => (
              <Table.Tr key={r.id} data-testid="registration-row">
                <Table.Td style={{ whiteSpace: 'nowrap' }}><Text span fw={600} size="sm">{r.fighter.lastName}</Text> <Text span size="sm">{r.fighter.firstName}</Text></Table.Td>
                <Table.Td><Text size="sm" miw={120} maw={220}>{r.club?.name ?? '—'}</Text></Table.Td>
                <Table.Td>{r.fighter.sex}</Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{ageBandLabel(grid, r.fighter.ageBandCode)}</Table.Td>
                <Table.Td>{disciplineLabel(r.discipline)}</Table.Td>
                <Table.Td>{rulesetShort(r.ruleset)}{r.acceptsJiyuFirst ? ' (jiyu ok)' : ''}</Table.Td>
                <Table.Td className="num" style={{ whiteSpace: 'nowrap' }}>{weightLabel(grid, r.weightClassId)}</Table.Td>
                <Table.Td c="dimmed">{prefsLabel(r.otherDisciplines)}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <StatusBadge tone={tone(r)}>{SOURCE_LABELS[r.source]}</StatusBadge>
                    {r.ffkConfirmed && <StatusBadge tone="ok" data-testid="registration-ffk-badge" title="Confirmée par l’export FFK">FFK ✓</StatusBadge>}
                    {r.recasementType && <ReplacementBadge type={r.recasementType} size="xs" detail={recasements.get(r.id)} />}
                    {r.withdrawn && <StatusBadge tone="neutral" data-testid="registration-withdrawn" title="Catégorie non ouverte : décidé en Réaffectation">Ne combat pas</StatusBadge>}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Group gap={2} wrap="nowrap" justify="flex-end">
                    <ActionIcon variant="subtle" color="gray" aria-label="Modifier" title="Modifier" onClick={() => setEditing(r)}><IconEdit /></ActionIcon>
                    <ActionIcon variant="subtle" color="red" aria-label="Supprimer" title="Supprimer" onClick={() => setDeleting(r)}><IconTrash /></ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </TableCard>
      )}
      </>
      )}

      <Modal opened={adding} onClose={() => setAdding(false)} title="Nouvelle inscription" size="xl">
        <RegistrationForm competitionId={id} />
      </Modal>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title="Modifier l’inscription" size="xl">
        {editing && <RegistrationForm competitionId={id} edit={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Supprimer l’inscription ?">
        <Stack>
          <Text>{deleting && `${deleting.fighter.lastName} ${deleting.fighter.firstName} — ${disciplineLabel(deleting.discipline)}`}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>Annuler</Button>
            <Button color="red" data-testid="registration-delete-confirm"
              onClick={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}>Supprimer</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
