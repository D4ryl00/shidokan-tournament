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
import '../bracket.css';

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
  /** Numéros de passage (zone) ; vide : catégorie sans numéro de passage (« c1 », « c2 »… propres à la catégorie). */
  numbers?: Map<string, number>;
  /** Combats sans repos (« pas de repos : prévoir une pause »). */
  noRest?: Set<string>;
  /** Combats sur une autre zone que la catégorie : libellé (« Zone des finales : Ring », « Joué sur : Tatami 1 »). */
  matchZones?: Map<string, string>;
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

function EntrantLine({ id, fallback, info, props, winner, inline }: { id: string | null; fallback: string; info?: EntrantInfo; props: Props; winner?: boolean; inline?: boolean }) {
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
      {id && info && inline ? (
        <Text size="sm" lh={1.3} className="bracket-entrant-inline" fw={winner ? 800 : 400} td={winner ? 'underline' : undefined}>
          {info.name} <Text span size="xs">{info.club}</Text>
        </Text>
      ) : id && info ? (
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

/** Numéro affiché d'un combat : de passage, sinon « c3 » (propre à la catégorie) quand elle n'en a pas, sinon local. */
export function combatLabel(matchId: string, numbers: Map<string, number> | undefined, local: Map<string, number>): string {
  if (!numbers) return String(local.get(matchId) ?? '?');
  return numbers.size > 0 ? String(numbers.get(matchId) ?? '?') : `c${local.get(matchId) ?? '?'}`;
}

function CombatView(props: Props & { bracket: CombatBracket }) {
  const { bracket, entrants, results = {} } = props;
  const { matches, podium } = resolveBracket(bracket, results, props.tieBreaks ?? {});
  const local = new Map<string, number>();
  [...matches].filter((m) => !m.bye).sort((a, b) => a.order - b.order).forEach((m, i) => local.set(m.id, i + 1));
  const numbers = new Map([...local.keys()].map((id) => [id, combatLabel(id, props.numbers, local)]));
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
  const resultText = (m: ResolvedMatch) =>
    m.result && (!props.printable || m.result.method !== 'points' || m.result.score) ? `${METHOD_SHORT[m.result.method]}${m.result.score ? ` ${m.result.score}` : ''}` : '';
  /** Combat d'un arbre : en-tête (numéro, résultat), puis les deux combattants l'un sous l'autre. */
  const treeCard = (m: ResolvedMatch) => {
    const clickable = !props.printable && props.onMatchClick && m.playable;
    const stale = props.stale?.has(m.id);
    const row = (id: string | null, src: SlotSource, winner: boolean) => (
      <Box className="bracket-card-row" px={2} py={1}>
        <EntrantLine id={id} fallback={describe(src)} info={id ? entrants.get(id) : undefined} props={props} winner={winner} inline={props.printable} />
      </Box>
    );
    return (
      <Paper key={m.id} withBorder className="bracket-card" data-testid="bracket-match" data-match={m.id} data-bye={m.bye ? 'true' : undefined}
        style={{ breakInside: 'avoid', overflow: 'visible', cursor: clickable ? 'pointer' : undefined, opacity: m.bye ? 0.6 : undefined, borderColor: stale ? 'var(--mantine-color-orange-6)' : undefined }}
        onClick={() => clickable && props.onMatchClick!(m)}>
        <div className="bracket-card-head">
          <Text size="xs" fw={700}>{m.bye ? 'Exempt' : `Combat ${numbers.get(m.id)}${m.optional ? ' (si 1-1)' : ''}`}</Text>
          <Text size="xs" c="dimmed" ta="right">
            {resultText(m)}
            {stale ? ' · à revoir' : ''}
            {!props.printable && props.noRest?.has(m.id) ? ' · pas de repos : prévoir une pause' : ''}
          </Text>
        </div>
        {props.matchZones?.get(m.id) && <Text size="xs" fw={700} px={6} data-testid="match-zone">{props.matchZones.get(m.id)}</Text>}
        {m.bye ? row(m.entrantA ?? m.entrantB, m.a, false) : (
          <>
            {row(m.entrantA, m.a, m.result?.winner === 'a')}
            {row(m.entrantB, m.b, m.result?.winner === 'b')}
          </>
        )}
      </Paper>
    );
  };
  /** Même carte pour tous les combats (arbre, poule, manches, repêchage) ; à l'impression, une exemption n'a pas de case. */
  const card = (m: ResolvedMatch) => (m.bye && props.printable ? null : treeCard(m));

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
          <Box key={`grid-${p}`}>
            <PoolGrid title={`Poule ${poolName(p)}`} pool={pool} matches={matches.filter((m) => m.phase === 'pool' && m.pool === p)} entrants={entrants} numbers={numbers} />
            <PoolOrder matches={matches.filter((m) => m.phase === 'pool' && m.pool === p)} entrants={entrants} numbers={numbers} />
          </Box>
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
        const tree = s.title === 'Tableau' ? treeRounds(s.matches) : null;
        if (tree) {
          return (
            <Box key={s.title} className={tree[0]!.length >= 8 ? 'bracket-tree is-large' : 'bracket-tree'} data-testid="bracket-tree" style={{ ['--bracket-first-round' as string]: tree[0]!.length }}>
              {tree.map((list, r) => (
                <div key={r} className="bracket-round">
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4}>{roundTitle('main', r + 1, tree.length)}</Text>
                  <div className="bracket-round-body">
                    {list.map((m, k) => {
                      // À l'impression, une exemption laisse sa case vide : l'exempté apparaît directement au tour suivant.
                      const hidden = m.bye && props.printable;
                      const fed = r > 0 && tree[r - 1]!.slice(2 * k, 2 * k + 2).some((x) => !(x.bye && props.printable));
                      const cls = ['bracket-slot', !hidden && r < tree.length - 1 ? 'has-next' : '', k % 2 === 0 ? 'pair-top' : 'pair-bottom', fed ? 'has-prev' : ''];
                      return (
                        <div key={m.id} className={cls.filter(Boolean).join(' ')}>
                          {!hidden && treeCard(m)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </Box>
          );
        }
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

/**
 * Tours d'un tableau à élimination rangés pour l'arbre : le combat k d'un tour est alimenté par les combats 2k et 2k+1
 * du tour précédent. `null` si le tableau n'a pas cette forme (il s'affiche alors en colonnes simples).
 */
export function treeRounds(matches: ResolvedMatch[]): ResolvedMatch[][] | null {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const byRound = rounds.map((r) => matches.filter((m) => m.round === r).sort((a, b) => a.order - b.order));
  if (byRound.length === 0 || byRound.at(-1)!.length !== 1) return null;
  for (let r = 1; r < byRound.length; r++) {
    if (byRound[r]!.length * 2 !== byRound[r - 1]!.length) return null;
    const ok = byRound[r]!.every((m, k) =>
      [m.a, m.b].every((src, i) => src.kind === 'winner' && src.matchId === byRound[r - 1]![2 * k + i]!.id),
    );
    if (!ok) return null;
  }
  return byRound;
}

/** Ordre des combats d'une poule imprimée (les numéros de la grille, dans l'ordre de passage). */
function PoolOrder({ matches, entrants, numbers }: { matches: ResolvedMatch[]; entrants: Map<string, EntrantInfo>; numbers: Map<string, string> }) {
  const n = (m: ResolvedMatch) => Number(String(numbers.get(m.id) ?? '').replace(/^c/, '')) || 0;
  const name = (id: string | null) => (id ? (entrants.get(id)?.name ?? '?') : '?');
  return (
    <Box mt={6} data-testid="pool-order">
      <Text size="sm" fw={700}>Ordre des combats</Text>
      {[...matches].sort((a, b) => n(a) - n(b)).map((m) => (
        <Text key={m.id} size="sm">
          <b>Combat {numbers.get(m.id)}</b> : {name(m.entrantA)} contre {name(m.entrantB)}
          {m.result ? ` — vainqueur ${name(m.result.winner === 'a' ? m.entrantA : m.entrantB)}` : ''}
        </Text>
      ))}
    </Box>
  );
}

/** Poule imprimée en grille croisée : V = victoire de la ligne, D = défaite, n° du combat sinon. */
function PoolGrid({ title, pool, matches, entrants, numbers }: { title: string; pool: string[]; matches: ResolvedMatch[]; entrants: Map<string, EntrantInfo>; numbers: Map<string, string> }) {
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
