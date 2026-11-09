import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import type { PublicCompetition, PublicQueueItem } from '../../../domain/public/types.js';
import { categoryText } from '../../components/public/bracketsModel.js';
import { currentWave, driftText, finalsMarkers, involvesFollowed, sideText, versText, waitingWaves, waveHeaderText, zoneViews, type ZoneView } from '../../components/public/zoneRows.js';
import type { PublicTimes } from '../../../domain/public/times.js';
import { passageKey } from '../../../domain/public/types.js';
import { StatusBadge } from '../../components/ui/StatusBadge.js';
import type { PublicTabProps } from './tabProps.js';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const cardStyle = { background: 'var(--sk-card)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-md)' } as const;

function PassageRow({ pub, times, item, zoneId, followed, big }: { pub: PublicCompetition; times: PublicTimes; item: PublicQueueItem; zoneId: string; followed: Set<string>; big?: boolean }) {
  // En tête de zone, pas d'heure une fois le passage sur le tatami (départ estimé déjà passé).
  const at = big ? times.nextAt(passageKey(item)) : times.at(passageKey(item));
  const cat = pub.categories.find((c) => c.id === item.categoryId);
  const kata = item.matchId === null;
  const star = involvesFollowed(pub, item, followed);
  const katas = cat?.bracket.entrants.length ?? 0;
  const text = kata
    ? `${cat ? categoryText(cat.label, cat.discipline) : 'Kata'}${item.kataPart === 'finale' ? ' · finale' : ` · ${plural(katas, 'passage', 'passages')}`}`
    : `${sideText(pub, item.a, item.aFrom, zoneId)} / ${sideText(pub, item.b, item.bFrom, zoneId)}`;
  return (
    <UnstyledButton component={Link} to={`?onglet=tableaux&categorie=${encodeURIComponent(item.categoryId)}`}
      data-testid="public-zone-passage" style={{ display: 'block', width: '100%' }}>
      <Group gap="xs" wrap="nowrap" align="baseline" py={big ? 6 : 4}>
        <Text span className="num" fw={700} fz={big ? 26 : 'sm'} style={{ flexShrink: 0, minWidth: big ? 44 : 32 }}>n° {item.number}</Text>
        <Box style={{ minWidth: 0, flex: 1 }}>
          {big && <StatusBadge tone="accent">À suivre</StatusBadge>}
          {at && <Text size="xs" fw={700} data-testid="public-zone-at">{versText(at)}</Text>}
          <Text size={big ? 'md' : 'sm'} fw={big ? 700 : 400} style={{ overflowWrap: 'anywhere' }}>{text}</Text>
          {!kata && cat && <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{categoryText(cat.label, cat.discipline)}</Text>}
        </Box>
        {star && <Text span aria-label="Combattant suivi" style={{ color: 'var(--sk-accent)', fontSize: 20, flexShrink: 0 }}>★</Text>}
      </Group>
    </UnstyledButton>
  );
}

/** « Finales de la session 1 » : à l'endroit où les finales commencent dans la file de la zone des finales. */
function FinalsMarker({ text }: { text: string }) {
  return (
    <Text size="xs" fw={700} tt="uppercase" c="dimmed" pt={6} mt={2} data-testid="public-zone-finals"
      style={{ letterSpacing: '0.05em', borderTop: '1px solid var(--sk-line)' }}>{text}</Text>
  );
}

function ZoneCard({ pub, times, view, followed }: { pub: PublicCompetition; times: PublicTimes; view: ZoneView; followed: Set<string> }) {
  const [open, setOpen] = useState(false);
  const { zoneId, next } = view;
  const shown = open ? [...view.shown, ...view.rest] : view.shown;
  // Index dans [prochain, ...suivants] : le prochain est 0.
  const markers = finalsMarkers(pub, next ? [next, ...view.shown, ...view.rest] : [], times.finalsAt);
  const drift = times.drift(zoneId);
  return (
    <Stack gap={2} p="sm" data-testid="public-zone" style={cardStyle}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Text fw={700} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{view.name}</Text>
        {next && drift !== null && (
          <StatusBadge tone={Math.abs(drift) < 3 ? 'neutral' : drift > 0 ? 'warn' : 'ok'} wrap data-testid="public-zone-drift" style={{ flexShrink: 1 }}>{driftText(drift)}</StatusBadge>
        )}
      </Group>
      {!next ? <Text size="sm" c="dimmed" data-testid="public-zone-done">Terminé sur cette zone.</Text> : (
        <>
          {markers.has(0) && <FinalsMarker text={markers.get(0)!} />}
          <PassageRow pub={pub} times={times} item={next} zoneId={zoneId} followed={followed} big />
          {shown.map((i, k) => (
            <Fragment key={`${i.categoryId}:${i.number}:${i.kataPart ?? ''}`}>
              {markers.has(k + 1) && <FinalsMarker text={markers.get(k + 1)!} />}
              <PassageRow pub={pub} times={times} item={i} zoneId={zoneId} followed={followed} />
            </Fragment>
          ))}
          {view.rest.length > 0 && (
            <UnstyledButton onClick={() => setOpen(!open)} aria-expanded={open} data-testid="public-zone-more"
              style={{ color: 'var(--sk-accent)', fontSize: 14, padding: '6px 0' }}>
              {open ? 'Réduire' : `voir les ${view.rest.length} suivants ›`}
            </UnstyledButton>
          )}
        </>
      )}
    </Stack>
  );
}

/** Onglet « Zones » : la session en cours, puis une carte par zone, le prochain passage en avant, puis les suivants. Heures estimées, avance et retard par zone. */
export function ZonesTab({ pub, times, followed }: PublicTabProps) {
  const wave = currentWave(pub);
  const header = wave ? waveHeaderText(pub, wave, times) : '';
  return (
    <Stack gap="sm" data-testid="public-zones">
      {wave && (
        <Text fw={700} data-testid="public-zones-session">
          {wave.name}{header && <Text span c="dimmed" fw={400} inherit>{header}</Text>}{wave.done && <Text span c="dimmed" fw={400} inherit> · terminée</Text>}
        </Text>
      )}
      {zoneViews(pub).map((v) => <ZoneCard key={v.zoneId} pub={pub} times={times} view={v} followed={followed} />)}
      {waitingWaves(pub).map((t) => <Text key={t} size="sm" c="dimmed" data-testid="public-zones-waiting">{t}</Text>)}
    </Stack>
  );
}
