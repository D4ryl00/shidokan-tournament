import { Button, Group, Loader, Modal, Stack, Tabs, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCompetition } from '../api.js';
import { HELP, type HelpTopicId } from '../help.js';
import { COMPETITION_TABS } from '../tabs.js';
import { useHasUnsaved } from '../unsaved.js';
import { HelpButton, HelpText } from './Help.js';


export function CompetitionLayout() {
  const { id = '' } = useParams();
  const { data, isLoading } = useCompetition(id);
  const navigate = useNavigate();
  const current = useLocation().pathname.split('/')[3] ?? 'reglages';
  const unsaved = useHasUnsaved();
  const [pending, setPending] = useState<string | null>(null);
  // La vague choisie (`?vague=`) suit d'un onglet à l'autre : de la pesée d'une vague à son recasement.
  const vague = useSearchParams()[0].get('vague');
  const path = (tab: string) => `/competitions/${id}/${tab}${vague ? `?vague=${encodeURIComponent(vague)}` : ''}`;
  const go = (tab: string) => (unsaved ? setPending(tab) : navigate(path(tab)));
  if (isLoading) return <Loader />;
  if (!data) return <Text>Compétition introuvable.</Text>;
  return (
    <Stack>
      <div>
        <Title order={2}>{data.name}</Title>
        <Text c="dimmed">
          {new Date(`${data.date}T12:00:00`).toLocaleDateString('fr-FR', { dateStyle: 'full' })}
          {data.location ? ` — ${data.location}` : ''}
        </Text>
      </div>
      <Tabs value={current} onChange={(v) => v && v !== current && go(v)}>
        <Tabs.List>
          {COMPETITION_TABS.map((t) => (
            <Tabs.Tab key={t.path} value={t.path}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {current in HELP && (
        <Group gap={4} wrap="nowrap">
          <HelpText topic={current as HelpTopicId} />
          <HelpButton topic={current as HelpTopicId} />
        </Group>
      )}
      <Modal opened={pending !== null} onClose={() => setPending(null)} title="Quitter sans enregistrer ?">
        <Stack data-testid="leave-confirm">
          <Text size="sm">La saisie en cours n’est pas enregistrée : elle sera perdue si vous quittez cet onglet.</Text>
          <Group justify="flex-end">
            <Button variant="default" data-testid="leave-stay" onClick={() => setPending(null)}>Rester</Button>
            <Button color="red" data-testid="leave-go" onClick={() => { const tab = pending; setPending(null); if (tab) navigate(path(tab)); }}>
              Quitter sans enregistrer
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Outlet />
    </Stack>
  );
}
