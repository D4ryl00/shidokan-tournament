import { Accordion, ActionIcon, Alert, Button, Group, Input, Modal, Progress, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { DEFAULT_RECAP_MAIL, RECAP_VARIABLES } from '../../domain/recap-mail.js';
import { ofName, plural } from '../../domain/plural.js';
import { useClubEntrySettings, useCompetition, useRecapPreview, useRecapSendJob, useSendRecap, useSendRecaps, useUpdateCompetition, type SendJob } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { HelpButton } from './Help.js';
import { MailMessageEditor } from './mail-editor/index.js';
import { useRemovedNotice } from './mail-editor/removed-notice.js';
import { IconMail } from './ui/icons.js';
import { useUnsaved } from '../unsaved.js';

type Template = { subject: string; body: string; format?: 'html' };

/** Raison pour laquelle l'enveloppe d'un club est grisée ; null si le récapitulatif peut lui être envoyé. */
export function recapBlocked(club: { coachEmails: string[] }, registrations: number): string | null {
  if (registrations === 0) return 'Aucune inscription';
  if (club.coachEmails.length === 0) return 'Pas d’e-mail pour ce club';
  return null;
}

/** Même HTML une fois lu par le navigateur : le serveur écrit `<br />` là où l'éditeur écrit `<br>`. */
function sameHtml(a: string, b: string): boolean {
  if (a === b) return true;
  const read = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  return read(a) === read(b);
}

/** Volet « Message du récapitulatif » : objet et texte du mail (sinon le texte de départ), avec un aperçu. */
export function RecapMessage({ competitionId, previewClubId, previewClubName }: { competitionId: string; previewClubId: string | null; previewClubName: string | null }) {
  const { data: competition } = useCompetition(competitionId);
  const update = useUpdateCompetition(competitionId);
  const own = competition?.settings.recapMail ?? null;
  const current: Template = own ?? DEFAULT_RECAP_MAIL;
  const [form, setForm] = useState<Template | null>(null);
  // Remonte l'éditeur (il ne lit son contenu qu'à l'ouverture) quand le message à afficher n'est plus le sien.
  const [editorKey, setEditorKey] = useState(0);
  const shown = form ?? current;
  const [saveBlock, setSaveBlock] = useState<string | null>(null);
  useUnsaved('message-recapitulatif', form !== null || saveBlock !== null);
  const preview = useRecapPreview(competitionId, previewClubId, JSON.stringify(current));
  const { data: entry } = useClubEntrySettings(competitionId);
  // Compétition tenue ailleurs : le message s'y règle, pas ici.
  const readOnly = entry?.managedHere === false;
  const { checking, noticeThenSave } = useRemovedNotice();
  if (!competition) return null;
  const save = (recapMail: Template | null) =>
    update.mutate({ settings: { recapMail } }, {
      onSuccess: (saved) => {
        const stored = saved.settings.recapMail;
        if (!recapMail || !stored || stored.format !== recapMail.format || !sameHtml(stored.body, recapMail.body)) setEditorKey((k) => k + 1);
        setForm(null);
        notifications.show({ color: 'green', message: 'Message enregistré.' });
      },
    });
  return (
    <Accordion variant="contained" data-testid="recap-message">
      <Accordion.Item value="message">
        <Accordion.Control>
          <Group gap="xs">Message du récapitulatif{own ? ' (modifié)' : ''}</Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack>
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Text size="sm" c="dimmed">Variables : {RECAP_VARIABLES}. Le récapitulatif PDF du club est joint automatiquement.</Text>
              <HelpButton topic="clubs.recap" />
            </Group>
            <TextInput label="Objet" data-testid="recap-subject" value={shown.subject} readOnly={readOnly} onChange={(e) => setForm({ ...shown, subject: e.currentTarget.value })} />
            <Input.Wrapper label="Texte">
              <MailMessageEditor key={editorKey} value={shown} readOnly={readOnly} onChange={(v) => setForm({ ...shown, ...v })} onSaveBlockChange={setSaveBlock} />
            </Input.Wrapper>
            <Group>
              <Button size="xs" data-testid="recap-save" disabled={!form || readOnly || !!saveBlock} loading={update.isPending || checking} onClick={() => form && noticeThenSave(form, () => save(form))}>Enregistrer</Button>
              {own && <Button size="xs" variant="subtle" data-testid="recap-reset" disabled={readOnly || !!saveBlock} onClick={() => save(null)}>Revenir au texte de départ</Button>}
            </Group>
            {saveBlock && <Text size="sm" c="dimmed">{saveBlock}</Text>}
            <ApiErrorAlert error={update.error} />
            {preview.data && (
              <Stack gap={4}>
                <Text size="sm" fw={600}>Aperçu pour {previewClubName ?? 'un club'}</Text>
                <Text size="sm" data-testid="recap-preview-subject">Objet : {preview.data.subject}</Text>
                {/* Le HTML est filtré par le serveur ; fond blanc et texte sombre dans les deux thèmes. */}
                <div data-testid="recap-preview" style={{ background: '#ffffff', color: '#222222', padding: 12, borderRadius: 4, overflowX: 'auto' }} onClick={(e) => e.preventDefault()} dangerouslySetInnerHTML={{ __html: preview.data.html }} />
              </Stack>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

export interface RecapClub { id: string; name: string; coachEmails: string[]; registrations: number }

/** Icône enveloppe d'une ligne : confirmation (adresses et objet), envoi, puis résultat en notification. */
export function RecapSendOne({ competitionId, club, registrations }: { competitionId: string; club: { id: string; name: string; coachEmails: string[] }; registrations: number }) {
  const [opened, setOpened] = useState(false);
  const send = useSendRecap(competitionId);
  const { data: entry } = useClubEntrySettings(competitionId);
  const elsewhere = entry?.managedHere === false;
  const blocked = elsewhere ? 'Compétition gérée ailleurs' : recapBlocked(club, registrations);
  const { data: competition } = useCompetition(competitionId);
  const version = JSON.stringify(competition?.settings.recapMail ?? null);
  const preview = useRecapPreview(competitionId, opened ? club.id : null, version);
  const close = () => { setOpened(false); send.reset(); };
  return (
    <>
      <ActionIcon variant="subtle" color="gray" aria-label={`Envoyer le récapitulatif ${ofName(club.name)}`} title={blocked ?? 'Envoyer le récapitulatif par mail'}
        data-testid="club-recap-send" disabled={blocked !== null} onClick={() => setOpened(true)}><IconMail /></ActionIcon>
      <Modal opened={opened} onClose={close} title={`Envoyer le récapitulatif ${ofName(club.name)}`}>
        <Stack data-testid="recap-send-confirm">
          <Text size="sm">Le récapitulatif PDF sera envoyé à : <Text span fw={600} data-testid="recap-send-addresses">{club.coachEmails.join(', ')}</Text></Text>
          {preview.data && <Text size="sm">Objet : {preview.data.subject}</Text>}
          <Text size="sm" c="dimmed">On peut le renvoyer plus tard : le récapitulatif joint est alors à jour.</Text>
          <ApiErrorAlert error={send.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Annuler</Button>
            <Button data-testid="recap-send-go" loading={send.isPending}
              onClick={() => send.mutate({ clubId: club.id }, {
                onSuccess: (r) => {
                  if (r.status === 'sent') notifications.show({ color: 'green', message: `Récapitulatif envoyé à ${club.name}.` });
                  else notifications.show({ color: 'red', message: `Récapitulatif non envoyé à ${club.name} : ${r.error}` });
                  close();
                },
              })}>
              Envoyer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** Bilan d'un envoi groupé de récapitulatifs. */
function recapSummary(sent: number, errors: number): string {
  const failed = plural(errors, 'club en erreur', 'clubs en erreur');
  if (sent === 0) return `Aucun récapitulatif envoyé : ${failed}.`;
  const ok = plural(sent, 'récapitulatif envoyé', 'récapitulatifs envoyés');
  return errors ? `${ok}, ${failed}.` : `${ok}.`;
}

function RecapProgressModal({ job, opened, onClose }: { job: SendJob; opened: boolean; onClose: () => void }) {
  const results = job.results;
  const errors = results.filter((r) => r.status === 'error');
  return (
    <Modal opened={opened} onClose={onClose} title="Envoi des récapitulatifs" size="lg">
      <Stack data-testid="recap-results">
        {!job.finished ? (
          <Stack gap="xs" data-testid="recap-progress">
            <Text>Envoi en cours : {results.length} / {plural(job.total, 'club')}</Text>
            <Progress value={job.total ? (100 * results.length) / job.total : 0} animated aria-label="Avancement de l’envoi" />
            <Text size="sm" c="dimmed">Vous pouvez fermer cette fenêtre ou quitter la page : l’envoi continue sur le serveur.</Text>
          </Stack>
        ) : (
          <>
            {job.error && <Alert color="red">{job.error}</Alert>}
            <Alert color={errors.length || job.error ? 'orange' : 'green'} data-testid="recap-summary">{recapSummary(results.length - errors.length, errors.length)}</Alert>
          </>
        )}
        <ScrollArea.Autosize mah="50vh" type="auto" offsetScrollbars>
          <Stack gap="xs">
            {(job.finished ? [...errors, ...results.filter((r) => r.status === 'sent')] : results).map((r) => (
              <Group key={r.clubId} justify="space-between" wrap="nowrap" align="flex-start">
                <Text size="sm">{r.clubName}{r.email ? ` — ${r.email}` : ''}</Text>
                <Text size="sm" c={r.status === 'sent' ? 'green' : 'red'} ta="right">{r.status === 'sent' ? 'Envoyé' : `Erreur : ${r.error}`}</Text>
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
}

/** Bouton « tous les clubs » : confirmation (clubs sautés et raison), avancement, bilan. */
export function RecapSendAll({ competitionId, clubs }: { competitionId: string; clubs: RecapClub[] }) {
  const sendAll = useSendRecaps(competitionId);
  const job = useRecapSendJob(competitionId).data?.job ?? null;
  const [confirm, setConfirm] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const sending = job !== null && !job.finished;
  const elsewhere = useClubEntrySettings(competitionId).data?.managedHere === false;
  // Un envoi trouvé en cours (page rechargée) se suit aussi ; fermer la fenêtre ne l'arrête pas.
  useEffect(() => {
    if (sending && job.id !== dismissedJobId) setProgressOpen(true);
  }, [sending, job?.id, dismissedJobId]);
  const sendable = clubs.filter((c) => recapBlocked(c, c.registrations) === null);
  const skipped = clubs.flatMap((c) => { const why = recapBlocked(c, c.registrations); return why ? [{ club: c, why }] : []; });
  return (
    <>
      <Button variant="default" data-testid="recap-send-all" loading={sending} disabled={elsewhere || sendable.length === 0} onClick={() => setConfirm(true)}>
        Envoyer les récapitulatifs à tous les clubs
      </Button>
      <Modal opened={confirm} onClose={() => setConfirm(false)} title="Envoyer les récapitulatifs">
        <Stack data-testid="recap-all-confirm">
          <Text>{plural(sendable.length, 'club recevra son', 'clubs recevront leur')} récapitulatif.</Text>
          {skipped.length > 0 && (
            <Stack gap={2} data-testid="recap-skipped">
              <Text size="sm" fw={600}>{plural(skipped.length, 'club sauté', 'clubs sautés')} :</Text>
              {skipped.map((s) => <Text key={s.club.id} size="sm">{s.club.name} — {s.why}</Text>)}
            </Stack>
          )}
          <ApiErrorAlert error={sendAll.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setConfirm(false); sendAll.reset(); }}>Annuler</Button>
            <Button data-testid="recap-all-go" loading={sendAll.isPending}
              onClick={() => sendAll.mutate(sendable.map((c) => c.id), { onSuccess: () => { setConfirm(false); setDismissedJobId(null); setProgressOpen(true); } })}>
              Envoyer
            </Button>
          </Group>
        </Stack>
      </Modal>
      {job && <RecapProgressModal job={job} opened={progressOpen} onClose={() => { setProgressOpen(false); setDismissedJobId(job.id); }} />}
    </>
  );
}
