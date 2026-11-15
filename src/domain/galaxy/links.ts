import { ageMove } from '../ages.js';
import type { CategoryKey } from '../categories.js';
import { DISCIPLINES } from '../disciplines.js';
import { weightClassesFor } from '../grid.js';
import { isRuleOn, withAllRules } from '../replacement/rules.js';
import { defaultSettings, type CompetitionSettings, type RuleId } from '../settings.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from '../types.js';
import { neighborWeightClasses } from '../weights.js';

// Voisinages de la galaxie des catégories (spec étape 48, §5.1) : les règles du moteur de réaffectation
// (`evaluate`, `ageCompatibility`), appliquées case par case entre catégories et non à un combattant.

export interface GalaxyNode { id: string; key: CategoryKey }
/** Règles pour aller de a vers b (`fromA`) et de b vers a (`fromB`) ; null = ce sens est interdit. a < b (ordre des id). */
export interface GalaxyLink { a: string; b: string; fromA: RuleId[] | null; fromB: RuleId[] | null }
export type LinkKind = 'weight' | 'age' | 'ruleset' | 'discipline' | 'sex';

/** Une case : une tranche, un poids (null sans poids), un sexe F ou M, rattachée à son nœud. */
interface Cell {
  node: string;
  discipline: DisciplineId;
  ruleset: Ruleset | null;
  sex: Sex;
  band: string;
  weight: string | null;
}

const SEXES: Sex[] = ['F', 'M'];
const AGE_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['ageUp', 'ageDown', 'seniorsVeterans', 'minorsAdults']);

/**
 * Cases d'une clé : tranches × classes de poids de la tranche, F et M pour une clé mixte. Une clé sans aucun poids
 * (kata) donne une case sans poids par tranche et par sexe. Un tableau libre n'a aucune case.
 */
export function cellsOf(key: CategoryKey, grid: CategoryGrid): CategoryKey[] {
  if (key.free !== undefined) return [];
  const sexes = key.sex === 'X' ? SEXES : [key.sex];
  const out: CategoryKey[] = [];
  for (const band of key.ageBandCodes) {
    for (const sex of sexes) {
      const cell = (weightClassIds: string[]): CategoryKey => ({ discipline: key.discipline, ruleset: key.ruleset, sex, ageBandCodes: [band], weightClassIds });
      const ids = key.weightClassIds.filter((id) => grid.weightClasses.some((w) => w.id === id && w.ageBandCode === band && w.sex === sex));
      if (ids.length > 0) out.push(...ids.map((id) => cell([id])));
      else if (key.weightClassIds.length === 0) out.push(cell([]));
    }
  }
  return out;
}

/** Rang d'un ensemble de règles = indice, dans replacementRules.order, de sa règle la plus loin ; beyondCut si cet indice dépasse celui de cutAfter. */
export function rulesRank(rules: RuleId[], settings: CompetitionSettings): { rank: number; beyondCut: boolean } {
  const { order, cutAfter } = settings.replacementRules;
  const rank = Math.max(-1, ...rules.map((r) => order.indexOf(r)));
  return { rank, beyondCut: rank > order.indexOf(cutAfter) };
}

/** Nature d'un lien, pour sa forme : la règle la plus marquante l'emporte. */
export function linkKind(rules: RuleId[]): LinkKind {
  if (rules.includes('mixSexes')) return 'sex';
  if (rules.includes('discipline')) return 'discipline';
  if (rules.includes('shobuToJiyu')) return 'ruleset';
  if (rules.some((r) => AGE_RULES.has(r))) return 'age';
  return 'weight';
}

/** Règles vues depuis `fromId` ; si ce sens est interdit, l'autre sens. */
export function rulesFrom(link: GalaxyLink, fromId: string): RuleId[] {
  const own = fromId === link.a ? link.fromA : link.fromB;
  const other = fromId === link.a ? link.fromB : link.fromA;
  return own ?? other ?? [];
}

const groupKey = (discipline: DisciplineId, ruleset: Ruleset | null, sex: Sex, band: string) => `${discipline}|${ruleset ?? ''}|${sex}|${band}`;

/** Poids de comparaison de chaque classe : sa limite, ou la limite précédente + 10 pour la classe ouverte. */
function comparisonKg(grid: CategoryGrid): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of grid.weightClasses) {
    if (w.maxKg !== null) out.set(w.id, w.maxKg);
    else {
      const limits = weightClassesFor(grid, w.ageBandCode, w.sex).map((x) => x.maxKg).filter((kg): kg is number => kg !== null);
      out.set(w.id, (limits.length ? Math.max(...limits) : 0) + 10);
    }
  }
  return out;
}

/** settings null = placement : toutes les règles actives, toutes les tranches au mélange F/M, ordre par défaut (RULE_IDS). */
export function galaxyLinks(nodes: GalaxyNode[], grid: CategoryGrid, settings: CompetitionSettings | null): GalaxyLink[] {
  const s = settings ?? withAllRules(defaultSettings(), grid);
  const kgOf = comparisonKg(grid);
  const isMinor = (band: string) => grid.ageBands.find((b) => b.code === band)?.isMinor ?? false;

  // Cases indexées par (discipline, règlement, sexe, tranche).
  const groups = new Map<string, Cell[]>();
  const cells: Cell[] = [];
  for (const n of nodes) {
    for (const k of cellsOf(n.key, grid)) {
      const c: Cell = { node: n.id, discipline: k.discipline, ruleset: k.ruleset, sex: k.sex as Sex, band: k.ageBandCodes[0]!, weight: k.weightClassIds[0] ?? null };
      cells.push(c);
      const g = groupKey(c.discipline, c.ruleset, c.sex, c.band);
      const list = groups.get(g);
      if (list) list.push(c);
      else groups.set(g, [c]);
    }
  }
  const group = (discipline: DisciplineId, ruleset: Ruleset | null, sex: Sex, band: string) => groups.get(groupKey(discipline, ruleset, sex, band)) ?? [];

  /** Cases du groupe, hors du nœud de `c`, dont la classe est la plus proche en kg de celle de `c` (toutes à égalité). */
  const nearest = (group: Cell[], c: Cell): Cell[] => {
    const targets = group.filter((t) => t.node !== c.node);
    const dist = (t: Cell) => {
      if (c.weight === null || t.weight === null) return c.weight === t.weight ? 0 : Infinity;
      return Math.abs((kgOf.get(c.weight) ?? Infinity) - (kgOf.get(t.weight) ?? Infinity));
    };
    const min = Math.min(...targets.map(dist));
    return Number.isFinite(min) ? targets.filter((t) => dist(t) <= min + 1e-9) : [];
  };

  /**
   * Compatibilité d'âge de la tranche `band` avec toutes les tranches d'arrivée, comme `ageCompatibility` du moteur
   * (dans les deux sens) : on monte dès que c'est permis, on ne descend que sinon. null = interdit.
   */
  const allowed = (x: ReturnType<typeof ageMove>) =>
    (x.kind === 'C' || x.kind === 'D') && (x.kind !== 'D' || s.mixSeniorsVeterans) && (!x.crossesMinorAdult || s.mixMinorsAdults);
  const ageCompatibility = (band: string, targetBands: string[]): { kind: 'same' | 'C' | 'D'; crossesMinorAdult: boolean; directions: Set<'up' | 'down'> } | null => {
    let kind: 'same' | 'C' | 'D' = 'same';
    let crossesMinorAdult = false;
    const directions = new Set<'up' | 'down'>();
    for (const b of targetBands) {
      if (b === band) continue;
      const up = ageMove(grid, band, b);
      const down = ageMove(grid, b, band);
      const goesUp = allowed(up);
      const link = goesUp ? up : allowed(down) ? down : null;
      if (!link || (link.kind !== 'C' && link.kind !== 'D')) return null;
      if (link.crossesMinorAdult) crossesMinorAdult = true;
      if (!targetBands.includes(band)) {
        kind = kind === 'D' ? 'D' : link.kind;
        directions.add(goesUp ? 'up' : 'down');
      }
    }
    return { kind, crossesMinorAdult, directions };
  };

  /**
   * Règles pour amener la case `c` dans la catégorie `tk`, comme `evaluate` puis `ruleProfile` du moteur (sans l'écart
   * de poids, qui dépend des combattants) ; null = interdit. `near` : classe de `c` et ses voisines.
   */
  const moveRules = (c: Cell, near: (string | null)[], tk: CategoryKey): RuleId[] | null => {
    const rules: RuleId[] = [];
    if (tk.discipline !== c.discipline) {
      if (!DISCIPLINES[c.discipline].inPreferences || !DISCIPLINES[tk.discipline].inPreferences) return null;
      rules.push('discipline');
    }
    if (tk.ruleset !== c.ruleset) {
      if (c.ruleset !== 'shobu' || tk.ruleset !== 'jiyu') return null;
      rules.push('shobuToJiyu');
    }
    // Pas de shobu pour une tranche mineure.
    if (tk.ruleset === 'shobu' && isMinor(c.band)) return null;
    // Une catégorie mixte (X) n'est jamais du même sexe : y entrer demande toujours le mélange.
    const sameSex = tk.sex === c.sex;
    if (!sameSex) {
      if (!s.mixSexes.ageBandCodes.includes(c.band)) return null;
      rules.push('mixSexes');
    }
    const ages = ageCompatibility(c.band, tk.ageBandCodes);
    if (!ages) return null;
    // Même sexe et même tranche : la catégorie doit avoir la classe de `c` ou une voisine.
    if (DISCIPLINES[tk.discipline].hasWeight && c.weight !== null && sameSex && tk.ageBandCodes.includes(c.band)) {
      if (!tk.weightClassIds.some((id) => near.includes(id))) return null;
    }
    if (ages.crossesMinorAdult) rules.push('minorsAdults');
    else if (ages.kind === 'D') rules.push('seniorsVeterans');
    else for (const d of ages.directions) rules.push(d === 'up' ? 'ageUp' : 'ageDown');
    // « Poids voisin » seulement quand aucune autre règle ne s'applique.
    if (rules.length === 0) rules.push('weight');
    return rules;
  };

  // Pour chaque sens (nœud de départ → nœud d'arrivée), l'ensemble de règles le moins coûteux.
  const keyOf = new Map(nodes.map((n) => [n.id, n.key]));
  const best = new Map<string, { from: string; to: string; rules: RuleId[]; rank: number }>();
  const consider = (from: Cell, near: (string | null)[], to: Cell) => {
    if (to.node === from.node) return;
    const rules = moveRules(from, near, keyOf.get(to.node)!);
    if (!rules || !rules.every((r) => isRuleOn(s, r))) return;
    const rank = rulesRank(rules, s).rank;
    const k = `${from.node}\n${to.node}`;
    const cur = best.get(k);
    if (!cur || rank < cur.rank || (rank === cur.rank && rules.length < cur.rules.length)) best.set(k, { from: from.node, to: to.node, rules, rank });
  };

  // Cases voisines de chaque case (le principe) ; les règles viennent ensuite de la catégorie d'arrivée entière.
  for (const c of cells) {
    const wc = c.weight === null ? undefined : grid.weightClasses.find((w) => w.id === c.weight);
    const { lighter, heavier } = wc ? neighborWeightClasses(grid, wc) : { lighter: null, heavier: null };
    const near = [c.weight, ...[lighter?.id, heavier?.id].filter((id): id is string => id !== undefined)];
    const nearby = (targets: Cell[]) => targets.filter((t) => near.includes(t.weight));

    // Même groupe, classe égale ou voisine.
    for (const t of nearby(group(c.discipline, c.ruleset, c.sex, c.band))) consider(c, near, t);

    // Shobu → jiyu, classe égale ou voisine (jamais l'inverse).
    if (c.ruleset === 'shobu') for (const t of nearby(group(c.discipline, 'jiyu', c.sex, c.band))) consider(c, near, t);

    // Autre discipline des préférences, même règlement ou shobu → jiyu, classe égale ou voisine.
    if (DISCIPLINES[c.discipline].inPreferences) {
      const rulesets: (Ruleset | null)[] = c.ruleset === 'shobu' ? ['shobu', 'jiyu'] : [c.ruleset];
      for (const d of Object.keys(DISCIPLINES) as DisciplineId[]) {
        if (d === c.discipline || !DISCIPLINES[d].inPreferences) continue;
        for (const rs of rulesets) for (const t of nearby(group(d, rs, c.sex, c.band))) consider(c, near, t);
      }
    }

    // Tranches reliées par la grille, classe la plus proche.
    const otherBands = new Set<string>();
    for (const l of grid.ageLinks) {
      if (l.from === c.band) otherBands.add(l.to);
      if (l.to === c.band) otherBands.add(l.from);
    }
    for (const band of otherBands) for (const t of nearest(group(c.discipline, c.ruleset, c.sex, band), c)) consider(c, near, t);

    // Autre sexe, même tranche, classe la plus proche.
    const other: Sex = c.sex === 'F' ? 'M' : 'F';
    for (const t of nearest(group(c.discipline, c.ruleset, other, c.band), c)) consider(c, near, t);
  }

  const links = new Map<string, GalaxyLink>();
  for (const { from, to, rules } of best.values()) {
    const [a, b] = from < to ? [from, to] : [to, from];
    const k = `${a}\n${b}`;
    const link = links.get(k) ?? { a, b, fromA: null, fromB: null };
    if (from === a) link.fromA = rules;
    else link.fromB = rules;
    links.set(k, link);
  }
  return [...links.values()].sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
}
