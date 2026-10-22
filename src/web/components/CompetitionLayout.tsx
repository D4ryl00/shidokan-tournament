import { Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useCompetition } from '../api.js';
import { HELP, type HelpTopicId } from '../help.js';
import { COMPETITION_TABS } from '../tabs.js';
import { HelpButton, HelpText } from './Help.js';


export function CompetitionLayout() {
  const { id = '' } = useParams();
  const { data, isLoading } = useCompetition(id);
  const navigate = useNavigate();
  const current = useLocation().pathname.split('/')[3] ?? 'reglages';
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
      <Tabs value={current} onChange={(v) => v && navigate(`/competitions/${id}/${v}`)}>
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
      <Outlet />
    </Stack>
  );
}
