import { ActionIcon, Badge, Button, Checkbox, Group, Modal, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { normalizeName } from '../../domain/names.js';
import { SOURCE_LABELS, type RegistrationRow } from '../../domain/registration.js';
import { useDeleteRegistration, useGrid, useRegistrations } from '../api.js';
import { RegistrationForm } from '../components/RegistrationForm.js';
import { ReplacementBadge, useRecasementDetails } from '../components/ReplacementBadge.js';
import { DISCIPLINE_OPTIONS, ageBandLabel, disciplineLabel, prefsLabel, rulesetShort, weightLabel } from '../labels.js';

export function RegistrationsPage() {
  const { id = '' } = useParams();
  const recasements = useRecasementDetails(id);
  const { data: rows = [] } = useRegistrations(id);
  const { data: grid } = useGrid(id);
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

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <TextInput placeholder="Rechercher (nom, club)" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Select placeholder="Club" clearable data={clubOptions} value={club} onChange={setClub} />
          <Select placeholder="Discipline" clearable data={DISCIPLINE_OPTIONS} value={discipline} onChange={setDiscipline} />
          <Checkbox data-testid="registrations-filter-unconfirmed" label="Sans inscription FFK" checked={onlyUnconfirmed}
            onChange={(e) => setOnlyUnconfirmed(e.currentTarget.checked)} />
          <Select placeholder="Âge" clearable data={(grid?.ageBands ?? []).map((b) => ({ value: b.code, label: b.label }))} value={age} onChange={setAge} />
        </Group>
        <Button data-testid="registration-add" onClick={() => setAdding(true)}>Ajouter</Button>
      </Group>
      <Text c="dimmed" size="sm">{filtered.length} inscription(s) sur {rows.length}</Text>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Nom</Table.Th><Table.Th>Prénom</Table.Th><Table.Th>Club</Table.Th><Table.Th>Sexe</Table.Th>
            <Table.Th>Âge</Table.Th><Table.Th>Discipline</Table.Th><Table.Th>Règlement</Table.Th><Table.Th>Poids</Table.Th>
            <Table.Th>Préférences</Table.Th><Table.Th>Origine</Table.Th><Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filtered.map((r) => (
            <Table.Tr key={r.id} data-testid="registration-row">
              <Table.Td>{r.fighter.lastName}</Table.Td>
              <Table.Td>{r.fighter.firstName}</Table.Td>
              <Table.Td>{r.club?.name ?? '—'}</Table.Td>
              <Table.Td>{r.fighter.sex}</Table.Td>
              <Table.Td>{ageBandLabel(grid, r.fighter.ageBandCode)}</Table.Td>
              <Table.Td>{disciplineLabel(r.discipline)}</Table.Td>
              <Table.Td>{rulesetShort(r.ruleset)}{r.acceptsJiyuFirst ? ' (jiyu ok)' : ''}</Table.Td>
              <Table.Td>{weightLabel(grid, r.weightClassId)}</Table.Td>
              <Table.Td>{prefsLabel(r.otherDisciplines)}</Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  <Badge variant="light" color={r.source === 'onsite' ? 'orange' : 'gray'}>{SOURCE_LABELS[r.source]}</Badge>
                  {r.ffkConfirmed && <Badge variant="light" color="green" data-testid="registration-ffk-badge">FFK ✓</Badge>}
                  {r.recasementType && <ReplacementBadge type={r.recasementType} size="xs" detail={recasements.get(r.id)} />}
                </Group>
              </Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  <ActionIcon variant="subtle" aria-label="Modifier" onClick={() => setEditing(r)}>✎</ActionIcon>
                  <ActionIcon variant="subtle" color="red" aria-label="Supprimer" onClick={() => setDeleting(r)}>✕</ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={adding} onClose={() => setAdding(false)} title="Nouvelle inscription" size="xl">
        <RegistrationForm competitionId={id} />
      </Modal>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title="Modifier l'inscription" size="xl">
        {editing && <RegistrationForm competitionId={id} edit={editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Supprimer l'inscription ?">
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
