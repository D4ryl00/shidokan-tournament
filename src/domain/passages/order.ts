import type { MatchPhase } from '../brackets/index.js';
import type { PassageOrderMode } from '../settings.js';
import type { MatchNode } from './graph.js';

/** Catégorie d'une zone : bloc de kata (`kataEntrants` non null) ou combats numérotés. */
export interface OrderCategory {
  id: string;
  rank: number;
  kataEntrants: number | null;
  /** Bloc de kata émis (`matchId` du passage) : null = catégorie entière, sinon 'kata:tour1' ou 'kata:finale'. */
  kataBlock?: string | null;
  nodes: MatchNode[];
}
/** Numéro de passage : un combat, ou un bloc de kata (`matchId` null : entier ; 'kata:tour1' / 'kata:finale'). */
export interface Passage {
  number: number;
  categoryId: string;
  matchId: string | null;
  /** Aucun combat entre ce combat et le précédent d'un même combattant : prévoir une pause. */
  noRest: boolean;
}

const PHASES: MatchPhase[] = ['pool', 'series', 'losers', 'repechage', 'third_place', 'main', 'grand_final'];
const byPhase = (a: MatchNode, b: MatchNode) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.order - b.order;

interface Item {
  categoryId: string;
  node: MatchNode;
}
const shares = (x: Item, y: Item) => x.categoryId === y.categoryId && (x.node.feeds.includes(y.node.matchId) || y.node.feeds.includes(x.node.matchId));

/**
 * File d'une zone pour une vague, numérotée à partir de `first` : blocs de kata, puis combats groupés par distance à la fin
 * (« tour par tour » : catégories alternées ; « catégorie par catégorie » : chacune en entier). Dans un groupe, on prend le premier
 * combat qui laisse au moins deux combats de repos, sinon un, sinon le premier (signalé « pas de repos »).
 */
export function zoneOrder(cats: OrderCategory[], mode: PassageOrderMode, first: number): Passage[] {
  const sorted = [...cats].sort((a, b) => a.rank - b.rank);
  const out: Passage[] = [];
  let number = first;
  for (const c of sorted) if (c.kataEntrants !== null) out.push({ number: number++, categoryId: c.id, matchId: c.kataBlock ?? null, noRest: false });

  const placed: Item[] = [];
  const place = (group: Item[]) => {
    const rest = [...group];
    while (rest.length) {
      const last = placed[placed.length - 1];
      const lastTwo = placed.slice(-2);
      const pick = rest.find((c) => !lastTwo.some((p) => shares(p, c))) ?? rest.find((c) => !last || !shares(last, c)) ?? rest[0]!;
      rest.splice(rest.indexOf(pick), 1);
      out.push({ number: number++, categoryId: pick.categoryId, matchId: pick.node.matchId, noRest: last !== undefined && shares(last, pick) });
      placed.push(pick);
    }
  };
  const combats = sorted.filter((c) => c.kataEntrants === null && c.nodes.length > 0);
  const distancesOf = (cs: OrderCategory[]) => [...new Set(cs.flatMap((c) => c.nodes.map((n) => n.distance)))].sort((a, b) => b - a);
  const at = (c: OrderCategory, d: number) => c.nodes.filter((n) => n.distance === d).sort(byPhase);

  if (mode === 'categories') {
    for (const c of combats) for (const d of distancesOf([c])) place(at(c, d).map((node) => ({ categoryId: c.id, node })));
  } else {
    for (const d of distancesOf(combats)) {
      const lists = combats.map((c) => at(c, d).map((node) => ({ categoryId: c.id, node })));
      const group: Item[] = [];
      for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) group.push(l[i]!);
      place(group);
    }
  }
  return out;
}
