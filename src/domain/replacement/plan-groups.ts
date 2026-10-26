import { applyAll } from './move.js';
import {
  GroupSolver,
  cardByCardReplay,
  cmp,
  compareScores,
  moversOf,
  openCases,
  optionsOf,
  relate,
  scoreOf,
  subState,
  type SearchContext,
  type SearchMove,
  type Solution,
} from './plan-search.js';
import type { State } from './types.js';

export interface GroupsResult {
  /** Déplacements de tous les groupes, dans l'ordre des groupes (plus petite inscription d'abord) puis de leur recherche. */
  moves: SearchMove[];
  onCards: string[];
  /** Chaque recherche est allée au bout dans son budget, et le point fixe entre groupes est atteint. */
  proven: boolean;
  /** Pour mesurer : membres de chaque groupe (dernier tour), nœuds visités, tours du point fixe. */
  stats: { groupSizes: number[]; nodes: number; rounds: number };
}

interface Group {
  categories: Set<string>;
  first: string;
}

const groupKey = (g: Group) => [...g.categories].sort(cmp).join('|');

/**
 * Meilleur plan des cas ouverts de `cur` (l'état après les choix), groupe par groupe :
 * 1. l'ancien calcul « carte par carte » est rejoué une fois sur tout l'état ; ses déplacements relient ce qu'ils touchent ;
 * 2. les cas sont découpés en groupes indépendants (`relate`), chaque groupe part de sa part du rejeu et cherche mieux ;
 * 3. point fixe : dans l'état final, si un cas encore en attente a une option qui touche un autre groupe (une chaîne de
 *    plusieurs déplacements a ouvert une porte que la découpe ne voyait pas), les groupes concernés sont réunis et
 *    recalculés, jusqu'à stabilité (au plus autant de tours que de groupes).
 * Le plan n'est jamais moins bon que le rejeu : chaque groupe garde sa part du rejeu tant qu'il ne trouve pas mieux.
 */
export function solveGroups(cur: State, ctx: SearchContext, budget: number, pool?: { left: number }): GroupsResult {
  const replay = cardByCardReplay(cur, ctx);
  const cases = openCases(cur, ctx, new Set());
  const rel = relate(cur, ctx, new Set(), cases, {
    link: (union) => {
      for (const nodes of replay.touched) for (const n of nodes.slice(1)) union(nodes[0]!, n);
    },
  });
  let groups: Group[] = rel.components.map((g) => ({ categories: g.categories, first: [...g.cases.map((c) => c.registrationId)].sort(cmp)[0]! }));
  const memo = new Map<string, Solution>();
  const solved = new Map<string, { sol: Solution; exhausted: boolean }>();
  let nodes = 0;

  for (let round = 0; ; round++) {
    // Part du rejeu de chaque groupe : les déplacements dont une catégorie touchée est à lui (catégories créées en route comprises).
    const owner = new Map<string, number>();
    groups.forEach((g, i) => g.categories.forEach((id) => owner.set(id, i)));
    const share = groups.map((): SearchMove[] => []);
    replay.moves.forEach((m, i) => {
      const ids = replay.touched[i]!.filter((n) => !n.startsWith('r:')).map((n) => (n.startsWith('k:') ? `new:${n.slice(2)}` : n.slice(2)));
      const gi = ids.map((id) => owner.get(id)).find((x) => x !== undefined);
      if (gi === undefined) return;
      share[gi]!.push(m);
      for (const id of ids) owner.set(id, gi);
    });

    let exhausted = false;
    const results = groups.map((g, i) => {
      const key = groupKey(g);
      const known = solved.get(key);
      if (known) {
        exhausted ||= known.exhausted;
        return known.sol;
      }
      const sub = subState(cur, g.categories);
      const incumbent = scoreOf(sub, ctx, share[i]!);
      const solver = new GroupSolver(ctx, budget, memo, pool);
      const found = solver.solve(sub, new Set(), new Map(), incumbent.score);
      const sol = found && compareScores(found.score, incumbent.score) < 0 ? found : incumbent;
      solved.set(key, { sol, exhausted: solver.exhausted });
      nodes += solver.visited;
      exhausted ||= solver.exhausted;
      return sol;
    });

    // Fusion, en notant le groupe de chaque catégorie (celles créées par un groupe lui appartiennent).
    let final = cur;
    const catGroup = new Map<string, number>();
    groups.forEach((g, i) => g.categories.forEach((id) => catGroup.set(id, i)));
    const moved = new Set<string>();
    results.forEach((sol, i) => {
      for (const m of sol.moves) {
        final = applyAll(final, m.p);
        for (const r of moversOf(m.p)) moved.add(r);
        const arrival = final.members.find((x) => x.registrationId === m.p.registrationId)?.categoryId;
        if (arrival && !catGroup.has(arrival)) catGroup.set(arrival, i);
      }
    });
    const done = (stable: boolean): GroupsResult => ({
      moves: results.flatMap((sol) => sol.moves),
      onCards: [...new Set(results.flatMap((sol) => sol.onCards))].sort(cmp),
      proven: stable && !exhausted,
      stats: { groupSizes: groups.map((g) => cur.members.filter((m) => m.categoryId !== null && g.categories.has(m.categoryId)).length), nodes, rounds: round + 1 },
    });

    // Point fixe : une option d'un cas en attente qui touche un autre groupe (ou une catégorie d'aucun groupe) les réunit.
    const merge = new Map<number, Set<number>>();
    const adopted = new Map<number, Set<string>>();
    for (const c of openCases(final, ctx, moved)) {
      const own = catGroup.get(c.categoryId ?? '');
      for (const o of optionsOf(final, c, ctx, moved)) {
        const ids = ['categoryId' in o.p.target ? o.p.target.categoryId : null, ...moversOf(o.p).map((r) => final.members.find((x) => x.registrationId === r)?.categoryId ?? null)]
          .filter((id): id is string => id !== null);
        const touched = ids.map((id) => catGroup.get(id));
        if (own === undefined || touched.some((g) => g !== own)) {
          const anchor = own ?? touched.find((g) => g !== undefined);
          if (anchor === undefined) continue;
          const set = merge.get(anchor) ?? new Set<number>();
          for (const g of touched) if (g !== undefined) set.add(g);
          merge.set(anchor, set);
          const extra = adopted.get(anchor) ?? new Set<string>();
          for (const id of [c.categoryId ?? '', ...ids]) if (id && catGroup.get(id) === undefined && cur.categories.some((x) => x.id === id)) extra.add(id);
          adopted.set(anchor, extra);
        }
      }
    }
    if (merge.size === 0) return done(true);
    if (round >= rel.components.length) return done(false);

    // Réunion des groupes (union-find sur les indices), puis nouveau tour.
    const parent = groups.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (const [a, set] of merge) for (const b of set) parent[Math.max(find(a), find(b))] = Math.min(find(a), find(b));
    const next = new Map<number, Group>();
    groups.forEach((g, i) => {
      const r = find(i);
      const t = next.get(r) ?? { categories: new Set<string>(), first: g.first };
      g.categories.forEach((id) => t.categories.add(id));
      adopted.get(i)?.forEach((id) => t.categories.add(id));
      if (cmp(g.first, t.first) < 0) t.first = g.first;
      next.set(r, t);
    });
    groups = [...next.values()].sort((a, b) => cmp(a.first, b.first));
  }
}
