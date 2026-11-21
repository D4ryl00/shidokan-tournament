import { Box, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { plural } from '../../domain/plural.js';
import type { OrganiserTimes } from '../../domain/schedule/organiser-times.js';
import type { Zone } from '../../domain/zones.js';
import type { QueueItem } from '../api.js';
import { HelpButton } from './Help.js';
import { PassageTimeLabel } from './PassageTimeText.js';
import { driftText, versText } from './public/zoneRows.js';
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
/** Catégorie et tour du passage de kata (« Kata Filles (tour 1) »). */
const kataTitle = (q: QueueItem) => `${label(q)}${q.kataPart === 'tour1' ? ' (tour 1)' : q.kataPart === 'finale' ? ' (finale)' : ''}`;

/** « NOM Prénom · Club » : le club en plus discret. */
const Who = ({ name, club, c }: { name: string | null; club: string | null; c: string }) => (
  <>{name}{club && <Text span fw={400} c={c} style={{ fontSize: '0.8em' }}> · {club}</Text>}</>
);

/** Heure du passage à l'appel : l'heure brute (même dépassée) d'une session lancée, sinon l'heure prévue (estompée). */
function OnCallTime({ q, times }: { q: QueueItem; times: OrganiserTimes }) {
  if (q.matchId === null) return null;
  const raw = times.onCall(q.categoryId, q.matchId);
  if (raw !== null) {
    return <Text span fz="sm" fw={700} style={{ color: 'var(--sk-accent)', whiteSpace: 'nowrap' }} data-testid="oncall-time" data-planned="false">{versText(raw)}</Text>;
  }
  const t = times.passage(q.categoryId, q.matchId);
  if (t?.kind !== 'at' || !t.planned) return null;
  return <Text span fz="sm" c="dimmed" fs="italic" style={{ whiteSpace: 'nowrap' }} data-testid="oncall-time" data-planned="true">{versText(t.clock)}</Text>;
}

/** Premier passage de la file : en grand, lisible de loin. */
function OnCall({ q, times, onEnter, onScore }: { q: QueueItem; times: OrganiserTimes; onEnter: (q: QueueItem) => void; onScore: (q: QueueItem) => void }) {
  const kata = q.kataPart !== null;
  return (
    <Box data-testid={kata ? 'next-kata' : 'next-match'} data-number={q.number} p="md"
      style={{ background: 'var(--sk-hero)', borderRadius: 'var(--mantine-radius-md)', border: '1px solid var(--sk-card-line)' }}>
      <Group gap="md" wrap="nowrap" align="flex-start">
        <Stack gap={0} align="center" style={{ flexShrink: 0, minWidth: 56 }}>
          <Text size="xs" fw={600} c="var(--sk-hero-sub)">{kata ? 'n°' : 'combat'}</Text>
          <Text fz={44} fw={800} lh={1} c="var(--sk-hero-text)" className="num">{q.number}</Text>
        </Stack>
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Group justify="space-between" align="baseline" wrap="nowrap" gap="xs">
            <Text size="xs" fw={700} c="var(--sk-hero-text)" tt="uppercase" style={{ letterSpacing: 0.6 }}>À l’appel</Text>
            <OnCallTime q={q} times={times} />
          </Group>
          {kata ? (
            <>
              <Text size="sm" c="var(--sk-hero-sub)">{kataTitle(q)}</Text>
              <Box data-testid="kata-current">
                {q.kata?.name
                  ? <Text fz="xl" fw={700} lh={1.2}><Who name={q.kata.name} club={q.kata.club} c="var(--sk-hero-sub)" />{q.kata.absent && <Text span fz="sm" fw={400} c="var(--sk-hero-sub)" data-testid="kata-absent"> · absent</Text>}</Text>
                  : <Text fz="xl" fw={700} lh={1.2}>Finaliste {q.kata?.position}</Text>}
              </Box>
              {q.kataPart === 'tour1' && q.kata && <Text size="sm" c="var(--sk-hero-sub)">kataka {q.kata.position} sur {q.kata.total}</Text>}
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
function Next({ q, times, onEnter, onScore }: { q: QueueItem; times: OrganiserTimes; onEnter: (q: QueueItem) => void; onScore: (q: QueueItem) => void }) {
  const kata = q.kataPart !== null;
  return (
    <Group data-testid={kata ? 'next-kata' : 'next-match'} data-number={q.number} justify="space-between" wrap="nowrap" gap="sm" py={8}
      style={{ borderTop: '1px solid var(--sk-line)' }}>
      <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
        <Text fw={700} className="num" w={32} ta="right" style={{ flexShrink: 0 }}>{q.number}</Text>
        <Stack gap={0} style={{ minWidth: 0 }}>
          {kata ? (
            <>
              <Text size="sm" fw={600}>
                {q.kata?.name ? <><Who name={q.kata.name} club={q.kata.club} c="dimmed" />{q.kata.absent && <Text span size="xs" fw={400} c="dimmed" data-testid="kata-absent"> · absent</Text>}</> : `Finaliste ${q.kata?.position}`}
              </Text>
              <Text size="xs" c="dimmed">{kataTitle(q)}</Text>
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
      <Stack gap={4} align="flex-end" style={{ flexShrink: 0, maxWidth: '50%' }}>
        {q.matchId !== null && <PassageTimeLabel t={times.passage(q.categoryId, q.matchId)} />}
        {q.held ? <HeldBadge /> : kata
          ? <Button size="xs" variant="light" onClick={() => onScore(q)}>Noter</Button>
          : <Button size="xs" variant="light" onClick={() => onEnter(q)}>Saisir</Button>}
      </Stack>
    </Group>
  );
}

/**
 * Carte d'une zone, jour J : le premier passage de la file « à l'appel » en grand, puis les suivants dans l'ordre (l'ordre affiché
 * ne change jamais, un passage en attente d'une décision reste à sa place, sans bouton). Heures présumées de chaque passage
 * (`times`) ; avance / retard de la zone seulement pour une session lancée (`launched`), rien quand elle est à l'heure.
 */
export function ZoneQueueCard({ zone, queue, waitingOtherZones, autonomous, times, launched, onEnter, onScore }: {
  zone: Zone; queue: QueueItem[]; waitingOtherZones: number; autonomous: boolean; times: OrganiserTimes; launched: boolean;
  onEnter: (q: QueueItem) => void; onScore: (q: QueueItem) => void;
}) {
  const [first, ...rest] = queue;
  const drift = launched ? times.drift(zone.id) : null;
  const driftLabel = drift === null ? null : driftText(drift);
  return (
    <Card withBorder padding="md" data-testid="zone-card" style={{ minWidth: 0 }}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
            <Title order={3} fz="lg" className="sk-ellipsis" title={zone.name}>{zone.name}</Title>
            <HelpButton topic="combats.zone" />
          </Group>
          {drift !== null && driftLabel !== 'à l’heure' && (
            <StatusBadge tone={drift > 0 ? 'warn' : 'ok'} size="md" data-testid="zone-drift">{driftLabel}</StatusBadge>
          )}
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
            <OnCall q={first} times={times} onEnter={onEnter} onScore={onScore} />
            {rest.length > 0 && (
              <Stack gap={0}>
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }} mb={2}>Ensuite</Text>
                {rest.map((q) => <Next key={`${q.categoryId}-${q.matchId}-${q.number}`} q={q} times={times} onEnter={onEnter} onScore={onScore} />)}
              </Stack>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
