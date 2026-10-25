import { Box, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { plural } from '../../domain/plural.js';
import type { Zone } from '../../domain/zones.js';
import type { QueueItem } from '../api.js';
import { HelpButton } from './Help.js';
import { StatusBadge } from './ui/StatusBadge.js';

/** Passage d'une catégorie qui a une saisie de zone autonome à trancher : il ne se joue pas encore (et n'a pas de bouton). */
const HeldBadge = () => (
  <StatusBadge tone="warn" size="md" data-testid="queue-held" style={{ whiteSpace: 'normal', height: 'auto', textAlign: 'center' }}>
    En attente d’une décision à la table centrale
  </StatusBadge>
);

/** Libellé de catégorie sans « kg » isolé en début de ligne (espace insécable). */
const label = (q: QueueItem) => q.categoryLabel.replace(/ kg\b/g, '\u00a0kg');
const kataTitle = (q: QueueItem) => `${label(q)}${q.kataPart === 'tour1' ? ' (tour 1)' : q.kataPart === 'finale' ? ' (finale)' : ''}`;

/** Premier passage de la file : en grand, lisible de loin. */
function OnCall({ q, onEnter, onScore }: { q: QueueItem; onEnter: (q: QueueItem) => void; onScore: (q: QueueItem) => void }) {
  const kata = q.matchId === null;
  return (
    <Box data-testid={kata ? 'next-kata' : 'next-match'} data-number={q.number} p="md"
      style={{ background: 'var(--sk-hero)', borderRadius: 'var(--mantine-radius-md)', border: '1px solid var(--sk-card-line)' }}>
      <Group gap="md" wrap="nowrap" align="flex-start">
        <Stack gap={0} align="center" style={{ flexShrink: 0, minWidth: 56 }}>
          <Text size="xs" fw={600} c="var(--sk-hero-sub)">{kata ? 'n°' : 'combat'}</Text>
          <Text fz={44} fw={800} lh={1} c="var(--sk-hero-text)" className="num">{q.number}</Text>
        </Stack>
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Text size="xs" fw={700} c="var(--sk-hero-text)" tt="uppercase" style={{ letterSpacing: 0.6 }}>À l’appel</Text>
          {kata ? (
            <>
              <Text fz="xl" fw={700} lh={1.2}>{kataTitle(q)}</Text>
              <Text size="sm" c="var(--sk-hero-sub)">{plural(q.katakas ?? 0, 'kataka')}</Text>
            </>
          ) : (
            <>
              <Text fz="xl" fw={700} lh={1.2}>{q.a}</Text>
              <Text size="xs" c="var(--sk-hero-sub)">contre</Text>
              <Text fz="xl" fw={700} lh={1.2}>{q.b}</Text>
              <Text size="sm" c="var(--sk-hero-sub)" mt={2}>{label(q)}</Text>
            </>
          )}
          {q.noRest && <StatusBadge tone="warn" size="sm" data-testid="no-rest">Pas de repos : prévoir une pause</StatusBadge>}
        </Stack>
      </Group>
      <Box mt="sm">
        {q.held ? <HeldBadge /> : kata
          ? <Button fullWidth size="md" onClick={() => onScore(q)}>Noter</Button>
          : <Button fullWidth size="md" onClick={() => onEnter(q)}>Saisir le résultat</Button>}
      </Box>
    </Box>
  );
}

/** Passage suivant de la file : une ligne compacte, avec son propre bouton (aucun clic de plus). */
function Next({ q, onEnter, onScore }: { q: QueueItem; onEnter: (q: QueueItem) => void; onScore: (q: QueueItem) => void }) {
  const kata = q.matchId === null;
  return (
    <Group data-testid={kata ? 'next-kata' : 'next-match'} data-number={q.number} justify="space-between" wrap="nowrap" gap="sm" py={8}
      style={{ borderTop: '1px solid var(--sk-line)' }}>
      <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
        <Text fw={700} className="num" w={32} ta="right" style={{ flexShrink: 0 }}>{q.number}</Text>
        <Stack gap={0} style={{ minWidth: 0 }}>
          {kata ? (
            <Text size="sm" fw={600}>{kataTitle(q)} <Text span size="sm" c="dimmed" fw={400}>· {plural(q.katakas ?? 0, 'kataka')}</Text></Text>
          ) : (
            <Text size="sm" fw={600}>{q.a} <Text span c="dimmed" fw={400}>contre</Text> {q.b}</Text>
          )}
          {!kata && <Text size="xs" c="dimmed">{label(q)}</Text>}
          {q.noRest && <StatusBadge tone="warn" size="sm" mt={2} data-testid="no-rest">Pas de repos : prévoir une pause</StatusBadge>}
        </Stack>
      </Group>
      <Box style={{ flexShrink: 0, maxWidth: '50%' }}>
        {q.held ? <HeldBadge /> : kata
          ? <Button size="xs" variant="light" onClick={() => onScore(q)}>Noter</Button>
          : <Button size="xs" variant="light" onClick={() => onEnter(q)}>Saisir</Button>}
      </Box>
    </Group>
  );
}

/**
 * Carte d'une zone, jour J : le premier passage de la file « à l'appel » en grand, puis les suivants dans l'ordre (l'ordre affiché
 * ne change jamais, un passage en attente d'une décision reste à sa place, sans bouton).
 */
export function ZoneQueueCard({ zone, queue, waitingOtherZones, autonomous, onEnter, onScore }: {
  zone: Zone; queue: QueueItem[]; waitingOtherZones: number; autonomous: boolean;
  onEnter: (q: QueueItem) => void; onScore: (q: QueueItem) => void;
}) {
  const [first, ...rest] = queue;
  return (
    <Card withBorder padding="md" data-testid="zone-card" style={{ minWidth: 0 }}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
            <Title order={3} fz="lg" className="sk-ellipsis" title={zone.name}>{zone.name}</Title>
            <HelpButton topic="combats.zone" />
          </Group>
        </Group>
        {autonomous && waitingOtherZones > 0 && (
          <StatusBadge tone="warn" data-testid="waiting-other-zones" style={{ whiteSpace: 'normal', height: 'auto' }}>
            {plural(waitingOtherZones, 'combat')} en attente des résultats des autres zones
          </StatusBadge>
        )}
        {!first ? (
          <Text size="sm" c="dimmed" py="md" ta="center">Aucun combat en attente.</Text>
        ) : (
          <>
            <OnCall q={first} onEnter={onEnter} onScore={onScore} />
            {rest.length > 0 && (
              <Stack gap={0}>
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }} mb={2}>Ensuite</Text>
                {rest.map((q) => <Next key={`${q.categoryId}-${q.matchId ?? 'kata'}-${q.number}`} q={q} onEnter={onEnter} onScore={onScore} />)}
              </Stack>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
