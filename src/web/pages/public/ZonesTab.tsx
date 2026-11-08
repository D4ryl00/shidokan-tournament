import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import type { PublicCompetition, PublicQueueItem } from '../../../domain/public/types.js';
import { involvesFollowed, sideText, waitingWaves, zoneViews, type ZoneView } from '../../components/public/zoneRows.js';
import { StatusBadge } from '../../components/ui/StatusBadge.js';
import type { PublicTabProps } from './tabProps.js';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const cardStyle = { background: 'var(--sk-card)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-md)' } as const;

function PassageRow({ pub, item, zoneId, followed, big }: { pub: PublicCompetition; item: PublicQueueItem; zoneId: string; followed: Set<string>; big?: boolean }) {
  const cat = pub.categories.find((c) => c.id === item.categoryId);
  const kata = item.matchId === null;
  const star = involvesFollowed(pub, item, followed);
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

function ZoneCard({ pub, view, followed }: { pub: PublicCompetition; view: ZoneView; followed: Set<string> }) {
  const [open, setOpen] = useState(false);
  const { zoneId, next } = view;
  const shown = open ? [...view.shown, ...view.rest] : view.shown;
  return (
    <Stack gap={2} p="sm" data-testid="public-zone" style={cardStyle}>
      <Text fw={700}>{view.name}</Text>
      {!next ? <Text size="sm" c="dimmed" data-testid="public-zone-done">Terminé sur cette zone.</Text> : (
        <>
          <PassageRow pub={pub} item={next} zoneId={zoneId} followed={followed} big />
          {shown.map((i) => <PassageRow key={`${i.categoryId}:${i.number}:${i.kataPart ?? ''}`} pub={pub} item={i} zoneId={zoneId} followed={followed} />)}
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

/** Onglet « Zones » : une carte par zone, le prochain passage en avant, puis les suivants. Aucune heure (lot 2). */
export function ZonesTab({ pub, followed }: PublicTabProps) {
  return (
    <Stack gap="sm" data-testid="public-zones">
      {zoneViews(pub).map((v) => <ZoneCard key={v.zoneId} pub={pub} view={v} followed={followed} />)}
      {waitingWaves(pub).map((t) => <Text key={t} size="sm" c="dimmed" data-testid="public-zones-waiting">{t}</Text>)}
    </Stack>
  );
}
