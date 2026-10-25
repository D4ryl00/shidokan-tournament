import { ActionIcon, Button, Checkbox, Group, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { useParams } from 'react-router';
import { plural } from '../../domain/plural.js';
import type { Club } from '../../domain/registration.js';
import { useClubs, useRegistrations, useUpdateClub } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { IconEdit } from '../components/ui/icons.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { TableCard } from '../components/ui/TableCard.js';

type Field = 'name' | 'coachName' | 'coachPhone' | 'coachEmail';
const FIELDS: { field: Field; label: string }[] = [
  { field: 'name', label: 'Club' }, { field: 'coachName', label: 'Coach' }, { field: 'coachPhone', label: 'Téléphone' }, { field: 'coachEmail', label: 'E-mail' },
];

/** Fenêtre de modification d'un club : seuls les champs changés sont envoyés (le nom ne peut pas être vidé). */
function ClubModal({ competitionId, club, onClose }: { competitionId: string; club: Club | null; onClose: () => void }) {
  const update = useUpdateClub(competitionId);
  // Le parent remonte la fenêtre (key) pour chaque club : l'état part du club ouvert.
  const [form, setForm] = useState<Record<Field, string>>({
    name: club?.name ?? '', coachName: club?.coachName ?? '', coachPhone: club?.coachPhone ?? '', coachEmail: club?.coachEmail ?? '',
  });
  if (!club) return null;
  const patch = Object.fromEntries(
    FIELDS.map(({ field }) => [field, form[field].trim()]).filter(([field, v]) => v !== (club[field as Field] ?? '')).map(([field, v]) => [field, v || null]),
  );
  return (
    <Modal opened onClose={onClose} title="Modifier le club">
      <Stack>
        {FIELDS.map(({ field, label }) => (
          <TextInput key={field} label={label} required={field === 'name'} value={form[field]} data-testid={`club-edit-${field}`}
            onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, [field]: v })); }} />
        ))}
        <ApiErrorAlert error={update.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Annuler</Button>
          <Button data-testid="club-edit-save" loading={update.isPending} disabled={!form.name.trim()}
            onClick={() => (Object.keys(patch).length === 0 ? onClose() : update.mutate({ clubId: club.id, ...patch }, { onSuccess: onClose }))}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ClubsPage() {
  const { id = '' } = useParams();
  const { data: clubs = [], isLoading } = useClubs(id);
  const { data: rows = [] } = useRegistrations(id);
  const update = useUpdateClub(id);
  const [editing, setEditing] = useState<Club | null>(null);
  const count = (clubId: string) => rows.filter((r) => r.club?.id === clubId).length;
  const preApproved = clubs.filter((c) => c.preApproval).length;

  return (
    <Stack gap="md">
      <PageHeader title={plural(clubs.length, 'club')} summary={clubs.length > 0 ? `${plural(preApproved, 'club')} avec pré-accord du coach` : undefined} />
      {isLoading ? null : clubs.length === 0 ? (
        <EmptyState title="Aucun club pour l’instant" text="Les clubs sont créés par les inscriptions : en ligne, par l’import des fiches ou de l’export FFK, ou à la saisie d’une inscription." />
      ) : (
        <TableCard>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Club</Table.Th><Table.Th>Coach</Table.Th><Table.Th>Téléphone</Table.Th><Table.Th>E-mail</Table.Th>
                <Table.Th>Pré-accord</Table.Th><Table.Th ta="right">Inscriptions</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {clubs.map((c) => (
                <Table.Tr key={c.id} data-testid="club-row">
                  <Table.Td fw={600}>{c.name}</Table.Td>
                  <Table.Td>{c.coachName ?? <Text span c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td className="num" style={{ whiteSpace: 'nowrap' }}>{c.coachPhone ?? <Text span c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td>{c.coachEmail ?? <Text span c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td>
                    <Checkbox data-testid="club-preapproval" aria-label={`Pré-accord de ${c.name}`} checked={c.preApproval}
                      onChange={(e) => update.mutate({ clubId: c.id, preApproval: e.currentTarget.checked })} />
                  </Table.Td>
                  <Table.Td ta="right" className="num">{count(c.id)}</Table.Td>
                  <Table.Td ta="right">
                    <ActionIcon variant="subtle" color="gray" aria-label={`Modifier ${c.name}`} title="Modifier" data-testid="club-edit" onClick={() => setEditing(c)}><IconEdit /></ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TableCard>
      )}
      <ApiErrorAlert error={update.error} />
      <ClubModal key={editing?.id ?? 'closed'} competitionId={id} club={editing} onClose={() => setEditing(null)} />
    </Stack>
  );
}
