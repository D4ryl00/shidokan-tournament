import { Box, Button, Group, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useMemo, useState } from 'react';
import { fighterTimeline, searchPublic, type FighterLine, type PublicFighter } from '../../../domain/public/follow.js';
import type { PublicTimes } from '../../../domain/public/times.js';
import type { PublicCompetition } from '../../../domain/public/types.js';
import { minSecText, timingText } from '../../../domain/schedule/durations.js';
import { followedFighters, type Pins } from '../../publicPins.js';
import { StatusBadge, type Tone } from '../ui/StatusBadge.js';
import { EmptyState } from '../ui/EmptyState.js';
import { categoryText, kataText } from './bracketsModel.js';
import { sourceText } from './sourceText.js';
import { versText } from './zoneRows.js';

const MAX_RESULTS = 20;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const byName = (a: string, b: string) => a.localeCompare(b, 'fr');

function stateBadge(s: FighterLine['state']): { tone: Tone; text: string } {
  if (typeof s === 'object') return { tone: 'ok', text: s.medal === 1 ? 'Or' : s.medal === 2 ? 'Argent' : 'Bronze' };
  if (s === 'upcoming') return { tone: 'accent', text: 'À venir' };
  if (s === 'waiting') return { tone: 'neutral', text: 'En attente' };
  if (s === 'eliminated') return { tone: 'danger', text: 'Plus en lice' };
  return { tone: 'neutral', text: 'Terminé' };
}

function StarButton({ on, locked, name, onClick }: { on: boolean; locked?: boolean; name: string; onClick: () => void }) {
  return (
    <UnstyledButton onClick={onClick} disabled={locked} aria-pressed={on} data-testid="public-star"
      aria-label={locked ? `${name} : suivi avec son club` : on ? `Ne plus suivre ${name}` : `Suivre ${name}`}
      title={locked ? 'Suivi avec son club' : undefined}
      style={{ fontSize: 24, lineHeight: 1, padding: 8, margin: -8, flexShrink: 0, color: on ? 'var(--sk-accent)' : 'var(--sk-muted)', opacity: locked ? 0.6 : 1 }}>
      {on ? '★' : '☆'}
    </UnstyledButton>
  );
}

/** « Durée prévue : 2 × 1 min 30 » ; kata : « 3 passages · 1 min 30 chacun » ; rien si la durée n'est pas connue. */
function durationText(pub: PublicCompetition, line: FighterLine): string | null {
  const n = line.next;
  if (!n || pub.phase === 'past') return null;
  if (line.discipline === 'kata') {
    if (n.kataPassages === null || n.kataPassages <= 0) return null;
    const each = pub.categories.find((c) => c.id === line.categoryId)?.kataPassageSec ?? Math.round(n.durationSec / n.kataPassages);
    return `Durée prévue : ${plural(n.kataPassages, 'passage', 'passages')} · ${minSecText(each)} chacun`;
  }
  return n.timing ? `Durée prévue : ${timingText(n.timing)}` : null;
}

function LineView({ line, pub, times }: { line: FighterLine; pub: PublicCompetition; times: PublicTimes }) {
  const badge = stateBadge(line.state);
  const zone = (id: string) => pub.zones.find((z) => z.id === id)?.name ?? 'Zone';
  const kata = line.discipline === 'kata';
  const n = line.next;
  // Pas d'heure une fois sur le tatami (`at` ne rend jamais une heure passée).
  const at = n ? times.at(n.key) : null;
  const duration = durationText(pub, line);
  return (
    <Stack gap={4} pt={6} style={{ borderTop: '1px solid var(--sk-line)' }} data-testid="public-follow-line">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Text size="sm" c="dimmed" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{categoryText(line.label, line.discipline)}</Text>
        <StatusBadge tone={badge.tone} data-testid="public-follow-state">{badge.text}</StatusBadge>
      </Group>
      {line.played.map((p, i) => (
        <Group key={i} justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
          <Text size="sm" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {p.number !== null ? `n° ${p.number} · ` : ''}{p.won ? 'a battu' : 'a perdu contre'} {p.opponent}
          </Text>
          <StatusBadge tone={p.won ? 'ok' : 'danger'}>{p.won ? 'Gagné' : 'Perdu'}</StatusBadge>
        </Group>
      ))}
      {line.kata && kataText(line.kata) && <Text size="sm" data-testid="public-follow-kata">{kataText(line.kata)}</Text>}
      {n && (
        <Box data-testid="public-follow-next">
          <Group gap="md" align="baseline" wrap="wrap">
            <Text span size="sm">{zone(n.zoneId)}</Text>
            <Text span size="sm">{kata ? 'Bloc n° ' : 'n° '}<Text span fz={26} fw={800} inherit className="num" style={{ fontSize: 26 }}>{n.number}</Text></Text>
            {at && <Text span fz={20} fw={700} data-testid="public-follow-at">{versText(at)}</Text>}
          </Group>
          <Text size="sm" c="dimmed">
            {n.before === 0 ? (kata ? 'Prochain passage de la zone' : 'Prochain combat de la zone') : kata ? `${plural(n.before, 'passage', 'passages')} avant le sien` : `${plural(n.before, 'combat', 'combats')} avant le sien`}
            {!kata && ' · contre '}
            {!kata && (n.opponent === null ? 'un adversaire à déterminer'
              : 'from' in n.opponent ? sourceText(n.opponent.from, n.zoneId, pub)
              : `${n.opponent.name} (${n.opponent.club})`)}
          </Text>
          {duration && <Text size="sm" c="dimmed" data-testid="public-follow-duration">{duration}</Text>}
        </Box>
      )}
    </Stack>
  );
}

function FighterCard({ pub, times, fighterId, name, club, pins, onPins }: { pub: PublicCompetition; times: PublicTimes; fighterId: string; name: string; club: string; pins: Pins; onPins: (p: Pins) => void }) {
  const lines = useMemo(() => fighterTimeline(pub, fighterId), [pub, fighterId]);
  const viaClub = !pins.fighters.includes(fighterId);
  return (
    <Stack gap={6} p="sm" data-testid="public-follow-card"
      style={{ background: 'var(--sk-card)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-md)' }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Box style={{ minWidth: 0 }}>
          <Text fw={700} style={{ overflowWrap: 'anywhere' }}>{name}</Text>
          <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{club}</Text>
        </Box>
        <StarButton on locked={viaClub} name={name} onClick={() => onPins({ ...pins, fighters: pins.fighters.filter((f) => f !== fighterId) })} />
      </Group>
      {lines.length === 0 ? <Text size="sm" c="dimmed">Pas encore dans un tableau de session lancée.</Text>
        : lines.map((l) => <LineView key={l.categoryId} line={l} pub={pub} times={times} />)}
    </Stack>
  );
}

function ResultRow({ pub, f, followed, pins, onPins }: { pub: PublicCompetition; f: PublicFighter; followed: Set<string>; pins: Pins; onPins: (p: Pins) => void }) {
  const lines = useMemo(() => fighterTimeline(pub, f.fighterId), [pub, f.fighterId]);
  const pinned = pins.fighters.includes(f.fighterId);
  const via = followed.has(f.fighterId) && !pinned;
  const toggle = () => onPins({ ...pins, fighters: pinned ? pins.fighters.filter((x) => x !== f.fighterId) : [...pins.fighters, f.fighterId] });
  return (
    <Group justify="space-between" wrap="nowrap" align="center" gap="xs" p="sm" data-testid="public-search-fighter"
      style={{ background: 'var(--sk-card)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-md)' }}>
      <Box style={{ minWidth: 0 }}>
        <Text fw={700} style={{ overflowWrap: 'anywhere' }}>{f.name}</Text>
        <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{[f.club, ...lines.map((l) => categoryText(l.label, l.discipline))].filter(Boolean).join(' · ')}</Text>
      </Box>
      <StarButton on={pinned || via} locked={via} name={f.name} onClick={toggle} />
    </Group>
  );
}

/** Onglet « Suivis » : recherche d'un combattant ou d'un club, puis une carte par combattant suivi (prochain combat en avant). */
export function FollowTab({ pub, times, pins, onPins, followed }: { pub: PublicCompetition; times: PublicTimes; pins: Pins; onPins: (p: Pins) => void; followed: Set<string> }) {
  const [q, setQ] = useState('');
  const searching = q.trim() !== '';
  const found = useMemo(() => searchPublic(pub, q), [pub, q]);
  const cards = useMemo(() => {
    const info = new Map<string, { name: string; club: string }>();
    for (const e of Object.values(pub.entrants)) if (!e.hidden && e.fighterId !== null && !info.has(e.fighterId)) info.set(e.fighterId, { name: e.name, club: e.club });
    return [...followed].flatMap((id) => { const i = info.get(id); return i ? [{ id, ...i }] : []; }).sort((a, b) => byName(a.name, b.name));
  }, [pub, followed]);

  const toggleClub = (clubId: string) =>
    onPins({ ...pins, clubs: pins.clubs.includes(clubId) ? pins.clubs.filter((c) => c !== clubId) : [...pins.clubs, clubId] });

  return (
    <Stack gap="sm">
      <TextInput value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Nom, prénom ou club…" aria-label="Rechercher un combattant ou un club"
        leftSection="🔍" type="search" autoComplete="off" data-testid="public-search" />
      {searching ? (
        <Stack gap="xs" data-testid="public-search-results">
          {found.clubs.map((c) => {
            const on = pins.clubs.includes(c.clubId);
            return (
              <Group key={c.clubId} justify="space-between" wrap="nowrap" align="center" gap="xs" p="sm" data-testid="public-search-club"
                style={{ background: 'var(--sk-card)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-md)' }}>
                <Box style={{ minWidth: 0 }}>
                  <Text fw={700} style={{ overflowWrap: 'anywhere' }}>{c.club}</Text>
                  <Text size="xs" c="dimmed">{plural(c.count, 'combattant', 'combattants')}</Text>
                </Box>
                <Button size="compact-sm" variant={on ? 'filled' : 'light'} onClick={() => toggleClub(c.clubId)} aria-pressed={on} style={{ flexShrink: 0 }}>
                  {on ? '★ Club suivi' : '★ Suivre tout le club'}
                </Button>
              </Group>
            );
          })}
          {found.fighters.slice(0, MAX_RESULTS).map((f) => <ResultRow key={f.fighterId} pub={pub} f={f} followed={followed} pins={pins} onPins={onPins} />)}
          {found.fighters.length > MAX_RESULTS && <Text size="sm" c="dimmed">… {found.fighters.length - MAX_RESULTS} autres : précisez la recherche.</Text>}
          {found.clubs.length === 0 && found.fighters.length === 0 && (
            <Text size="sm" c="dimmed" data-testid="public-search-empty">{Array.from(q.trim()).length < 2 ? 'Tapez au moins 2 lettres.' : 'Aucun résultat.'}</Text>
          )}
        </Stack>
      ) : cards.length === 0 ? (
        <EmptyState title="Cherchez un combattant ou un club pour le suivre." icon="★" data-testid="public-follow-empty" />
      ) : (
        <Stack gap="sm" data-testid="public-follow-cards">
          {cards.map((c) => <FighterCard key={c.id} pub={pub} times={times} fighterId={c.id} name={c.name} club={c.club} pins={pins} onPins={onPins} />)}
        </Stack>
      )}
    </Stack>
  );
}
