import { Anchor, Box, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import type { PublicCompetitionSummary } from '../../../domain/public/types.js';
import { PublicHeader } from '../../components/public/PublicHeader.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { useDocumentTitle } from '../../documentTitle.js';
import { usePublicList } from '../../publicApi.js';
import { PublicError } from '../../components/public/PublicError.js';

export const frDate = (iso: string, short = false) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', short ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' });

function Block({ title, items, children }: { title: string; items: PublicCompetitionSummary[]; children: (c: PublicCompetitionSummary) => React.ReactNode }) {
  if (items.length === 0) return null;
  return (
    <Stack gap="xs" component="section" aria-label={title}>
      <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.05em' }}>{title}</Text>
      {items.map((c) => (
        <Card key={c.id} withBorder padding="md" component={Link} to={`/public/${c.id}`} data-testid="public-competition"
          style={{ textDecoration: 'none', color: 'inherit', ...(c.phase === 'today' ? { border: '2px solid var(--sk-accent)' } : {}) }}>
          {children(c)}
        </Card>
      ))}
    </Stack>
  );
}

const place = (c: PublicCompetitionSummary) => [frDate(c.date), c.location].filter(Boolean).join(' · ');

/** Accueil public : les compétitions du jour, à venir et passées, sans compte. */
export function PublicHomePage() {
  useDocumentTitle('Compétitions');
  const { data, isLoading, error, failureReason } = usePublicList();
  const empty = !!data && data.today.length + data.upcoming.length + data.past.length === 0;
  return (
    <Box mih="100vh" style={{ background: 'var(--sk-bg)' }}>
      <PublicHeader />
      <Stack gap="lg" p="md" maw={720} mx="auto">
        <Title order={1} fz="h3">Compétitions</Title>
        {isLoading && !failureReason && <Group justify="center" py="xl"><Loader /></Group>}
        <PublicError error={error ?? failureReason} hasData={!!data} />
        {empty && <EmptyState title="Aucune compétition affichée pour le moment." data-testid="public-empty" />}
        {data && (
          <>
            <Block title="Aujourd’hui" items={data.today}>
              {(c) => (
                <Stack gap={2}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Text fw={700}>{c.name}</Text>
                    <Text size="xs" fw={700} style={{ color: 'var(--sk-accent)', whiteSpace: 'nowrap' }}>● EN DIRECT</Text>
                  </Group>
                  <Text size="sm" c="dimmed">{place(c)}</Text>
                  {!c.launched && <Text size="sm" c="dimmed">Numéros et horaires au lancement de la session.</Text>}
                </Stack>
              )}
            </Block>
            <Block title="À venir" items={data.upcoming}>
              {(c) => (
                <Stack gap={2}>
                  <Text fw={700}>{c.name}</Text>
                  <Text size="sm" c="dimmed">{place(c)}</Text>
                  <Text size="sm" c="dimmed">Numéros et horaires au lancement de la session.</Text>
                </Stack>
              )}
            </Block>
            <Block title="Historique" items={data.past}>
              {(c) => (
                <Stack gap={2}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Text fw={700}>{c.name}</Text>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{frDate(c.date, true)}</Text>
                  </Group>
                  <Text size="sm" c="dimmed">Résultats et tableaux{c.location ? ` · ${c.location}` : ''}</Text>
                </Stack>
              )}
            </Block>
          </>
        )}
        <Text size="sm" ta="right"><Anchor component={Link} to="/connexion">Organisateurs →</Anchor></Text>
      </Stack>
    </Box>
  );
}
