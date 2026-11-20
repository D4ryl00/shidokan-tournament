import { Box, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { plural } from '../../domain/plural.js';
import type { Zone } from '../../domain/zones.js';
import type { QueueItem, QueueKataka } from '../api.js';
import { kataCall } from '../kataCall.js';
import { HelpButton } from './Help.js';
import { StatusBadge } from './ui/StatusBadge.js';

/** Passage d'une catégorie qui a une saisie de zone autonome à trancher : il ne se joue pas encore (et n'a pas de bouton). */
const HeldBadge = () => (
  <StatusBadge tone="warn" size="md" wrap data-testid="queue-held">
    En attente d’une décision à la table centrale
  </StatusBadge>
);

const EarlyBadge = () => (
  <StatusBadge tone="ok" size="sm" mt={2} data-testid="queue-early">Prête · peut passer plus tôt</StatusBadge>
);

/** Libellé de catégorie sans « kg » isolé en début de ligne (espace insécable). */
const label = (q: QueueItem) => q.categoryLabel.replace(/ kg\b/g, '\u00a0kg');
/** Tour du bloc : celui du passage séparé, sinon celui en cours (tour 1 puis finale d'un bloc entier). */
const kataTitle = (q: QueueItem) => {
  const round = q.kataPart ?? q.lineup?.round ?? null;
  return `${label(q)}${round === 'tour1' ? ' (tour 1)' : round === 'finale' ? ' (finale)' : ''}`;
};

/** Nombre de katakas du bloc : ceux du tour joué sans les absents tardifs (la finale : 2), sinon tous les inscrits. */
const katakaCount = (q: QueueItem) => plural(q.lineup ? q.lineup.list.filter((k) => !k.absent).length : (q.katakas ?? 0), 'kataka');

/** « NOM Prénom · Club » : le club en plus discret. */
const Who = ({ name, club, c }: { name: string | null; club: string | null; c: string }) => (
  <>{name}{club && <Text span fw={400} c={c} style={{ fontSize: '0.8em' }}> · {club}</Text>}</>
);

/** Kataka appelé (« Se présente ») ou prévenu (« Se prépare ») d'un bloc de kata à l'appel. */
const Called = ({ k, what, big }: { k: QueueKataka; what: string; big?: boolean }) => (
  <Box data-testid={big ? 'kata-current' : 'kata-next'}>
    <Text size="xs" c="var(--sk-hero-sub)">{what}</Text>
    <Text fz={big ? 'xl' : 'md'} fw={big ? 700 : 600} lh={1.2}><Who name={k.name} club={k.club} c="var(--sk-hero-sub)" /></Text>
  </Box>
);

/** Premier passage de la file : en grand, lisible de loin. */
function OnCall({ q, onEnter, onScore }: { q: QueueItem; onEnter: (q: QueueItem) => void; onScore: (q: QueueItem) => void }) {
  const kata = q.matchId === null;
  const call = q.lineup ? kataCall(q.lineup.list) : null;
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
              <Text size="sm" c="var(--sk-hero-sub)">
                {call?.current ? `kataka ${call.position} sur ${call.total}` : katakaCount(q)}
              </Text>
              {call?.current && <Called k={call.current} what="Se présente :" big />}
              {call?.next && <Called k={call.next} what="Se prépare :" />}
            </>
          ) : (
            <>
              <Text fz="xl" fw={700} lh={1.2}>{q.a}</Text>
              {q.aClub && <Text size="sm" c="var(--sk-hero-sub)" data-testid="club">{q.aClub}</Text>}
              <Text size="xs" c="var(--sk-hero-sub)">contre</Text>
              <Text fz="xl" fw={700} lh={1.2}>{q.b}</Text>
              {q.bClub && <Text size="sm" c="var(--sk-hero-sub)" data-testid="club">{q.bClub}</Text>}
              <Text size="sm" c="var(--sk-hero-sub)" mt={2}>{label(q)}</Text>
              {q.timing && <Text size="xs" c="var(--sk-hero-sub)" data-testid="match-timing">{q.timing}</Text>}
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
            <>
              <Text size="sm" fw={600}>{kataTitle(q)} <Text span size="sm" c="dimmed" fw={400} style={{ whiteSpace: 'nowrap' }}>· {katakaCount(q)}</Text></Text>
              {q.lineup && (
                <Box component="ol" data-testid="kata-lineup" m={0} pl={20}>
                  {q.lineup.list.map((k, i) => (
                    <Text component="li" key={i} size="sm" fw={600} c={k.absent ? 'dimmed' : undefined} td={k.done ? 'line-through' : undefined}>
                      <Who name={k.name} club={k.club} c="dimmed" />{k.absent && <Text span size="xs" c="dimmed" fw={400}> · absent</Text>}
                    </Text>
                  ))}
                </Box>
              )}
            </>
          ) : (
            <>
              <Text size="sm" fw={600}><Who name={q.a} club={q.aClub} c="dimmed" /></Text>
              <Text size="sm" fw={600}><Text span c="dimmed" fw={400}>contre</Text> <Who name={q.b} club={q.bClub} c="dimmed" /></Text>
            </>
          )}
          {!kata && <Text size="xs" c="dimmed">{label(q)}</Text>}
          {q.timing && <Text size="xs" c="dimmed" data-testid="match-timing">{q.timing}</Text>}
          {q.noRest && <StatusBadge tone="warn" size="sm" mt={2} data-testid="no-rest">Pas de repos : prévoir une pause</StatusBadge>}
          {q.early && <EarlyBadge />}
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
          <StatusBadge tone="warn" wrap data-testid="waiting-other-zones">
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
