import { Alert, Box, Button, Card, Checkbox, Container, Group, Loader, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useParams } from 'react-router';
import { kgText, weightWarning, type ClubFormLine } from '../../domain/club-form.js';
import { useClubEntry, useSaveClubHeader, type ClubEntryHeader, type ClubEntryView, type ClubLine } from '../api.js';
import { useDocumentTitle } from '../documentTitle.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ClubLineForm } from '../components/ClubLineForm.js';
import { Logo } from '../components/Logo.js';
import { clubEntryStatusText } from '../components/OnlineEntryPanel.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { EmailsInput } from '../components/EmailsInput.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { disciplineLabel } from '../labels.js';

const RULESET_LABEL = { jiyu: 'jiyu', shobu: 'shobu' } as const;

/** « F · Cadets · -54 kg (52,5 kg) » et « Shido-boxing (jiyu) + Kata » (nom complet de la discipline, comme chez l'organisateur). */
function summary(line: ClubFormLine, view: ClubEntryView): [string, string] {
  const age = view.ageBands.find((b) => b.code === line.ageBandCode)?.label ?? line.ageBandCode ?? '';
  const weightClass = view.weightClasses.find((w) => w.id === line.weightClassId);
  const kg = line.weightKg !== null ? `${kgText(line.weightKg)} kg` : '';
  const weight = weightClass ? `${weightClass.label} kg${kg ? ` (${kg})` : ''}` : kg;
  const who = [line.sex ?? '', age, weight].filter(Boolean).join(' · ');
  const combat = line.combat ? `${disciplineLabel(line.combat)}${line.ruleset ? ` (${RULESET_LABEL[line.ruleset]})` : ''}` : '';
  return [who, [combat, line.kata ? 'Kata' : ''].filter(Boolean).join(' + ')];
}

/** Coordonnées du club et pré-accord, enregistrés d'un bouton. */
function HeaderForm({ token, view }: { token: string; view: ClubEntryView }) {
  const save = useSaveClubHeader(token);
  const initial: ClubEntryHeader = { coachName: view.club.coachName, coachPhone: view.club.coachPhone, coachEmails: view.club.coachEmails, preApproval: view.club.preApproval, affiliationNumber: view.club.affiliationNumber };
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<ClubEntryHeader>) => setForm((f) => ({ ...f, ...patch }));
  const orNull = (v: string) => v.trim() || null;
  const ro = !view.editable;
  return (
    <Card withBorder padding="lg">
      <Stack>
        <Title order={2} fz="lg">Votre club : {view.club.name}</Title>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Coach" readOnly={ro} value={form.coachName ?? ''} onChange={(e) => set({ coachName: orNull(e.currentTarget.value) })} />
          <TextInput label="Téléphone" readOnly={ro} inputMode="tel" value={form.coachPhone ?? ''} onChange={(e) => set({ coachPhone: orNull(e.currentTarget.value) })} />
          <EmailsInput readOnly={ro} value={form.coachEmails} onChange={(coachEmails) => set({ coachEmails })} />
          <TextInput data-testid="club-affiliation" label="N° d’affiliation FFK (facultatif)" readOnly={ro} inputMode="numeric" value={form.affiliationNumber ?? ''}
            onChange={(e) => set({ affiliationNumber: orNull(e.currentTarget.value) })} />
        </SimpleGrid>
        <Checkbox label="Le coach accepte d’avance les reclassements de ses combattants" disabled={ro} checked={form.preApproval}
          onChange={(e) => set({ preApproval: e.currentTarget.checked })} />
        <ApiErrorAlert error={save.error} />
        {!ro && (
          <Group justify="flex-end">
            <Button variant="default" loading={save.isPending}
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
  useDocumentTitle(view ? `Inscriptions · ${view.competition.name}` : 'Inscriptions');
  const [editing, setEditing] = useState<ClubLine | 'new' | null>(null);

  const close = (message?: string) => {
    setEditing(null);
    if (message) notifications.show({ color: 'orange', message });
  };

  return (
    <Box mih="100vh" style={{ background: 'var(--sk-bg)' }}>
      <Box component="header" style={{ background: 'var(--sk-bar)', borderBottom: '1px solid var(--sk-line)' }}>
        <Container size="sm" py="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <Logo size={36} />
              <Text fw={700}>Shidokan France</Text>
            </Group>
            <ThemeToggle />
          </Group>
        </Container>
      </Box>
    <Container size="sm" py="lg">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} fz={26} lh={1.2}>{view?.competition.name ?? 'Inscription des combattants'}</Title>
          {view && (
            <Text c="dimmed">
              {new Date(`${view.competition.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {view.competition.location ? ` · ${view.competition.location}` : ''}
            </Text>
          )}
        </Stack>
        {isLoading && <Loader />}
        {error && <Alert color="red" data-testid="club-entry-error">{error.message}</Alert>}
        {view && (
          <>
            <Group>
              <StatusBadge tone={view.editable ? 'ok' : 'neutral'} size="lg" wrap data-testid="club-entry-state">
                {view.editable ? clubEntryStatusText('open', view.competition.deadline) : 'Inscriptions closes : contactez l’organisateur.'}
              </StatusBadge>
            </Group>
            <HeaderForm key={JSON.stringify(view.club)} token={token} view={view} />
            <Group justify="space-between" mt="sm">
              <Title order={2} fz="lg">{view.lines.length === 0 ? 'Vos combattants' : `Vos combattants (${view.lines.length})`}</Title>
              {view.editable && <Button data-testid="add-fighter" onClick={() => setEditing('new')}>Ajouter un combattant</Button>}
            </Group>
            {view.closedSummary.length > 0 && (
              <Alert color="gray" title="Non ouvert à cette compétition" data-testid="club-entry-closed">
                <Stack gap={2}>{view.closedSummary.map((l) => <Text key={l} size="sm">{l}</Text>)}</Stack>
              </Alert>
            )}
            {view.lines.length === 0 && (
              <EmptyState title="Aucun combattant pour l’instant" text={view.editable ? 'Ajoutez-les un par un avec « Ajouter un combattant ».' : undefined} />
            )}
            {view.lines.map((l) => {
              const [who, what] = summary(l.line, view);
              return (
                <Card key={l.fighterId} withBorder padding="md" data-testid="club-line">
                  <Group justify="space-between" wrap="nowrap" align="start">
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Text fw={700}>{l.line.lastName} {l.line.firstName}</Text>
                      <Text size="sm" c="dimmed">{who}</Text>
                      <Text size="sm" data-testid="club-line-disciplines">{what}</Text>
                      {[...l.notices, weightWarning(l.line, view.weightClasses)].filter((n) => n !== null).map((n) => <Text key={n} size="xs" c="var(--sk-warn-text)" data-testid="line-notice">{n}</Text>)}
                      {!l.editable && (
                        <Group gap={6} mt={4}>
                          <StatusBadge tone="neutral" size="sm">Verrouillé</StatusBadge>
                          <Text size="xs" c="dimmed">{l.reason}</Text>
                        </Group>
                      )}
                    </Stack>
                    {view.editable && l.editable && <Button size="xs" variant="default" onClick={() => setEditing(l)}>Modifier</Button>}
                  </Group>
                </Card>
              );
            })}
            <Text size="xs" c="dimmed" mt="lg" data-testid="privacy-notice">{view.privacyNotice}</Text>
            <ClubLineForm key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.fighterId} token={token} line={editing === 'new' ? null : editing}
              ageBands={view.ageBands} weightClasses={view.weightClasses} closed={view.closed} opened={editing !== null} onClose={close} />
          </>
        )}
      </Stack>
    </Container>
    </Box>
  );
}
