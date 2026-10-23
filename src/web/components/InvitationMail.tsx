import { Accordion, Alert, Button, Group, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAppSettings, useCompetition, useInvitationPreview, useUpdateCompetition, type SendResult } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

export const NEW_LINK_WARNING = 'Un nouveau lien est créé à chaque envoi ; les liens envoyés avant ne fonctionnent plus.';

/** Message aux clubs propre à cette compétition (sinon celui des réglages de l'application), avec un aperçu. */
export function CompetitionMessage({ competitionId, previewClubId }: { competitionId: string; previewClubId: string | null }) {
  const { data: competition } = useCompetition(competitionId);
  const { data: app } = useAppSettings();
  const update = useUpdateCompetition(competitionId);
  const own = competition?.settings.invitationMail ?? null;
  const current = own ?? app?.invitationMail;
  const [form, setForm] = useState<{ subject: string; body: string } | null>(null);
  const shown = form ?? current;
  const preview = useInvitationPreview(competitionId, previewClubId, JSON.stringify(current));
  if (!shown) return null;
  const save = (invitationMail: { subject: string; body: string } | null) =>
    update.mutate({ settings: { invitationMail } }, { onSuccess: () => { setForm(null); notifications.show({ color: 'green', message: 'Message enregistré.' }); } });
  return (
    <Accordion variant="contained">
      <Accordion.Item value="message">
        <Accordion.Control>Message aux clubs de cette compétition{own ? ' (propre à la compétition)' : ''}</Accordion.Control>
        <Accordion.Panel>
          <Stack>
            <Text size="sm" c="dimmed">Variables : {'{club} {coach} {competition} {date} {lieu} {date_limite} {lien}'}.</Text>
            <TextInput label="Objet" value={shown.subject} onChange={(e) => setForm({ ...shown, subject: e.currentTarget.value })} />
            <Textarea label="Texte" autosize minRows={6} value={shown.body} onChange={(e) => setForm({ ...shown, body: e.currentTarget.value })} />
            <Group>
              <Button size="xs" disabled={!form} loading={update.isPending} onClick={() => form && save(form)}>Enregistrer pour cette compétition</Button>
              {own && <Button size="xs" variant="subtle" onClick={() => save(null)}>Revenir au message de l’application</Button>}
            </Group>
            <ApiErrorAlert error={update.error} />
            {preview.data && (
              <Stack gap={4}>
                <Text size="sm" fw={600}>Aperçu pour le premier club coché (le lien sera créé à l’envoi)</Text>
                <Text size="sm">Objet : {preview.data.subject}</Text>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }} p="xs" bg="var(--mantine-color-default-hover)">{preview.data.body}</Text>
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
  return (
    <Modal opened={results.length > 0} onClose={onClose} title="Envoi des liens" size="lg">
      <Stack data-testid="send-results">
        <Alert color={errors.length ? 'orange' : 'green'}>
          {results.length - errors.length} mail(s) envoyé(s){errors.length ? `, ${errors.length} en erreur : renvoyez-les après correction (le lien de ces clubs a pu changer).` : '.'}
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
