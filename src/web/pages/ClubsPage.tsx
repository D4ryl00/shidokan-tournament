import { Checkbox, Table, Text, TextInput } from '@mantine/core';
import { useParams } from 'react-router';
import type { Club } from '../../domain/registration.js';
import { useClubs, useRegistrations, useUpdateClub } from '../api.js';

type Field = 'name' | 'coachName' | 'coachPhone' | 'coachEmail';

export function ClubsPage() {
  const { id = '' } = useParams();
  const { data: clubs = [] } = useClubs(id);
  const { data: rows = [] } = useRegistrations(id);
  const update = useUpdateClub(id);
  const count = (clubId: string) => rows.filter((r) => r.club?.id === clubId).length;

  const cell = (club: Club, field: Field) => (
    <TextInput key={`${club.id}-${field}-${club[field] ?? ''}`} defaultValue={club[field] ?? ''} aria-label={field}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (v !== (club[field] ?? '') && (field !== 'name' || v)) update.mutate({ clubId: club.id, [field]: v || null });
      }} />
  );

  if (clubs.length === 0) return <Text c="dimmed">Aucun club : ils sont créés par l'import des fiches ou la saisie des inscriptions.</Text>;
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Club</Table.Th><Table.Th>Coach</Table.Th><Table.Th>Téléphone</Table.Th><Table.Th>E-mail</Table.Th>
          <Table.Th>Pré-accord</Table.Th><Table.Th>Inscriptions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {clubs.map((c) => (
          <Table.Tr key={c.id} data-testid="club-row">
            <Table.Td>{cell(c, 'name')}</Table.Td>
            <Table.Td>{cell(c, 'coachName')}</Table.Td>
            <Table.Td>{cell(c, 'coachPhone')}</Table.Td>
            <Table.Td>{cell(c, 'coachEmail')}</Table.Td>
            <Table.Td>
              <Checkbox data-testid="club-preapproval" aria-label="Pré-accord" checked={c.preApproval}
                onChange={(e) => update.mutate({ clubId: c.id, preApproval: e.currentTarget.checked })} />
            </Table.Td>
            <Table.Td>{count(c.id)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
