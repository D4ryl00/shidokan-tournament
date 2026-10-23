import { Alert, Button, CopyButton, Group, Modal, MultiSelect, Stack, Table, Text, TextInput } from '@mantine/core';
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
  const [chosen, setChosen] = useState<string[]>([]);
  const [links, setLinks] = useState<InvitationLink[]>([]);
  if (!settings) return null;

  // Tableau : seulement les clubs invités ; les autres se choisissent dans l'annuaire (qui contient tous les clubs passés).
  const invited = invitations.filter((i) => i.invited);
  const invitedEntries = new Set(invited.map((i) => i.directoryClubId));
  const candidates = directory
    .filter((e) => !e.archived && !invitedEntries.has(e.id))
    .map((e) => ({ value: e.id, label: e.affiliationNumber ? `${e.name} (${e.affiliationNumber})` : e.name }));
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
      <Group align="end">
        <MultiSelect data-testid="invite-select" label="Clubs à inviter" placeholder={candidates.length ? 'Chercher un club de l’annuaire' : 'Tous les clubs de l’annuaire sont invités'}
          searchable clearable data={candidates} value={chosen} onChange={setChosen} w={420} maw="100%" nothingFoundMessage="Aucun club : ajoutez-le dans l’Annuaire des clubs." />
        <Button data-testid="invite-clubs" disabled={chosen.length === 0} loading={invite.isPending}
          onClick={() => invite.mutate(chosen, { onSuccess: (l) => { setChosen([]); setLinks(l); } })}>
          Inviter les clubs choisis
        </Button>
      </Group>
      {invited.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Club invité</Table.Th><Table.Th>Invité le</Table.Th><Table.Th>Dernière visite</Table.Th><Table.Th>Combattants</Table.Th><Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {invited.map((i) => (
              <Table.Tr key={i.clubId} data-testid="invitation-row">
                <Table.Td>{i.clubName}</Table.Td>
                <Table.Td>{day(i.invitedAt)}</Table.Td>
                <Table.Td>{day(i.lastUsedAt)}</Table.Td>
                <Table.Td>{i.fighters}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button size="xs" variant="light" onClick={() => regenerate.mutate(i.clubId, { onSuccess: (l) => setLinks([l]) })}>Régénérer le lien</Button>
                    <Button size="xs" variant="subtle" color="red" onClick={() => revoke.mutate(i.clubId)}>Révoquer</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <LinksModal links={links} onClose={() => setLinks([])} />
    </Stack>
  );
}
