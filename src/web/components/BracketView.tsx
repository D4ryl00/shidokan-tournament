import { Badge, Box, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import type { CSSProperties } from 'react';
import {
  resolveBracket,
  type CombatBracket,
  type KataBracket,
  type KataScores,
  type MatchPhase,
  type MatchResult,
  type ResolvedMatch,
  type SlotSource,
} from '../../domain/brackets/index.js';
import { resolveKata } from '../../domain/brackets/kata.js';
import type { Category } from '../../domain/categories.js';
import type { ProposalType } from '../../domain/replacement/index.js';
import type { RecasementEntry } from '../api.js';
import { ReplacementBadge } from './ReplacementBadge.js';

export interface EntrantInfo {
  name: string;
  club: string;
  /** Grade (kata), pour informer les arbitres. */
  grade?: string | null;
}

export const METHOD_SHORT: Record<MatchResult['method'], string> = {
  points: 'points',
  decision: 'décision',
  ko: 'KO',
  abandon: 'abandon',
  disqualification: 'disq.',
  forfeit: 'forfait',
};

const PHASE_TITLES: Record<MatchPhase, string> = {
  main: 'Tableau',
  repechage: 'Repêchage',
  third_place: 'Combat pour la 3e place',
  losers: 'Tableau des perdants',
  grand_final: 'Grande finale',
  pool: 'Poule',
  series: 'Manches',
};
const poolName = (i: number) => String.fromCharCode(65 + i);

function roundTitle(phase: MatchPhase, round: number, rounds: number): string {
  if (phase !== 'main') return `${PHASE_TITLES[phase]}${phase === 'repechage' || phase === 'losers' ? ` — tour ${round}` : ''}`;
  const fromEnd = rounds - round;
  return fromEnd === 0 ? 'Finale' : fromEnd === 1 ? 'Demi-finales' : fromEnd === 2 ? 'Quarts de finale' : `Tour ${round}`;
}

interface Props {
  category: Category;
  entrants: Map<string, EntrantInfo>;
  results?: Record<string, MatchResult>;
  kataScores?: KataScores;
  printable?: boolean;
  /** Inscrit sélectionné (échange manuel). */
  selected?: string | null;
  onSelect?: (registrationId: string) => void;
  /** Badges de recasement (écran seulement). */
  badges?: Map<string, ProposalType>;
  /** Détail des recasements validés (clic sur un badge). */
  badgeDetails?: Map<string, RecasementEntry>;
  /** Saisie : clic sur un combat jouable. */
  onMatchClick?: (match: ResolvedMatch) => void;
  /** Combats dont le résultat saisi est ignoré (à revoir). */
  stale?: Set<string>;
  tieBreaks?: Record<number, string[]>;
  kataTieBreak?: string[];
}

export function BracketView(props: Props) {
  const { category } = props;
  if (!category.bracket || category.registrationIds.length === 0) return null;
  if (category.registrationIds.length === 1) {
    const only = props.entrants.get(category.registrationIds[0]!);
    return (
      <Text data-testid="bracket-view" c="dimmed">
        {only?.name} ({only?.club}) est seul(e) dans cette catégorie : pas de combat. À recaser.
      </Text>
    );
  }
  return category.bracket.kind === 'kata' ? <KataView {...props} bracket={category.bracket} /> : <CombatView {...props} bracket={category.bracket} />;
}

function EntrantLine({ id, fallback, info, props, winner }: { id: string | null; fallback: string; info?: EntrantInfo; props: Props; winner?: boolean }) {
  const selected = id !== null && props.selected === id;
  const style: CSSProperties = {
    cursor: props.onSelect && id ? 'pointer' : undefined,
    outline: selected ? '2px solid var(--mantine-color-shidokan-5)' : undefined,
    borderRadius: 4,
    padding: '2px 4px',
    fontWeight: winner ? 700 : undefined,
  };
  return (
    <Box data-testid="bracket-entrant" data-entrant={id ?? ''} style={style} onClick={() => id && props.onSelect?.(id)}>
      {id && info ? (
        <>
          <Text size={props.printable ? 'md' : 'sm'} fw={winner ? 800 : props.printable ? 400 : 500} td={winner && props.printable ? 'underline' : undefined} lh={1.2}>
            {info.name}
            {!props.printable && id && props.badges?.get(id) && <> <ReplacementBadge type={props.badges.get(id)!} size="xs" detail={props.badgeDetails?.get(id)} /></>}
          </Text>
          <Text size="xs" c={props.printable ? undefined : 'dimmed'} lh={1.2}>{info.club}</Text>
        </>
      ) : (
        <Text size="sm" c="dimmed" fs="italic">{fallback}</Text>
      )}
    </Box>
  );
}

function CombatView(props: Props & { bracket: CombatBracket }) {
  const { bracket, entrants, results = {} } = props;
  const { matches, podium } = resolveBracket(bracket, results, props.tieBreaks ?? {});
  const numbers = new Map<string, number>();
  [...matches].filter((m) => !m.bye).sort((a, b) => a.order - b.order).forEach((m, i) => numbers.set(m.id, i + 1));
  const describe = (src: SlotSource): string => {
    switch (src.kind) {
      case 'winner':
        return `Vainqueur du combat ${numbers.get(src.matchId) ?? '?'}`;
      case 'loser':
        return `Perdant du combat ${numbers.get(src.matchId) ?? '?'}`;
      case 'poolRank':
        return `${src.rank === 1 ? '1er' : `${src.rank}e`} poule ${poolName(src.pool)}`;
      case 'beatenBy':
        return `Battu par le finaliste (tour ${src.round})`;
      case 'bye':
        return 'Exempt';
      default:
        return '—';
    }
  };
  const card = (m: ResolvedMatch) => {
    if (m.bye) {
      // À l'impression, l'exempté apparaît directement au tour suivant : la case est inutile.
      if (props.printable) return null;
      const who = m.entrantA ?? m.entrantB;
      return (
        <Paper key={m.id} withBorder p={6} data-testid="bracket-match" data-bye="true" style={{ opacity: 0.6 }}>
          <Text size="xs" c="dimmed">Exempt</Text>
          {who && <EntrantLine id={who} fallback="" info={entrants.get(who)} props={props} />}
        </Paper>
      );
    }
    const winA = m.result?.winner === 'a';
    const winB = m.result?.winner === 'b';
    const clickable = !props.printable && props.onMatchClick && m.playable;
    const stale = props.stale?.has(m.id);
    return (
      <Paper key={m.id} withBorder p={props.printable ? 4 : 6} data-testid="bracket-match" data-match={m.id}
        style={{ breakInside: 'avoid', cursor: clickable ? 'pointer' : undefined, borderColor: stale ? 'var(--mantine-color-orange-6)' : undefined }}
        onClick={() => clickable && props.onMatchClick!(m)}>
        <Text size="xs" c="dimmed">
          Combat {numbers.get(m.id)}{m.optional ? ' (si 1-1)' : ''}
          {m.result && !props.printable ? ` · ${METHOD_SHORT[m.result.method]}${m.result.score ? ` ${m.result.score}` : ''}` : ''}
          {m.result && props.printable && (m.result.method !== 'points' || m.result.score) ? ` · ${METHOD_SHORT[m.result.method]}${m.result.score ? ` ${m.result.score}` : ''}` : ''}
          {stale ? ' · à revoir' : ''}
        </Text>
        <EntrantLine id={m.entrantA} fallback={describe(m.a)} info={m.entrantA ? entrants.get(m.entrantA) : undefined} props={props} winner={winA} />
        {!props.printable && <Text size="xs" c="dimmed" ta="center">contre</Text>}
        <EntrantLine id={m.entrantB} fallback={describe(m.b)} info={m.entrantB ? entrants.get(m.entrantB) : undefined} props={props} winner={winB} />
      </Paper>
    );
  };

  const sections: { title: string; matches: ResolvedMatch[]; columns: boolean }[] = [];
  if (bracket.pools) {
    bracket.pools.forEach((_, p) => sections.push({ title: `Combats de la poule ${poolName(p)}`, matches: matches.filter((m) => m.phase === 'pool' && m.pool === p), columns: false }));
  }
  for (const phase of ['series', 'main', 'repechage', 'losers', 'third_place', 'grand_final'] as MatchPhase[]) {
    const list = matches.filter((m) => m.phase === phase);
    if (list.length) sections.push({ title: phase === 'main' ? 'Tableau' : PHASE_TITLES[phase], matches: list, columns: phase === 'main' || phase === 'losers' || phase === 'repechage' });
  }
  const showPodium = podium.complete && podium.first !== null && Object.keys(results).length > 0;

  return (
    <Stack data-testid="bracket-view" gap="md">
      {bracket.pools?.map((pool, p) => (
        <Text key={p} size="sm">
          <b>Poule {poolName(p)} :</b> {pool.map((id) => entrants.get(id)?.name ?? '?').join(' · ')}
        </Text>
      ))}
      {props.printable &&
        bracket.pools?.map((pool, p) => (
          <PoolGrid key={`grid-${p}`} title={`Poule ${poolName(p)}`} pool={pool} matches={matches.filter((m) => m.phase === 'pool' && m.pool === p)} entrants={entrants} numbers={numbers} />
        ))}
      {sections.map((s) => {
        if (props.printable && s.title.startsWith('Combats de la poule')) return null;
        if (!s.columns) {
          return (
            <Box key={s.title}>
              <Title order={5} mb={4}>{s.title}</Title>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>{s.matches.map(card)}</SimpleGrid>
            </Box>
          );
        }
        const rounds = [...new Set(s.matches.map((m) => m.round))].sort((a, b) => a - b);
        const maxRound = Math.max(...rounds);
        return (
          <Box key={s.title}>
            {s.title !== 'Tableau' && <Title order={5} mb={4}>{s.title}</Title>}
            <Group align="stretch" gap="md" wrap="nowrap" style={{ overflowX: props.printable ? 'visible' : 'auto' }}>
              {rounds.map((r) => (
                <Stack key={r} justify="space-around" gap={props.printable ? 4 : 'xs'} style={{ minWidth: props.printable ? 170 : 190 }}>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">{roundTitle(s.matches[0]!.phase, r, maxRound)}</Text>
                  {s.matches.filter((m) => m.round === r).sort((a, b) => a.order - b.order).map(card)}
                </Stack>
              ))}
            </Group>
          </Box>
        );
      })}
      {showPodium && <PodiumView podium={podium} entrants={entrants} />}
    </Stack>
  );
}

/** Poule imprimée en grille croisée : V = victoire de la ligne, D = défaite, n° du combat sinon. */
function PoolGrid({ title, pool, matches, entrants, numbers }: { title: string; pool: string[]; matches: ResolvedMatch[]; entrants: Map<string, EntrantInfo>; numbers: Map<string, number> }) {
  const cell = { border: '1px solid #000', padding: 6, textAlign: 'center' as const, minWidth: 48 };
  const between = (x: string, y: string) => matches.find((m) => (m.entrantA === x && m.entrantB === y) || (m.entrantA === y && m.entrantB === x));
  const wins = (x: string) => matches.filter((m) => m.result && (m.result.winner === 'a' ? m.entrantA : m.entrantB) === x).length;
  return (
    <Box data-testid="pool-grid">
      <Title order={5} mb={4}>{title}</Title>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: 'left' }}>Combattant</th>
            {pool.map((_, i) => <th key={i} style={cell}>{i + 1}</th>)}
            <th style={cell}>Victoires</th>
          </tr>
        </thead>
        <tbody>
          {pool.map((x, i) => (
            <tr key={x}>
              <td style={{ ...cell, textAlign: 'left' }}>
                <b>{i + 1}. {entrants.get(x)?.name}</b> <span style={{ fontSize: 12 }}>{entrants.get(x)?.club}</span>
              </td>
              {pool.map((y) => {
                if (x === y) return <td key={y} style={{ ...cell, background: '#bbb' }} />;
                const m = between(x, y);
                const won = m?.result ? (m.result.winner === 'a' ? m.entrantA : m.entrantB) === x : null;
                return <td key={y} style={cell}>{won === null ? <span style={{ fontSize: 11 }}>n° {m ? numbers.get(m.id) : ''}</span> : won ? <b>V</b> : 'D'}</td>;
              })}
              <td style={cell}>{matches.some((m) => m.result) ? wins(x) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

function PodiumView({ podium, entrants }: { podium: { first: string | null; second: string | null; thirds: string[] }; entrants: Map<string, EntrantInfo> }) {
  const name = (id: string | null) => (id ? `${entrants.get(id)?.name ?? '?'} (${entrants.get(id)?.club ?? ''})` : '—');
  return (
    <Paper withBorder p="sm" data-testid="bracket-podium">
      <Text fw={700}>Podium</Text>
      <Text>1er : {name(podium.first)}</Text>
      <Text>2e : {name(podium.second)}</Text>
      {podium.thirds.map((t) => <Text key={t}>3e : {name(t)}</Text>)}
    </Paper>
  );
}

function KataView(props: Props & { bracket: KataBracket }) {
  const { bracket, entrants, kataScores } = props;
  const resolved = kataScores ? resolveKata(bracket, kataScores, props.kataTieBreak ?? []) : null;
  return (
    <Stack data-testid="bracket-view">
      <Title order={5}>Ordre de passage{bracket.order.length > 2 ? ' — tour 1' : ' — finale'}</Title>
      <Table withTableBorder>
        <Table.Tbody>
          {bracket.order.map((id, i) => (
            <Table.Tr key={id} data-testid="bracket-match">
              <Table.Td w={40}>{i + 1}</Table.Td>
              <Table.Td>
                <EntrantLine id={id} fallback="" info={entrants.get(id)} props={props} />
                {entrants.get(id)?.grade && <Text size="xs" px={4} data-testid="kata-grade">Grade : {entrants.get(id)!.grade}</Text>}
              </Table.Td>
              {resolved && <Table.Td>{resolved.round1Ranking.find((r) => r.registrationId === id)?.score ?? ''}</Table.Td>}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {bracket.order.length > 2 && (
        <Group gap="xs">
          {!props.printable && <Badge variant="light">Finale</Badge>}
          <Text size="sm">Les deux meilleures notes du tour 1 présentent un 2e kata.</Text>
        </Group>
      )}
      {resolved?.podium.complete && <PodiumView podium={resolved.podium} entrants={entrants} />}
    </Stack>
  );
}
