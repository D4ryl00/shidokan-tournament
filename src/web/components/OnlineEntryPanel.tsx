import { Alert, Anchor, Button, Checkbox, Chip, CopyButton, Group, Menu, Modal, MultiSelect, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import {
  useClubEntrySettings,
  useDirectory,
  useInvitations,
  useInviteClubs,
  useRegenerateInvitation,
  useRevokeInvitation,
  useAppSettings,
  useMailtoInvitation,
  useSendInvitations,
  useUpdateClubEntrySettings,
  type ClubInvitationRow,
  type InvitationLink,
  type SendResult,
  type SendTarget,
} from '../api.js';
import { EmailsList } from './EmailsInput.js';
import { sameEmail } from '../../domain/emails.js';
import { CompetitionMessage, NEW_LINK_WARNING, SendResultsModal } from './InvitationMail.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { HELP } from '../help.js';
import { DateField } from './ui/DateField.js';
import { SectionCard } from './ui/SectionCard.js';
import { StatusBadge } from './ui/StatusBadge.js';
import { plural } from '../../domain/plural.js';

const day = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('fr-FR') : '—');
export const clubEntryUrl = (token: string) => `${window.location.origin}/inscription/${token}`;

/** État des inscriptions en ligne, tel qu'affiché à l'organisateur et au club. */
export function clubEntryStatusText(status: 'closed' | 'open' | 'frozen', deadline: string | null): string {
  if (status !== 'open') return 'Inscriptions closes : contactez l’organisateur.';
  return deadline ? `Inscriptions ouvertes jusqu’au ${day(deadline)}` : 'Inscriptions ouvertes';
}

/** Adresses décochées, par club : pour cet envoi seulement. */
type Excluded = Record<string, string[]>;

/** Adresses à qui écrire : toutes (rien de transmis) ou celles restées cochées. */
function targetOf(club: ClubInvitationRow, excluded: Excluded): SendTarget {
  const off = excluded[club.clubId] ?? [];
  return off.length ? { clubId: club.clubId, emails: club.coachEmails.filter((e) => !off.some((x) => sameEmail(x, e))) } : { clubId: club.clubId };
}
/** Un club qui a des adresses mais dont toutes sont décochées. */
const noneChosen = (club: ClubInvitationRow, excluded: Excluded): boolean =>
  club.coachEmails.length > 0 && (excluded[club.clubId] ?? []).length >= club.coachEmails.length;

/** Un club et ses adresses : une case par adresse quand il en a plusieurs (toutes cochées au départ). */
function Recipients({ club, excluded, onChange }: { club: ClubInvitationRow; excluded: Excluded; onChange: (e: Excluded) => void }) {
  const off = excluded[club.clubId] ?? [];
  const toggle = (email: string, on: boolean) => onChange({ ...excluded, [club.clubId]: on ? off.filter((x) => x !== email) : [...off, email] });
  return (
    <Stack gap={2} data-testid="send-recipients">
      <Text size="sm" fw={600}>{club.clubName}</Text>
      {club.coachEmails.length === 0 && <Text size="sm" c="red">Pas d’e-mail pour ce club.</Text>}
      {club.coachEmails.length === 1 && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{club.coachEmails[0]}</Text>}
      {club.coachEmails.length > 1 && club.coachEmails.map((e) => (
        <Checkbox key={e} size="xs" label={e} checked={!off.includes(e)} onChange={(ev) => toggle(e, ev.currentTarget.checked)}
          styles={{ label: { overflowWrap: 'anywhere' } }} />
      ))}
      {noneChosen(club, excluded) && <Text size="xs" c="red">Cochez au moins une adresse.</Text>}
    </Stack>
  );
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
  const { data: appSettings } = useAppSettings();
  const send = useSendInvitations(competitionId);
  const mailto = useMailtoInvitation(competitionId);
  const [chosen, setChosen] = useState<string[]>([]);
  const [links, setLinks] = useState<InvitationLink[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<string[]>([]);
  const [confirmSend, setConfirmSend] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);
  const [mailtoClub, setMailtoClub] = useState<ClubInvitationRow | null>(null);
  const [excluded, setExcluded] = useState<Excluded>({});
  if (!settings) return null;

  // Tableau : seulement les clubs invités ; les autres se choisissent dans l'annuaire (qui contient tous les clubs passés).
  const invited = invitations.filter((i) => i.invited);
  const FILTERS: Record<string, (i: ClubInvitationRow) => boolean> = {
    never: (i) => !i.lastMail,
    empty: (i) => i.fighters === 0,
    email: (i) => i.coachEmails.length > 0,
  };
  const shown = invited.filter((i) => filters.every((f) => FILTERS[f]!(i)));
  const toggle = (id: string, on: boolean) => setChecked((c) => { const n = new Set(c); if (on) n.add(id); else n.delete(id); return n; });
  const selected = shown.filter((i) => checked.has(i.clubId));
  // Adresses encodées une à une : la virgule qui les sépare reste une virgule.
  const openMailto = (target: SendTarget) =>
    mailto.mutate(target, {
      onSuccess: (m) => { window.location.href = `mailto:${(m.to ?? '').split(',').map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`; },
    });
  const invitedEntries = new Set(invited.map((i) => i.directoryClubId));
  const candidates = directory
    .filter((e) => !e.archived && !invitedEntries.has(e.id))
    .map((e) => ({ value: e.id, label: e.affiliationNumber ? `${e.name} (${e.affiliationNumber})` : e.name }));
  const action = settings.status === 'open' ? { label: 'Figer les inscriptions', status: 'frozen' as const } :
    settings.status === 'frozen' ? { label: 'Rouvrir les inscriptions', status: 'open' as const } : { label: 'Ouvrir les inscriptions', status: 'open' as const };

  return (
    <SectionCard title={HELP['fiche-club.en-ligne'].title} help="fiche-club.en-ligne"
      actions={
        <StatusBadge tone={settings.status === 'open' ? 'ok' : settings.status === 'frozen' ? 'warn' : 'neutral'} size="lg" data-testid="club-entry-status">
          {settings.status === 'closed' ? 'Inscriptions en ligne pas encore ouvertes' : clubEntryStatusText(settings.status, settings.deadline)}
        </StatusBadge>
      }>
      <Group align="end" gap="sm">
        <DateField label="Date limite (affichée aux clubs)" value={settings.deadline} disabled={!settings.managedHere} clearable w={220}
          onChange={(v) => updateSettings.mutate({ deadline: v || null })} />
        <Button data-testid="club-entry-toggle" variant={settings.status === 'open' ? 'default' : 'filled'} disabled={!settings.managedHere} loading={updateSettings.isPending}
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
      {appSettings && !appSettings.privacyContact.trim() && (
        <Alert color="yellow">Complétez l’adresse de contact de la mention sur les données personnelles (Réglages de l’application) avant d’ouvrir les inscriptions.</Alert>
      )}
      {invited.length > 0 && (
        <>
          <Group gap="xs">
            <Text size="sm">Afficher :</Text>
            <Chip.Group multiple value={filters} onChange={setFilters}>
              <Chip size="xs" value="never">Jamais envoyé</Chip>
              <Chip size="xs" value="empty">Sans combattant</Chip>
              <Chip size="xs" value="email">Avec e-mail</Chip>
            </Chip.Group>
          </Group>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>
                  <Checkbox aria-label="Tout cocher" checked={shown.length > 0 && selected.length === shown.length}
                    onChange={(e) => setChecked(e.currentTarget.checked ? new Set(shown.map((i) => i.clubId)) : new Set())} />
                </Table.Th>
                <Table.Th>Club invité</Table.Th><Table.Th>E-mails</Table.Th><Table.Th>Dernier mail</Table.Th><Table.Th>Dernière visite</Table.Th><Table.Th ta="right">Combattants</Table.Th><Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((i) => (
                <Table.Tr key={i.clubId} data-testid="invitation-row">
                  <Table.Td><Checkbox aria-label={`Choisir ${i.clubName}`} checked={checked.has(i.clubId)} onChange={(e) => toggle(i.clubId, e.currentTarget.checked)} /></Table.Td>
                  <Table.Td fw={600}>{i.clubName}</Table.Td>
                  <Table.Td><EmailsList emails={i.coachEmails} /></Table.Td>
                  <Table.Td>
                    {i.lastMail ? (
                      <Text size="sm" c={i.lastMail.status === 'sent' ? undefined : 'red'}>
                        {i.lastMail.status === 'sent' ? `Envoyé le ${day(i.lastMail.sentAt)}` : `Erreur : ${i.lastMail.error}`}
                      </Text>
                    ) : '—'}
                  </Table.Td>
                  <Table.Td className="num">{day(i.lastUsedAt)}</Table.Td>
                  <Table.Td ta="right" className="num">{i.fighters}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Button size="compact-sm" variant="subtle" loading={mailto.isPending && mailto.variables?.clubId === i.clubId} onClick={() => { setExcluded({}); setMailtoClub(i); }}>Ouvrir dans ma messagerie</Button>
                      <Menu position="bottom-end">
                        <Menu.Target><Button size="compact-sm" variant="subtle" color="gray" aria-label={`Autres actions pour ${i.clubName}`}>…</Button></Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => regenerate.mutate(i.clubId, { onSuccess: (l) => setLinks([l]) })}>Régénérer le lien</Menu.Item>
                          <Menu.Item color="red" onClick={() => revoke.mutate(i.clubId)}>Révoquer</Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group>
            <Button data-testid="send-invitations" disabled={selected.length === 0} loading={send.isPending} onClick={() => { setExcluded({}); setConfirmSend(true); }}>
              Envoyer le lien par mail ({selected.length})
            </Button>
            <Text size="sm" c="dimmed">{NEW_LINK_WARNING}</Text>
          </Group>
          <CompetitionMessage competitionId={competitionId} previewClubId={selected[0]?.clubId ?? null} />
        </>
      )}
      <ApiErrorAlert error={send.error ?? mailto.error} />
      <Modal opened={confirmSend} onClose={() => setConfirmSend(false)} title="Envoyer le lien par mail">
        <Stack>
          <Text>{plural(selected.length, 'club')}. Un seul mail par club, adressé à toutes ses adresses cochées.</Text>
          <ScrollArea.Autosize mah="45vh" type="auto">
            <Stack gap="sm">{selected.map((i) => <Recipients key={i.clubId} club={i} excluded={excluded} onChange={setExcluded} />)}</Stack>
          </ScrollArea.Autosize>
          <Alert color="yellow">{NEW_LINK_WARNING}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmSend(false)}>Annuler</Button>
            <Button data-testid="send-confirm" loading={send.isPending} disabled={selected.some((i) => noneChosen(i, excluded))}
              onClick={() => send.mutate(selected.map((i) => targetOf(i, excluded)), { onSuccess: (r) => { setConfirmSend(false); setChecked(new Set()); setResults(r); }, onError: () => setConfirmSend(false) })}>
              Envoyer
            </Button>
          </Group>
        </Stack>
      </Modal>
      <SendResultsModal results={results} onClose={() => setResults([])} />
      <Modal opened={mailtoClub !== null} onClose={() => setMailtoClub(null)} title="Ouvrir dans ma messagerie">
        <Stack>
          <Text>Un nouveau lien est créé pour {mailtoClub?.clubName} et l’ancien ne fonctionnera plus : envoyez bien ce mail depuis votre messagerie.</Text>
          {mailtoClub && mailtoClub.coachEmails.length > 1 && <Recipients club={mailtoClub} excluded={excluded} onChange={setExcluded} />}
          <Text size="sm" data-testid="mailto-attachments">
            Votre messagerie ne recevra pas les pièces jointes : joignez-y vous-même la{' '}
            <Anchor href={`/api/competitions/${competitionId}/club-form.pdf`} download>fiche à imprimer (PDF)</Anchor> et le{' '}
            <Anchor href={`/api/competitions/${competitionId}/club-form.ods`} download>tableur (.ods)</Anchor>.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setMailtoClub(null)}>Annuler</Button>
            <Button disabled={!!mailtoClub && noneChosen(mailtoClub, excluded)}
              onClick={() => { if (mailtoClub) openMailto(targetOf(mailtoClub, excluded)); setMailtoClub(null); }}>Ouvrir ma messagerie</Button>
          </Group>
        </Stack>
      </Modal>
      <LinksModal links={links} onClose={() => setLinks([])} />
    </SectionCard>
  );
}
