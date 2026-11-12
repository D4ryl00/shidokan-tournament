import { Alert, Anchor, Button, Checkbox, Chip, Group, Modal, MultiSelect, Progress, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import {
  useClubChanges,
  useClubEntrySettings,
  useDirectory,
  useInvitations,
  useInviteClubs,
  useAppSettings,
  useMailtoInvitation,
  useRefreshInvitations,
  useSendInvitations,
  useSendJob,
  useUpdateClubEntrySettings,
  type ClubInvitationRow,
  type SendTarget,
} from '../api.js';
import { ClubChangePill } from './club-changes/ClubChangeBanners.js';
import { ClubAccessModal } from './ClubAccessModal.js';
import { EmailsList } from './EmailsInput.js';
import { checkedAddresses, noneChecked, sendTarget, toggleAddress, type CheckedAddresses } from '../send-recipients.js';
import { CompetitionMessage, NEW_LINK_WARNING, SendResultsModal, UNSAVED_MESSAGE_WARNING } from './InvitationMail.js';
import { sentLines, useAttachmentLines } from './MailAttachments.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { HELP } from '../help.js';
import { DateField } from './ui/DateField.js';
import { SectionCard } from './ui/SectionCard.js';
import { StatusBadge } from './ui/StatusBadge.js';
import { IconLink } from './ui/icons.js';
import { ofName, plural } from '../../domain/plural.js';

const day = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('fr-FR') : '—');
export const clubEntryUrl = (token: string) => `${window.location.origin}/inscription/${token}`;

/** État des inscriptions en ligne, tel qu'affiché à l'organisateur et au club. */
export function clubEntryStatusText(status: 'closed' | 'open' | 'frozen', deadline: string | null): string {
  if (status !== 'open') return 'Inscriptions closes : contactez l’organisateur.';
  return deadline ? `Inscriptions ouvertes jusqu’au ${day(deadline)}` : 'Inscriptions ouvertes';
}

/** Un club et ses adresses : une case par adresse quand il en a plusieurs (seule la première cochée au départ). */
function Recipients({ club, checked, onChange }: { club: ClubInvitationRow; checked: CheckedAddresses; onChange: (c: CheckedAddresses) => void }) {
  const on = checkedAddresses(club, checked);
  return (
    <Stack gap={2} data-testid="send-recipients">
      <Text size="sm" fw={600}>{club.clubName}</Text>
      {club.coachEmails.length === 0 && <Text size="sm" c="red">Pas d’e-mail pour ce club.</Text>}
      {club.coachEmails.length === 1 && <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{club.coachEmails[0]}</Text>}
      {club.coachEmails.length > 1 && club.coachEmails.map((e) => (
        <Checkbox key={e} size="xs" label={e} checked={on.includes(e)} onChange={(ev) => onChange(toggleAddress(club, checked, e, ev.currentTarget.checked))}
          styles={{ label: { overflowWrap: 'anywhere' } }} />
      ))}
      {noneChecked(club, checked) && <Text size="xs" c="red">Cochez au moins une adresse.</Text>}
    </Stack>
  );
}

export function OnlineEntryPanel({ competitionId }: { competitionId: string }) {
  const { data: settings } = useClubEntrySettings(competitionId);
  const { data: invitations = [] } = useInvitations(competitionId);
  const { data: directory } = useDirectory();
  const { data: changes = [] } = useClubChanges(competitionId);
  const updateSettings = useUpdateClubEntrySettings(competitionId);
  const invite = useInviteClubs(competitionId);
  const { data: appSettings } = useAppSettings();
  const send = useSendInvitations(competitionId);
  const mailto = useMailtoInvitation(competitionId);
  const [chosen, setChosen] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<string[]>([]);
  const [confirmSend, setConfirmSend] = useState(false);
  // Envoi groupé suivi : celui lancé ici, ou celui trouvé en cours en ouvrant la page ; fermer la fenêtre ne l'arrête pas.
  const sendJob = useSendJob(competitionId).data?.job ?? null;
  const refreshInvitations = useRefreshInvitations(competitionId);
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const sending = sendJob !== null && !sendJob.finished;
  useEffect(() => {
    if (sending && sendJob.id !== dismissedJobId) setWatchedJobId(sendJob.id);
  }, [sending, sendJob?.id, dismissedJobId]);
  // Chaque club traité : la colonne « Dernier mail » et les liens se mettent à jour.
  const sendDone = sendJob ? `${sendJob.id}:${sendJob.results.length}:${sendJob.finished}` : null;
  useEffect(() => {
    if (sendDone) void refreshInvitations();
  }, [sendDone]);
  const [mailtoClub, setMailtoClub] = useState<ClubInvitationRow | null>(null);
  const [accessClubId, setAccessClubId] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<CheckedAddresses>({});
  const [messageUnsaved, setMessageUnsaved] = useState(false);
  // Pièces cochées : celles que la messagerie ne recevra pas, proposées au téléchargement.
  const attachments = sentLines(useAttachmentLines(competitionId) ?? []).filter((l) => !l.missing);
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
  const changeOf = (clubId: string) => changes.find((c) => c.clubId === clubId);
  const invitedEntries = new Set(invited.map((i) => i.directoryClubId));
  const candidates = (directory ?? [])
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
      <ApiErrorAlert error={updateSettings.error ?? invite.error} />
      <Group align="end">
        <MultiSelect data-testid="invite-select" label="Clubs à inviter" placeholder={!directory ? 'Chargement de l’annuaire…' : candidates.length ? 'Chercher un club de l’annuaire' : 'Tous les clubs de l’annuaire sont invités'}
          searchable clearable data={candidates} value={chosen} onChange={setChosen} w={420} maw="100%" nothingFoundMessage="Aucun club : ajoutez-le dans l’Annuaire des clubs." />
        <Button data-testid="invite-clubs" disabled={chosen.length === 0} loading={invite.isPending}
          onClick={() => invite.mutate(chosen, { onSuccess: () => { notifications.show({ color: 'green', message: `${plural(chosen.length, 'club invité', 'clubs invités')} : envoyez le lien par mail, ou créez-le dans la colonne « Accès ».` }); setChosen([]); } })}>
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
          {/* Écran étroit : le tableau défile de côté (au lieu de couper les adresses), « Accès » et « Ouvrir dans ma messagerie » restent atteignables. */}
          <ScrollArea type="auto">
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox aria-label="Tout cocher" checked={shown.length > 0 && selected.length === shown.length}
                      onChange={(e) => setChecked(e.currentTarget.checked ? new Set(shown.map((i) => i.clubId)) : new Set())} />
                  </Table.Th>
                  <Table.Th miw={160}>Club invité</Table.Th><Table.Th miw={190}>E-mails</Table.Th><Table.Th miw={170}>Dernier mail</Table.Th><Table.Th>Dernière visite</Table.Th><Table.Th ta="right">Combattants</Table.Th><Table.Th>Accès</Table.Th><Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((i) => {
                  const change = changeOf(i.clubId);
                  return (
                  <Table.Tr key={i.clubId} data-testid="invitation-row">
                    <Table.Td><Checkbox aria-label={`Choisir ${i.clubName}`} checked={checked.has(i.clubId)} onChange={(e) => toggle(i.clubId, e.currentTarget.checked)} /></Table.Td>
                    <Table.Td fw={600}>
                      <Group gap="xs" wrap="wrap">
                        {i.clubName}
                        {change && <ClubChangePill origin={change.origin} />}
                      </Group>
                    </Table.Td>
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
                      <Button size="compact-sm" radius="xl" leftSection={<IconLink size={14} />}
                        styles={{ root: { backgroundColor: 'var(--sk-chip)', color: 'var(--sk-chip-text)', whiteSpace: 'nowrap' } }} aria-label={`Accès ${ofName(i.clubName)} : ${plural(i.links, 'lien')}`}
                        onClick={() => setAccessClubId(i.clubId)}>
                        {plural(i.links, 'lien')}
                      </Button>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Button size="compact-sm" variant="subtle" loading={mailto.isPending && mailto.variables?.clubId === i.clubId} disabled={!settings.managedHere} onClick={() => { setAddresses({}); setMailtoClub(i); }}>Ouvrir dans ma messagerie</Button>
                    </Table.Td>
                  </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Group>
            <Button data-testid="send-invitations" disabled={selected.length === 0 || !settings.managedHere || sending} loading={send.isPending} onClick={() => { setAddresses({}); setConfirmSend(true); }}>
              Envoyer le lien par mail ({selected.length})
            </Button>
            {/* Fenêtre d'avancement fermée : l'envoi continue, sa barre reste à côté du bouton. */}
            {sending && watchedJobId !== sendJob.id && (
              <Group gap="xs" wrap="nowrap" data-testid="send-running">
                <Progress w={140} value={sendJob.total ? (100 * sendJob.results.length) / sendJob.total : 0} animated aria-label="Avancement de l’envoi" />
                <Text size="sm" className="num">{sendJob.results.length}/{sendJob.total}</Text>
                <Button size="compact-sm" variant="subtle" onClick={() => setWatchedJobId(sendJob.id)}>Détails</Button>
              </Group>
            )}
            <Text size="sm" c="dimmed">{settings.managedHere ? NEW_LINK_WARNING : 'Rendez la main au serveur pour envoyer des mails.'}</Text>
          </Group>
          {/* Sous le bouton : l'accordéon du message peut être très haut, un refus placé après serait hors de l'écran. */}
          <ApiErrorAlert error={send.error ?? mailto.error} />
          <CompetitionMessage competitionId={competitionId} previewClubId={selected[0]?.clubId ?? null} onUnsavedChange={setMessageUnsaved} />
        </>
      )}
      <Modal opened={confirmSend} onClose={() => setConfirmSend(false)} title="Envoyer le lien par mail">
        <Stack>
          <Text>{plural(selected.length, 'club')}. Un seul mail par club, adressé à toutes ses adresses cochées.</Text>
          <ScrollArea.Autosize mah="45vh" type="auto">
            <Stack gap="sm">{selected.map((i) => <Recipients key={i.clubId} club={i} checked={addresses} onChange={setAddresses} />)}</Stack>
          </ScrollArea.Autosize>
          {messageUnsaved && <Alert color="orange" data-testid="unsaved-message-warning">{UNSAVED_MESSAGE_WARNING}</Alert>}
          <Alert color="yellow">{NEW_LINK_WARNING}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmSend(false)}>Annuler</Button>
            <Button data-testid="send-confirm" loading={send.isPending} disabled={selected.some((i) => noneChecked(i, addresses))}
              onClick={() => send.mutate(selected.map((i) => sendTarget(i, addresses)), { onSuccess: (job) => { setConfirmSend(false); setChecked(new Set()); setWatchedJobId(job.id); }, onError: () => setConfirmSend(false) })}>
              Envoyer
            </Button>
          </Group>
        </Stack>
      </Modal>
      <SendResultsModal job={sendJob} opened={sendJob !== null && watchedJobId === sendJob.id} onClose={() => { setDismissedJobId(watchedJobId); setWatchedJobId(null); }} />
      <Modal opened={mailtoClub !== null} onClose={() => setMailtoClub(null)} title="Ouvrir dans ma messagerie">
        <Stack>
          <Text>Un nouveau lien est créé pour {mailtoClub?.clubName} ; ses liens d’avant restent valables. Envoyez bien ce mail depuis votre messagerie.</Text>
          <Text size="sm">Votre messagerie recevra le texte seul : sans mise en forme ni image.</Text>
          {messageUnsaved && <Alert color="orange" data-testid="unsaved-message-warning">{UNSAVED_MESSAGE_WARNING}</Alert>}
          {mailtoClub && mailtoClub.coachEmails.length > 1 && <Recipients club={mailtoClub} checked={addresses} onChange={setAddresses} />}
          {attachments.length > 0 && (
            <Text size="sm" data-testid="mailto-attachments">
              Votre messagerie ne recevra pas les pièces jointes, joignez-les vous-même :{' '}
              {attachments.map((l, i) => (
                <span key={l.key}>
                  {i > 0 && (i === attachments.length - 1 ? ' et ' : ', ')}
                  <Anchor href={l.href} download={l.fileName}>{l.label ?? l.fileName}</Anchor>
                </span>
              ))}
              .
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setMailtoClub(null)}>Annuler</Button>
            <Button disabled={!!mailtoClub && noneChecked(mailtoClub, addresses)}
              onClick={() => { if (mailtoClub) openMailto(sendTarget(mailtoClub, addresses)); setMailtoClub(null); }}>Ouvrir ma messagerie</Button>
          </Group>
        </Stack>
      </Modal>
      <ClubAccessModal competitionId={competitionId} club={invited.find((i) => i.clubId === accessClubId) ?? null} onClose={() => setAccessClubId(null)} />
    </SectionCard>
  );
}
