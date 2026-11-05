import { Accordion, Alert, Anchor, Button, Group, Input, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAppSettings, useClubEntrySettings, useCompetition, useInvitationPreview, useUpdateCompetition, type SendResult } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { MailMessageEditor } from './mail-editor/index.js';
import { MailAttachments, sentLines, useAttachmentLines } from './MailAttachments.js';
import { sendSummary } from '../send-summary.js';
import { GOOGLE_NOT_SENT } from '../../domain/app-settings.js';

export const NEW_LINK_WARNING = 'Un nouveau lien est ajouté à chaque envoi ; les liens déjà envoyés restent valables.';

/** Message aux clubs propre à cette compétition (sinon celui des réglages de l'application), avec un aperçu. */
export function CompetitionMessage({ competitionId, previewClubId }: { competitionId: string; previewClubId: string | null }) {
  const { data: competition } = useCompetition(competitionId);
  const { data: app } = useAppSettings();
  const update = useUpdateCompetition(competitionId);
  const own = competition?.settings.invitationMail ?? null;
  const current = own ?? app?.invitationMail;
  const [form, setForm] = useState<{ subject: string; body: string; format?: 'html' } | null>(null);
  // Remonte l'éditeur (il ne lit son contenu qu'à l'ouverture) après un enregistrement ou un retour au message de l'application.
  const [editorKey, setEditorKey] = useState(0);
  const shown = form ?? current;
  const preview = useInvitationPreview(competitionId, previewClubId, JSON.stringify(current));
  const lines = useAttachmentLines(competitionId);
  const { data: entry } = useClubEntrySettings(competitionId);
  // Compétition tenue ailleurs : le message s'y règle, pas ici.
  const readOnly = entry?.managedHere === false;
  // En mode code, le texte n'est pas encore le message : on n'enregistre qu'après être revenu à l'éditeur.
  const [sourceMode, setSourceMode] = useState(false);
  if (!shown) return null;
  const save = (invitationMail: { subject: string; body: string; format?: 'html' } | null) =>
    update.mutate({ settings: { invitationMail } }, { onSuccess: () => { setForm(null); setEditorKey((k) => k + 1); notifications.show({ color: 'green', message: 'Message enregistré.' }); } });
  return (
    <Accordion variant="contained">
      <Accordion.Item value="message">
        <Accordion.Control>Message aux clubs de cette compétition{own ? ' (propre à la compétition)' : ''}</Accordion.Control>
        <Accordion.Panel>
          <Stack>
            <Text size="sm" c="dimmed">Variables : {'{club} {coach} {competition} {date} {lieu} {date_limite} {lien}'}.</Text>
            <TextInput label="Objet" value={shown.subject} readOnly={readOnly} onChange={(e) => setForm({ ...shown, subject: e.currentTarget.value })} />
            <Input.Wrapper label="Texte">
              <MailMessageEditor key={editorKey} value={shown} readOnly={readOnly} onChange={(v) => setForm({ ...shown, ...v })} onSourceModeChange={setSourceMode} />
            </Input.Wrapper>
            <Group>
              <Button size="xs" disabled={!form || readOnly || sourceMode} loading={update.isPending} onClick={() => form && save(form)}>Enregistrer pour cette compétition</Button>
              {own && <Button size="xs" variant="subtle" disabled={readOnly || sourceMode} onClick={() => save(null)}>Revenir au message de l’application</Button>}
            </Group>
            {sourceMode && <Text size="sm" c="dimmed">Revenez à l’éditeur pour enregistrer.</Text>}
            <ApiErrorAlert error={update.error} />
            <MailAttachments competitionId={competitionId} />
            {preview.data && (
              <Stack gap={4}>
                <Text size="sm" fw={600}>Aperçu pour le premier club coché (le lien sera créé à l’envoi)</Text>
                <Text size="sm">Objet : {preview.data.subject}</Text>
                {/* Le HTML est filtré par le serveur ; fond blanc et texte sombre dans les deux thèmes, comme dans la messagerie. */}
                <div data-testid="invitation-preview" style={{ background: '#ffffff', color: '#222222', padding: 12, borderRadius: 4, overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: preview.data.html }} />
                {lines && (
                  <Text size="sm" data-testid="invitation-attachments">
                    Pièces jointes : {sentLines(lines).map((l) => (l.missing ? `${l.fileName} (manquante : l’envoi sera refusé)` : l.fileName)).join(', ') || 'aucune'}
                  </Text>
                )}
              </Stack>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

/** Résultat d'un envoi groupé, club par club. */
export function SendResultsModal({ results, onClose }: { results: SendResult[]; onClose: () => void }) {
  const errors = results.filter((r) => r.status === 'error');
  const googleRevoked = results.some((r) => r.error === GOOGLE_NOT_SENT);
  return (
    <Modal opened={results.length > 0} onClose={onClose} title="Envoi des liens" size="lg">
      <Stack data-testid="send-results">
        {googleRevoked && (
          <Alert color="red">
            L’accès au compte Google a été retiré pendant l’envoi : reconnectez-vous dans les <Anchor href="/parametres#mails">Réglages de l’application</Anchor>, puis renvoyez aux clubs restants.
          </Alert>
        )}
        <Alert color={errors.length ? 'orange' : 'green'}>
          {sendSummary(results.length - errors.length, errors.length)}
        </Alert>
        {results.map((r) => (
          <Group key={r.clubId} justify="space-between" wrap="nowrap">
            <Text size="sm">{r.clubName}{r.email ? ` — ${r.email}` : ''}</Text>
            <Text size="sm" c={r.status === 'sent' ? 'green' : 'red'}>{r.status === 'sent' ? 'Envoyé' : `Erreur : ${r.error}`}</Text>
          </Group>
        ))}
      </Stack>
    </Modal>
  );
}
