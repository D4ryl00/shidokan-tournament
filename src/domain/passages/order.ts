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
  /** Finales à placer juste après le dernier combat de `nodes` (sans combat dans `nodes` : ordre normal). */
  finalsAfter?: MatchNode[];
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

/** Combat déjà placé sur la zone (repos). */
export interface PlacedMatch {
  categoryId: string;
  node: MatchNode;
}
type Item = PlacedMatch;
const shares = (x: Item, y: Item) => x.categoryId === y.categoryId && (x.node.feeds.includes(y.node.matchId) || y.node.feeds.includes(x.node.matchId));

/**
 * File d'une zone pour une vague, numérotée à partir de `first` : blocs de kata, puis combats groupés par distance à la fin
 * (« tour par tour » : catégories alternées ; « catégorie par catégorie » : chacune en entier). Dans un groupe, on prend le premier
 * combat qui laisse au moins deux combats de repos, sinon un, sinon le premier (signalé « pas de repos »). Les `finalsAfter`
 * d'une catégorie passent juste après son dernier combat. `before` : derniers combats de la zone avant cette file (repos ;
 * sans effet si la file commence par un bloc de kata).
 */
export function zoneOrder(cats: OrderCategory[], mode: PassageOrderMode, first: number, before: PlacedMatch[] = []): Passage[] {
  const sorted = [...cats].sort((a, b) => a.rank - b.rank);
  const out: Passage[] = [];
  let number = first;
  for (const c of sorted) if (c.kataEntrants !== null) out.push({ number: number++, categoryId: c.id, matchId: c.kataBlock ?? null, noRest: false });

  // Catégorie sans combat avant ses finales (combat unique, meilleur des trois) : ses finales dans l'ordre normal.
  const nodesOf = (c: OrderCategory) => (c.nodes.length > 0 ? c.nodes : (c.finalsAfter ?? []));
  const waiting = new Map(sorted.filter((c) => c.nodes.length > 0 && (c.finalsAfter?.length ?? 0) > 0).map((c) => [c.id, { left: c.nodes.length, finals: c.finalsAfter! }]));
  const distancesOf = (nodes: MatchNode[]) => [...new Set(nodes.map((n) => n.distance))].sort((a, b) => b - a);
  const at = (nodes: MatchNode[], d: number) => nodes.filter((n) => n.distance === d).sort(byPhase);

  const placed: Item[] = out.length > 0 ? [] : [...before];
  const place = (group: Item[]) => {
    const rest = [...group];
    while (rest.length) {
      const last = placed[placed.length - 1];
      const lastTwo = placed.slice(-2);
      const pick = rest.find((c) => !lastTwo.some((p) => shares(p, c))) ?? rest.find((c) => !last || !shares(last, c)) ?? rest[0]!;
      rest.splice(rest.indexOf(pick), 1);
      out.push({ number: number++, categoryId: pick.categoryId, matchId: pick.node.matchId, noRest: last !== undefined && shares(last, pick) });
      placed.push(pick);
      const w = waiting.get(pick.categoryId);
      if (w && --w.left === 0) {
        waiting.delete(pick.categoryId);
        for (const d of distancesOf(w.finals)) place(at(w.finals, d).map((node) => ({ categoryId: pick.categoryId, node })));
      }
    }
  };
  const combats = sorted.filter((c) => c.kataEntrants === null && nodesOf(c).length > 0);

  if (mode === 'categories') {
    for (const c of combats) for (const d of distancesOf(nodesOf(c))) place(at(nodesOf(c), d).map((node) => ({ categoryId: c.id, node })));
  } else {
    for (const d of distancesOf(combats.flatMap(nodesOf))) {
      const lists = combats.map((c) => at(nodesOf(c), d).map((node) => ({ categoryId: c.id, node })));
      const group: Item[] = [];
      for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) group.push(l[i]!);
      place(group);
    }
  }
  return out;
}
