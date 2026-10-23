import { Alert, Button, Checkbox, CopyButton, Group, Modal, Stack, Table, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import {
  useClubEntrySettings,
  useDirectory,
  useInvitations,
  useInviteClubs,
  useRegenerateInvitation,
  useRevokeInvitation,
  useUpdateClubEntrySettings,
  type InvitationLink,
} from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { SectionHeader } from './Help.js';

const day = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('fr-FR') : '—');
export const clubEntryUrl = (token: string) => `${window.location.origin}/inscription/${token}`;

/** État des inscriptions en ligne, tel qu'affiché à l'organisateur et au club. */
export function clubEntryStatusText(status: 'closed' | 'open' | 'frozen', deadline: string | null): string {
  if (status !== 'open') return 'Inscriptions closes : contactez l’organisateur.';
  return deadline ? `Inscriptions ouvertes jusqu’au ${day(deadline)}` : 'Inscriptions ouvertes';
}

/** Liens tout juste créés : ils ne seront plus affichés ensuite. */
function LinksModal({ links, onClose }: { links: InvitationLink[]; onClose: () => void }) {
  return (
    <Modal opened={links.length > 0} onClose={onClose} title="Liens créés" size="xl">
      <Stack data-testid="invitation-links">
        <Alert color="yellow">Copiez ces liens maintenant : pour des raisons de sécurité, ils ne seront plus affichés.</Alert>
        {links.map((l) => (
          <Group key={l.clubId} justify="space-between" wrap="nowrap" data-testid="invitation-link">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={600}>{l.clubName}</Text>
              <Text size="sm" style={{ wordBreak: 'break-all' }} data-testid="invitation-url">{clubEntryUrl(l.token)}</Text>
            </Stack>
            <CopyButton value={clubEntryUrl(l.token)}>
              {({ copied, copy }) => <Button size="xs" variant={copied ? 'filled' : 'light'} onClick={copy}>{copied ? 'Copié' : 'Copier le lien'}</Button>}
            </CopyButton>
          </Group>
        ))}
      </Stack>
    </Modal>
  );
}

export function OnlineEntryPanel({ competitionId }: { competitionId: string }) {
  const { data: settings } = useClubEntrySettings(competitionId);
  const { data: invitations = [] } = useInvitations(competitionId);
  const { data: directory = [] } = useDirectory();
  const updateSettings = useUpdateClubEntrySettings(competitionId);
  const invite = useInviteClubs(competitionId);
  const regenerate = useRegenerateInvitation(competitionId);
  const revoke = useRevokeInvitation(competitionId);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<InvitationLink[]>([]);
  if (!settings) return null;

  const byEntry = new Map(invitations.filter((i) => i.directoryClubId).map((i) => [i.directoryClubId!, i]));
  const rows = directory.filter((e) => !e.archived || byEntry.get(e.id)?.invited).map((e) => ({ entry: e, invitation: byEntry.get(e.id) }));
  const toggle = (id: string, on: boolean) => setChecked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const action = settings.status === 'open' ? { label: 'Figer les inscriptions', status: 'frozen' as const } :
    settings.status === 'frozen' ? { label: 'Rouvrir les inscriptions', status: 'open' as const } : { label: 'Ouvrir les inscriptions', status: 'open' as const };

  return (
    <Stack>
      <SectionHeader topic="fiche-club.en-ligne" />
      <Group align="end">
        <Text fw={600} data-testid="club-entry-status">{settings.status === 'closed' ? 'Inscriptions en ligne pas encore ouvertes' : clubEntryStatusText(settings.status, settings.deadline)}</Text>
        <TextInput type="date" label="Date limite (affichée aux clubs)" value={settings.deadline ?? ''} disabled={!settings.managedHere}
          onChange={(e) => updateSettings.mutate({ deadline: e.currentTarget.value || null })} />
        <Button data-testid="club-entry-toggle" disabled={!settings.managedHere} loading={updateSettings.isPending}
          onClick={() => updateSettings.mutate({ status: action.status })}>{action.label}</Button>
      </Group>
      {!settings.managedHere && <Text size="sm" c="dimmed">Cette compétition est gérée par une autre installation : les inscriptions en ligne s’y règlent.</Text>}
      <ApiErrorAlert error={updateSettings.error ?? invite.error ?? regenerate.error ?? revoke.error} />
      {rows.length === 0 ? (
        <Text c="dimmed">L’annuaire des clubs est vide : ajoutez-y des clubs pour les inviter.</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th /><Table.Th>Club</Table.Th><Table.Th>Invité le</Table.Th><Table.Th>Dernière visite</Table.Th><Table.Th>Combattants</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ entry, invitation }) => (
              <Table.Tr key={entry.id} data-testid="invitation-row">
                <Table.Td>
                  {!invitation?.invited && <Checkbox aria-label={`Inviter ${entry.name}`} checked={checked.has(entry.id)} onChange={(e) => toggle(entry.id, e.currentTarget.checked)} />}
                </Table.Td>
                <Table.Td>{entry.name}</Table.Td>
                <Table.Td>{invitation?.invited ? day(invitation.invitedAt) : '—'}</Table.Td>
                <Table.Td>{invitation?.invited ? day(invitation.lastUsedAt) : '—'}</Table.Td>
                <Table.Td>{invitation?.fighters ?? 0}</Table.Td>
                <Table.Td>
                  {invitation?.invited && (
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button size="xs" variant="light" onClick={() => regenerate.mutate(invitation.clubId, { onSuccess: (l) => setLinks([l]) })}>Régénérer le lien</Button>
                      <Button size="xs" variant="subtle" color="red" onClick={() => revoke.mutate(invitation.clubId)}>Révoquer</Button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Group>
        <Button data-testid="invite-clubs" disabled={checked.size === 0} loading={invite.isPending}
          onClick={() => invite.mutate([...checked], { onSuccess: (l) => { setChecked(new Set()); setLinks(l); } })}>
          Inviter les clubs cochés
        </Button>
      </Group>
      <LinksModal links={links} onClose={() => setLinks([])} />
    </Stack>
  );
}
