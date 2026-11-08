import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { zoneQueue } from '../../../domain/public/follow.js';
import type { PublicCompetition, PublicQueueItem } from '../../../domain/public/types.js';
import { sourceText } from '../../components/public/sourceText.js';
import { StatusBadge } from '../../components/ui/StatusBadge.js';
import type { PublicTabProps } from './tabProps.js';

const SHOWN = 3;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const cardStyle = { background: 'var(--sk-card)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-md)' } as const;

/** Un côté du combat : nom court, ou « le vainqueur du n° 12 », ou « à déterminer ». */
function sideText(pub: PublicCompetition, reg: string | null, from: PublicQueueItem['aFrom'], zoneId: string): string {
  if (reg !== null) return pub.entrants[reg]?.shortName ?? 'À déterminer';
  if (from) return sourceText(from, zoneId, pub);
  return 'à déterminer';
}

function PassageRow({ pub, item, zoneId, followed, big }: { pub: PublicCompetition; item: PublicQueueItem; zoneId: string; followed: Set<string>; big?: boolean }) {
  const cat = pub.categories.find((c) => c.id === item.categoryId);
  const kata = item.matchId === null;
  const star = [item.a, item.b].some((r) => {
    const f = r !== null ? pub.entrants[r]?.fighterId : null;
    return f != null && followed.has(f);
  });
  const katas = cat?.bracket.entrants.length ?? 0;
  const text = kata
    ? `Kata · ${cat?.label ?? ''}${item.kataPart === 'finale' ? ' · finale' : ` · ${plural(katas, 'passage', 'passages')}`}`
    : `${sideText(pub, item.a, item.aFrom, zoneId)} / ${sideText(pub, item.b, item.bFrom, zoneId)}`;
  return (
    <UnstyledButton component={Link} to={`?onglet=tableaux&categorie=${encodeURIComponent(item.categoryId)}`} replace
      data-testid="public-zone-passage" style={{ display: 'block', width: '100%' }}>
      <Group gap="xs" wrap="nowrap" align="baseline" py={big ? 6 : 4}>
        <Text span className="num" fw={700} fz={big ? 26 : 'sm'} style={{ flexShrink: 0, minWidth: big ? 44 : 32 }}>n° {item.number}</Text>
        <Box style={{ minWidth: 0, flex: 1 }}>
          {big && <StatusBadge tone="accent">À suivre</StatusBadge>}
          <Text size={big ? 'md' : 'sm'} fw={big ? 700 : 400} style={{ overflowWrap: 'anywhere' }}>{text}</Text>
          {!kata && cat && <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{cat.label}</Text>}
        </Box>
        {star && <Text span aria-label="Combattant suivi" style={{ color: 'var(--sk-accent)', fontSize: 20, flexShrink: 0 }}>★</Text>}
      </Group>
    </UnstyledButton>
  );
}

function ZoneCard({ pub, zoneId, name, followed }: { pub: PublicCompetition; zoneId: string; name: string; followed: Set<string> }) {
  const [open, setOpen] = useState(false);
  const { next, following } = zoneQueue(pub, zoneId);
  const shown = open ? following : following.slice(0, SHOWN);
  const more = following.length - SHOWN;
  return (
    <Stack gap={2} p="sm" data-testid="public-zone" style={cardStyle}>
      <Text fw={700}>{name}</Text>
      {!next ? <Text size="sm" c="dimmed" data-testid="public-zone-done">Terminé sur cette zone.</Text> : (
        <>
          <PassageRow pub={pub} item={next} zoneId={zoneId} followed={followed} big />
          {shown.map((i) => <PassageRow key={`${i.categoryId}:${i.number}:${i.kataPart ?? ''}`} pub={pub} item={i} zoneId={zoneId} followed={followed} />)}
          {more > 0 && (
            <UnstyledButton onClick={() => setOpen(!open)} aria-expanded={open} data-testid="public-zone-more"
              style={{ color: 'var(--sk-accent)', fontSize: 14, padding: '6px 0' }}>
              {open ? 'Réduire' : `voir les ${more} suivants ›`}
            </UnstyledButton>
          )}
        </>
      )}
    </Stack>
  );
}

/** Onglet « Zones » : une carte par zone, le prochain passage en avant, puis les suivants. Aucune heure (lot 2). */
export function ZonesTab({ pub, followed }: PublicTabProps) {
  const zones = pub.zones.filter((z) => (pub.queues.find((q) => q.zoneId === z.id)?.items.length ?? 0) > 0);
  const waiting = pub.waves.filter((w) => !w.launched);
  return (
    <Stack gap="sm" data-testid="public-zones">
      {zones.map((z) => <ZoneCard key={z.id} pub={pub} zoneId={z.id} name={z.name} followed={followed} />)}
      {waiting.map((w) => (
        <Text key={w.id ?? w.name} size="sm" c="dimmed" data-testid="public-zones-waiting">{w.name} : numéros au lancement de la session.</Text>
      ))}
    </Stack>
  );
}
