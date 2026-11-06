import { ActionIcon, Button, Checkbox, Group, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { useParams } from 'react-router';
import { ofName, plural } from '../../domain/plural.js';
import type { Club } from '../../domain/registration.js';
import { useClubChanges, useClubs, useFetchClubChanges, useRegistrations, useUpdateClub } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ClubChangePill } from '../components/club-changes/ClubChangeBanners.js';
import { useClubChangeDialog } from '../components/club-changes/ClubChangeModal.js';
import { EmailsInput, EmailsList } from '../components/EmailsInput.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { IconEdit } from '../components/ui/icons.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { TableCard } from '../components/ui/TableCard.js';

type Field = 'name' | 'coachName' | 'coachPhone';
const FIELDS: { field: Field; label: string }[] = [
  { field: 'name', label: 'Club' }, { field: 'coachName', label: 'Coach' }, { field: 'coachPhone', label: 'Téléphone' },
];

/** Fenêtre de modification d'un club : seuls les champs changés sont envoyés (le nom ne peut pas être vidé). */
function ClubModal({ competitionId, club, onClose, onSaved }: { competitionId: string; club: Club | null; onClose: () => void; onSaved: (clubId: string) => void }) {
  const update = useUpdateClub(competitionId);
  // Le parent remonte la fenêtre (key) pour chaque club : l'état part du club ouvert.
  const [form, setForm] = useState<Record<Field, string>>({
    name: club?.name ?? '', coachName: club?.coachName ?? '', coachPhone: club?.coachPhone ?? '',
  });
  const [emails, setEmails] = useState<string[]>(club?.coachEmails ?? []);
  if (!club) return null;
  const patch = {
    ...Object.fromEntries(
      FIELDS.map(({ field }) => [field, form[field].trim()]).filter(([field, v]) => v !== (club[field as Field] ?? '')).map(([field, v]) => [field, v || null]),
    ),
    ...(emails.join('\n') !== club.coachEmails.join('\n') ? { coachEmails: emails } : {}),
  };
  return (
    <Modal opened onClose={onClose} title="Modifier le club">
      <Stack>
        {FIELDS.map(({ field, label }) => (
          <TextInput key={field} label={label} required={field === 'name'} value={form[field]} data-testid={`club-edit-${field}`}
            onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, [field]: v })); }} />
        ))}
        <EmailsInput value={emails} onChange={setEmails} data-testid="club-edit-coachEmails" />
        <ApiErrorAlert error={update.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Annuler</Button>
          <Button data-testid="club-edit-save" loading={update.isPending} disabled={!form.name.trim()}
            // `mutateAsync` : fermée (Annuler, croix) pendant l'enregistrement, la fenêtre est remontée et un rappel de `mutate` serait perdu ; le club est
            // pourtant enregistré, et la page doit encore dire s'il diffère de l'annuaire. Un refus reste affiché dans la fenêtre (erreur de la mutation).
            onClick={() => (Object.keys(patch).length === 0 ? onClose() : update.mutateAsync({ clubId: club.id, ...patch }).then(() => { onClose(); onSaved(club.id); }, () => {}))}>
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
  const { data: changes = [] } = useClubChanges(id);
  const fetchChanges = useFetchClubChanges(id);
  const comparison = useClubChangeDialog(changes);
  const [editing, setEditing] = useState<Club | null>(null);
  // Les notifications « Comparer » de cette page disparaissent avec elle : son bouton ouvrirait une fenêtre qui n'est plus là.
  const shownKeys = useRef(new Set<string>());
  useEffect(() => { const keys = shownKeys.current; return () => keys.forEach((k) => notifications.hide(k)); }, []);
  const changeOf = (clubId: string) => changes.find((x) => x.clubId === clubId);
  const count = (clubId: string) => rows.filter((r) => r.club?.id === clubId).length;
  // Après un enregistrement : si le club diffère maintenant de l'annuaire, l'organisateur peut comparer tout de suite.
  const afterSave = async (clubId: string) => {
    const change = (await fetchChanges().catch(() => [])).find((c) => c.clubId === clubId);
    if (!change) return;
    const key = `club-change-${clubId}`;
    shownKeys.current.add(key);
    notifications.show({
      id: key, color: 'yellow', autoClose: 15_000,
      message: (
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{change.values.name} diffère de l’annuaire.</Text>
          <Button size="compact-sm" variant="default" onClick={() => { notifications.hide(key); comparison.open(clubId); }}>Comparer</Button>
        </Group>
      ),
    });
  };
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
                <Table.Th>Club</Table.Th><Table.Th>Coach</Table.Th><Table.Th>Téléphone</Table.Th><Table.Th>E-mails</Table.Th>
                <Table.Th>Pré-accord</Table.Th><Table.Th ta="right">Inscriptions</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {clubs.map((c) => {
                const change = changeOf(c.id);
                return (
                <Table.Tr key={c.id} data-testid="club-row">
                  <Table.Td fw={600}>
                    <Group gap="xs" wrap="wrap">
                      {c.name}
                      {change && <ClubChangePill origin={change.origin} />}
                    </Group>
                  </Table.Td>
                  <Table.Td>{c.coachName ?? <Text span c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td className="num" style={{ whiteSpace: 'nowrap' }}>{c.coachPhone ?? <Text span c="dimmed" size="sm">—</Text>}</Table.Td>
                  <Table.Td><EmailsList emails={c.coachEmails} /></Table.Td>
                  <Table.Td>
                    <Checkbox data-testid="club-preapproval" aria-label={`Pré-accord ${ofName(c.name)}`} checked={c.preApproval}
                      onChange={(e) => update.mutate({ clubId: c.id, preApproval: e.currentTarget.checked })} />
                  </Table.Td>
                  <Table.Td ta="right" className="num">{count(c.id)}</Table.Td>
                  <Table.Td ta="right">
                    <ActionIcon variant="subtle" color="gray" aria-label={`Modifier ${c.name}`} title="Modifier" data-testid="club-edit" onClick={() => setEditing(c)}><IconEdit /></ActionIcon>
                  </Table.Td>
                </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </TableCard>
      )}
      <ApiErrorAlert error={update.error} />
      <ClubModal key={editing?.id ?? 'closed'} competitionId={id} club={editing} onClose={() => setEditing(null)} onSaved={afterSave} />
      {comparison.element}
    </Stack>
  );
}
