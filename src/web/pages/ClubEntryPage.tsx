import { Alert, Badge, Button, Card, Checkbox, Container, Group, Loader, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useParams } from 'react-router';
import type { ClubFormLine } from '../../domain/club-form.js';
import { useClubEntry, useSaveClubHeader, type ClubEntryHeader, type ClubEntryView, type ClubLine } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ClubLineForm } from '../components/ClubLineForm.js';
import { Logo } from '../components/Logo.js';
import { clubEntryStatusText } from '../components/OnlineEntryPanel.js';
import { COMBATS } from '../components/PaperEntryTable.js';

const COMBAT_LABEL = new Map(COMBATS);
const RULESET_LABEL = { jiyu: 'jiyu', shobu: 'shobu' } as const;

/** « F · Cadets · 54 kg » et « Karaté (jiyu) + Kata ». */
function summary(line: ClubFormLine, ageBands: ClubEntryView['ageBands']): [string, string] {
  const age = ageBands.find((b) => b.code === line.ageBandCode)?.label ?? line.ageBandCode ?? '';
  const who = [line.sex ?? '', age, line.weightKg !== null ? `${String(line.weightKg).replace('.', ',')} kg` : ''].filter(Boolean).join(' · ');
  const combat = line.combat ? `${COMBAT_LABEL.get(line.combat)}${line.ruleset ? ` (${RULESET_LABEL[line.ruleset]})` : ''}` : '';
  return [who, [combat, line.kata ? 'Kata' : ''].filter(Boolean).join(' + ')];
}

/** Coordonnées du club et pré-accord, enregistrés d'un bouton. */
function HeaderForm({ token, view }: { token: string; view: ClubEntryView }) {
  const save = useSaveClubHeader(token);
  const initial: ClubEntryHeader = { coachName: view.club.coachName, coachPhone: view.club.coachPhone, coachEmail: view.club.coachEmail, preApproval: view.club.preApproval, affiliationNumber: view.club.affiliationNumber };
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<ClubEntryHeader>) => setForm((f) => ({ ...f, ...patch }));
  const orNull = (v: string) => v.trim() || null;
  const ro = !view.editable;
  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Votre club : {view.club.name}</Title>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Coach" readOnly={ro} value={form.coachName ?? ''} onChange={(e) => set({ coachName: orNull(e.currentTarget.value) })} />
          <TextInput label="Téléphone" readOnly={ro} inputMode="tel" value={form.coachPhone ?? ''} onChange={(e) => set({ coachPhone: orNull(e.currentTarget.value) })} />
          <TextInput label="E-mail" readOnly={ro} inputMode="email" value={form.coachEmail ?? ''} onChange={(e) => set({ coachEmail: orNull(e.currentTarget.value) })} />
          <TextInput data-testid="club-affiliation" label="N° d’affiliation FFK (facultatif)" readOnly={ro} inputMode="numeric" value={form.affiliationNumber ?? ''}
            onChange={(e) => set({ affiliationNumber: orNull(e.currentTarget.value) })} />
        </SimpleGrid>
        <Checkbox label="Le coach accepte d’avance les reclassements de ses combattants" disabled={ro} checked={form.preApproval}
          onChange={(e) => set({ preApproval: e.currentTarget.checked })} />
        <ApiErrorAlert error={save.error} />
        {!ro && (
          <Group>
            <Button variant="light" loading={save.isPending}
              onClick={() => save.mutate(form, { onSuccess: () => notifications.show({ color: 'green', message: 'Coordonnées enregistrées.' }) })}>
              Enregistrer les coordonnées
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

export function ClubEntryPage() {
  const { token = '' } = useParams();
  const { data: view, error, isLoading } = useClubEntry(token);
  const [editing, setEditing] = useState<ClubLine | 'new' | null>(null);

  const close = (message?: string) => {
    setEditing(null);
    if (message) notifications.show({ color: 'orange', message });
  };

  return (
    <Container size="sm" py="md">
      <Stack>
        <Group wrap="nowrap">
          <Logo size={48} />
          <Stack gap={0}>
            <Title order={3}>{view?.competition.name ?? 'Inscription des combattants'}</Title>
            {view && (
              <Text c="dimmed">
                {new Date(`${view.competition.date}T12:00:00`).toLocaleDateString('fr-FR')}{view.competition.location ? ` · ${view.competition.location}` : ''}
              </Text>
            )}
          </Stack>
        </Group>
        {isLoading && <Loader />}
        {error && <Alert color="red" data-testid="club-entry-error">{error.message}</Alert>}
        {view && (
          <>
            <Alert color={view.editable ? 'green' : 'gray'} data-testid="club-entry-state">
              {view.editable ? clubEntryStatusText('open', view.competition.deadline) : 'Inscriptions closes : contactez l’organisateur.'}
            </Alert>
            <HeaderForm key={JSON.stringify(view.club)} token={token} view={view} />
            <Title order={4}>Vos combattants ({view.lines.length})</Title>
            {view.lines.length === 0 && <Text c="dimmed">Aucun combattant pour l’instant.</Text>}
            {view.lines.map((l) => {
              const [who, what] = summary(l.line, view.ageBands);
              return (
                <Card key={l.fighterId} withBorder padding="sm" data-testid="club-line">
                  <Group justify="space-between" wrap="nowrap" align="start">
                    <Stack gap={2}>
                      <Text fw={600}>{l.line.lastName} {l.line.firstName}</Text>
                      <Text size="sm">{who}</Text>
                      <Text size="sm" data-testid="club-line-disciplines">{what}</Text>
                      {!l.editable && (
                        <Group gap={6}>
                          <Badge color="gray" variant="light">Verrouillé</Badge>
                          <Text size="xs" c="dimmed">{l.reason}</Text>
                        </Group>
                      )}
                    </Stack>
                    {view.editable && l.editable && <Button size="xs" variant="light" onClick={() => setEditing(l)}>Modifier</Button>}
                  </Group>
                </Card>
              );
            })}
            {view.editable && (
              <Group>
                <Button data-testid="add-fighter" onClick={() => setEditing('new')}>Ajouter un combattant</Button>
              </Group>
            )}
            <Text size="xs" c="dimmed" mt="lg" data-testid="privacy-notice">{view.privacyNotice}</Text>
            <ClubLineForm key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.fighterId} token={token} line={editing === 'new' ? null : editing}
              ageBands={view.ageBands} opened={editing !== null} onClose={close} />
          </>
        )}
      </Stack>
    </Container>
  );
}
