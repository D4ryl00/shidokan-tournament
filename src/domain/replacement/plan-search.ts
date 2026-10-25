import { keyString, naturalKey, type CategoryKey } from '../categories.js';
import type { RuleId } from '../settings.js';
import { neighborWeightClasses } from '../weights.js';
import { detectCases, isClosedMember, isLocked, keyLookup } from './detect.js';
import { applyAll } from './move.js';
import { proposalsFor, ruleProfile, rulesForMove } from './propose.js';
import { ruleRank } from './rules.js';
import type { Case, CaseKind, CategoryState, Member, Proposal, State } from './types.js';
import { casesOfWave, categoryWaves } from './waves.js';
import { activeMembers, weighInClass } from './weights.js';

/** Nombre de nœuds de la recherche, par groupe : une limite fixe, jamais un temps, pour qu'un même état donne le même plan. */
export const DEFAULT_NODE_BUDGET = 20_000;

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (xs: Iterable<string>) => [...xs].sort(cmp);

/**
 * Combattants seuls de la session (`null` : toutes les catégories non lancées), triés : les actifs (présents ou non
 * pointés) seuls parmi les actifs de leur catégorie, et les inscrits non déplacés d'une catégorie fermée.
 */
export function aloneRegistrations(state: State, waveId: string | null): string[] {
  const waves = waveId === null ? null : categoryWaves(state);
  const byCategory = new Map<string, Member[]>();
  for (const m of state.members) {
    if (!m.categoryId || m.presence === 'absent') continue;
    byCategory.set(m.categoryId, [...(byCategory.get(m.categoryId) ?? []), m]);
  }
  const out: string[] = [];
  for (const c of state.categories) {
    if (isLocked(c) || (waves && waves.get(c.id) !== waveId)) continue;
    const active = byCategory.get(c.id) ?? [];
    // Comme detectCases : un inscrit d'une catégorie fermée est seul, et n'est l'adversaire de personne.
    const open = active.filter((m) => !isClosedMember(state, m));
    out.push(...active.filter((m) => isClosedMember(state, m)).map((m) => m.registrationId));
    if (open.length === 1) out.push(open[0]!.registrationId);
  }
  return sorted(out);
}

export interface SearchContext {
  waveId: string | null;
  /** Règles que le calcul peut utiliser lui-même. */
  allowed: ReadonlySet<RuleId>;
  forApply: boolean;
  /** Inscriptions déjà déplacées par un choix de l'organisateur : jamais reprises par le calcul. */
  excluded: ReadonlySet<string>;
}

/** Un déplacement possible, avec ce qu'il ajoute au score. */
export interface SearchMove {
  p: Proposal;
  /** Rang (dans la liste) de sa règle la plus coûteuse ; -1 : aucune (correction de poids dans l'écart). */
  cost: number;
  moved: number;
  preference: number;
  /** Écart de poids en centièmes de kg (entiers : pas d'erreur d'arrondi). */
  gap: number;
}

const KIND_ORDER: CaseKind[] = ['return', 'weight_out', 'closed', 'alone'];
export const moversOf = (p: Pick<Proposal, 'registrationId' | 'alsoMoved'>) => [p.registrationId, ...(p.alsoMoved ?? [])];

const isOpen = (s: State, ctx: SearchContext, decided: ReadonlySet<string>) => (c: Case) =>
  c.kind !== 'weight_gap' && !s.setAside.includes(c.id) && !decided.has(c.registrationId) && !ctx.excluded.has(c.registrationId);

/** Cas que le plan traite : ceux de la session, sans les cartes mises de côté, les écarts de poids ni les inscriptions décidées. */
export function openCases(s: State, ctx: SearchContext, decided: ReadonlySet<string>): Case[] {
  return casesOfWave(s, detectCases(s), ctx.waveId)
    .filter(isOpen(s, ctx, decided))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || cmp(a.registrationId, b.registrationId));
}

/** Rang de la règle la plus coûteuse d'une proposition (-1 si elle n'en a aucune : correction de poids dans l'écart). */
export function costRank(s: State, p: Pick<Proposal, 'registrationId' | 'rules'>): number {
  const m = s.members.find((x) => x.registrationId === p.registrationId) ?? { ruleset: null, acceptsJiyuFirst: null };
  return p.rules.reduce((best, r) => Math.max(best, ruleRank(s.settings, r, m)), -1);
}

/** Options d'un cas dans l'état `s` : les propositions permises, sans changement de session, de la moins coûteuse à la plus coûteuse. */
export function optionsOf(s: State, c: Case, ctx: SearchContext, decided: ReadonlySet<string>): SearchMove[] {
  const out: SearchMove[] = [];
  for (const p of proposalsFor(reachable(s, c.registrationId), c)) {
    if (p.waveChange || p.waveShifts.length > 0) continue;
    if (moversOf(p).some((r) => r !== c.registrationId && (decided.has(r) || ctx.excluded.has(r)))) continue;
    // Retour et correction de poids s'imposent : seule la validation compte (pour appliquer, jamais un déplacement à valider).
    const ok = ruleProfile(s, p).forced ? !ctx.forApply || !p.manual : p.rules.every((r) => ctx.allowed.has(r));
    if (!ok) continue;
    const m = s.members.find((x) => x.registrationId === p.registrationId);
    const preference = p.changes.discipline && m ? Math.max(0, m.otherDisciplines.indexOf(p.changes.discipline)) : 0;
    out.push({ p, cost: costRank(s, p), moved: moversOf(p).length, preference, gap: Math.round(p.checks.weightGapKg * 100) });
  }
  return out.sort((a, b) => a.cost - b.cost || a.p.rank - b.p.rank);
}

const lookups = new WeakMap<object, (ks: string) => CategoryState | undefined>();
/** `categoryForKey`, avec un index gardé tant que la liste des catégories est la même (les états ne sont jamais modifiés). */
function categoryFor(s: State, ks: string): CategoryState | undefined {
  let lookup = lookups.get(s.categories);
  if (!lookup) {
    lookup = keyLookup(s);
    lookups.set(s.categories, lookup);
  }
  return lookup(ks);
}

/** Recasé parce qu'il était seul : il peut revenir dans sa catégorie d'origine dès qu'elle a un adversaire. */
const mayReturn = (m: Member) => m.placementLocked && m.original !== null && m.presence !== 'absent' && (!m.original.reason || m.original.reason === 'alone');
const homeKey = (m: Member) => keyString(naturalKey({ ...m.original! }, m));
const weightOutKey = (s: State, m: Member) => {
  const wic = weighInClass(m, s);
  return wic ? keyString(naturalKey({ ...m, weightClassId: wic.id }, m)) : null;
};

/** Sous-état : ces catégories et leurs inscrits (même grille, réglages, sessions, refus, cases fermées, cartes de côté). */
export function subState(s: State, categories: ReadonlySet<string>): State {
  return {
    ...s,
    categories: s.categories.filter((c) => categories.has(c.id)),
    members: s.members.filter((m) => m.categoryId !== null && categories.has(m.categoryId)),
  };
}

const linksOf = new WeakMap<object, Set<string>>();

/**
 * Le combattant `m` pourrait-il avoir une proposition vers une catégorie de clé `key` : discipline qu'il pratique, accepte
 * ou avait au départ (retour), et même tranche ou une tranche reliée dans la grille. C'est une condition nécessaire de
 * `evaluate`, du « split », du retour et de la correction de poids : une sur-approximation bon marché, sans le poids.
 */
function makeNear(s: State) {
  let links = linksOf.get(s.grid);
  if (!links) {
    links = new Set(s.grid.ageLinks.flatMap((l) => [`${l.from}>${l.to}`, `${l.to}>${l.from}`]));
    linksOf.set(s.grid, links);
  }
  const linked = links;
  return (m: Member, key: CategoryKey): boolean => {
    const disciplineOk = key.discipline === m.discipline || m.original?.discipline === key.discipline || m.otherDisciplines.includes(key.discipline);
    return disciplineOk && key.ageBandCodes.some((b) => b === m.ageBandCode || linked.has(`${m.ageBandCode}>${b}`));
  };
}

/**
 * La partie de l'état où les propositions d'une inscription peuvent se trouver (sa catégorie, et celles qu'elle peut
 * atteindre) : `proposalsFor` y rend exactement les mêmes propositions, dans le même ordre, sans parcourir tout l'état.
 */
function reachable(s: State, registrationId: string): State {
  const m = s.members.find((x) => x.registrationId === registrationId);
  if (!m) return s;
  const near = makeNear(s);
  const ids = new Set(s.categories.filter((c) => c.id === m.categoryId || near(m, c.key)).map((c) => c.id));
  return ids.size === s.categories.length ? s : subState(s, ids);
}

// ---------------------------------------------------------------------------------------------------------------
// Relation « peuvent interagir »

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let root = x;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    if (!this.parent.has(x)) this.parent.set(x, x);
    for (let cur = x; cur !== root; ) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    // Racine la plus petite : indépendant de l'ordre des unions.
    if (ra < rb) this.parent.set(rb, ra);
    else if (rb < ra) this.parent.set(ra, rb);
  }
}

export interface Component {
  cases: Case[];
  categories: Set<string>;
}

export interface Relation {
  components: Component[];
  /** Options (permises) de chaque cas, par inscription. */
  options: Map<string, SearchMove[]>;
}

interface Mover {
  c: Case;
  /** Vrai : un cas ; faux : un combattant qu'un autre déplacement peut laisser seul (« cas en puissance »). */
  real: boolean;
  options: SearchMove[];
}

/**
 * Découpe des cas en composantes indépendantes : deux cas sont ensemble quand, dans l'état `s` :
 * (a) leurs options touchent une même catégorie (cible, ou source, celle d'un « split » comprise) ;
 * (b) la catégorie de l'un est la cible d'une option de l'autre (deux seuls qui se rejoignent) ;
 * (c) un déplacement de l'un peut laisser seul un combattant dont les options touchent l'autre (cas en puissance) ;
 * (d) appliquer une option de l'un fait apparaître une option permise de l'autre (élargissement en un pas : la cible
 *     s'élargit, ou la source s'allège) ;
 * plus les liens de déplacements réels : une correction de poids et la clé de sa catégorie de poids réel, un recasé et sa
 * catégorie d'origine. Le calcul n'est prouvé que pour ces élargissements en un pas : une chaîne de plusieurs
 * déplacements qui ouvrirait une option ailleurs n'est pas explorée (le point fixe de `computePlan` en rattrape la fin).
 * `link` ajoute des liens (le déplacement d'un plan déjà connu).
 */
export function relate(
  s: State,
  ctx: SearchContext,
  decided: ReadonlySet<string>,
  cases: Case[],
  opts: { link?: (union: (a: string, b: string) => void) => void; known?: Map<string, SearchMove[]> } = {},
): Relation {
  const uf = new UnionFind();
  const byId = new Map(s.members.map((m) => [m.registrationId, m]));
  const byCategory = new Map<string, Member[]>();
  for (const m of s.members) if (m.categoryId && m.presence !== 'absent') byCategory.set(m.categoryId, [...(byCategory.get(m.categoryId) ?? []), m]);
  const near = makeNear(s);
  const extraLocked = new Map<string, Set<string>>();
  const linkKey = (node: string, ks: string) => {
    uf.union(node, `k:${ks}`);
    const existing = categoryFor(s, ks);
    if (!existing) return;
    if (!isLocked(existing)) uf.union(`k:${ks}`, `c:${existing.id}`);
    // Une catégorie lancée n'est ni cible ni source, mais le sous-état doit la connaître (sinon on la recréerait).
    else extraLocked.set(`k:${ks}`, (extraLocked.get(`k:${ks}`) ?? new Set()).add(existing.id));
  };
  const touched = (p: Proposal): string[] => [
    'categoryId' in p.target ? `c:${p.target.categoryId}` : `k:${keyString(p.target.newKey)}`,
    ...moversOf(p).map((r) => `c:${byId.get(r)?.categoryId ?? ''}`),
  ];

  const movers: Mover[] = cases.map((c) => ({ c, real: true, options: opts.known?.get(c.registrationId) ?? optionsOf(s, c, ctx, decided) }));
  const isMover = new Set(cases.map((c) => c.registrationId));
  // Qui peut partir de sa catégorie : ceux qui se déplacent dans une option (`strong` : d'eux-mêmes, pas emmenés par un
  // « split », qui laisse toujours au moins deux actifs), et les recasés qui peuvent revenir.
  const canLeave = new Set<string>();
  const strong = new Set<string>();
  const returners = s.members.filter((m) => mayReturn(m) && !decided.has(m.registrationId) && !ctx.excluded.has(m.registrationId) && m.categoryId && !isLocked(s.categories.find((c) => c.id === m.categoryId)));
  for (const m of returners) {
    canLeave.add(m.registrationId);
    strong.add(m.registrationId);
  }
  const noteLeavers = (mv: Mover) => {
    for (const o of mv.options) {
      for (const r of moversOf(o.p)) canLeave.add(r);
      if (o.p.registrationId === mv.c.registrationId) strong.add(mv.c.registrationId);
    }
  };
  movers.forEach(noteLeavers);
  // (c) Cas en puissance, jusqu'au point fixe.
  for (let changed = true; changed; ) {
    changed = false;
    const categories = new Set([...strong].map((r) => byId.get(r)?.categoryId).filter((id): id is string => !!id));
    for (const id of sorted(categories)) {
      const open = (byCategory.get(id) ?? []).filter((m) => !isClosedMember(s, m));
      for (const y of open) {
        if (isMover.has(y.registrationId) || decided.has(y.registrationId) || ctx.excluded.has(y.registrationId)) continue;
        const others = open.filter((o) => o !== y);
        if (others.length === 0 || !others.every((o) => canLeave.has(o.registrationId)) || !others.some((o) => strong.has(o.registrationId))) continue;
        const c: Case = { id: `alone:${y.registrationId}`, kind: 'alone', registrationId: y.registrationId, categoryId: id, detail: '' };
        const mv: Mover = { c, real: false, options: optionsOf(s, c, ctx, decided) };
        movers.push(mv);
        isMover.add(y.registrationId);
        noteLeavers(mv);
        changed = true;
      }
    }
  }

  // (a), (b), (c) : chaque cas (ou cas en puissance) est relié à sa catégorie et à tout ce que ses options touchent.
  for (const mv of movers) {
    const node = `r:${mv.c.registrationId}`;
    uf.union(node, `c:${mv.c.categoryId}`);
    for (const o of mv.options) for (const t of touched(o.p)) uf.union(node, t);
    if (mv.c.kind === 'weight_out') {
      const m = byId.get(mv.c.registrationId);
      const ks = m ? weightOutKey(s, m) : null;
      if (ks) linkKey(node, ks);
    }
  }
  for (const m of returners) linkKey(`c:${m.categoryId}`, homeKey(m));
  opts.link?.((a, b) => uf.union(a, b));

  // (d) Élargissement en un pas : après une option de X, Y obtient-il une option permise vers ce que X a touché ?
  const widenable = movers.filter((mv) => mv.c.kind === 'alone' || mv.c.kind === 'closed');
  if (widenable.length > 0) {
    for (const x of movers) {
      for (const o of x.options) {
        const touchedIds = new Set(touched(o.p).filter((n) => n.startsWith('c:')).map((n) => n.slice(2)));
        let after: State | null = null;
        for (const y of widenable) {
          if (y === x || moversOf(o.p).includes(y.c.registrationId) || uf.find(`r:${y.c.registrationId}`) === uf.find(`r:${x.c.registrationId}`)) continue;
          const ym = byId.get(y.c.registrationId);
          if (!ym) continue;
          after ??= applyAll(subState(s, touchedIds), o.p);
          if (opensOption(after, ym, y.c, ctx, near)) uf.union(`r:${y.c.registrationId}`, `r:${x.c.registrationId}`);
        }
      }
    }
  }

  const groups = new Map<string, Component>();
  for (const c of cases) {
    const root = uf.find(`r:${c.registrationId}`);
    const g = groups.get(root) ?? { cases: [], categories: new Set<string>() };
    g.cases.push(c);
    groups.set(root, g);
  }
  for (const c of s.categories) {
    if (isLocked(c)) continue;
    groups.get(uf.find(`c:${c.id}`))?.categories.add(c.id);
  }
  for (const [key, ids] of extraLocked) {
    const g = groups.get(uf.find(key));
    if (g) for (const id of ids) g.categories.add(id);
  }
  const options = new Map(movers.filter((mv) => mv.real).map((mv) => [mv.c.registrationId, mv.options]));
  const first = (g: Component) => sorted(g.cases.map((c) => c.registrationId))[0]!;
  return { components: [...groups.values()].sort((a, b) => cmp(first(a), first(b))), options };
}

/** Dans `after` (les catégories touchées par un déplacement), `y` a-t-il une option permise vers l'une d'elles ? */
function opensOption(after: State, y: Member, c: Case, ctx: SearchContext, near: (m: Member, k: CategoryKey) => boolean): boolean {
  const withY = after.members.some((m) => m.registrationId === y.registrationId) ? after : { ...after, members: [...after.members, y] };
  for (const t of after.categories) {
    if (t.id === y.categoryId || isLocked(t) || !near(y, t.key)) continue;
    if (activeMembers(after, t.id).every((m) => m.registrationId === y.registrationId)) continue;
    const rules = rulesForMove(withY, y.registrationId, t.id);
    if (rules && rules.every((r) => ctx.allowed.has(r))) return true;
    // « Split » : la catégorie touchée, plus fournie, peut donner son plus lourd au seul.
    if (c.kind !== 'alone' || !ctx.allowed.has('split') || !y.weightClassId || activeMembers(after, t.id).length < 3) continue;
    const wc = after.grid.weightClasses.find((w) => w.id === y.weightClassId);
    const lighter = wc ? neighborWeightClasses(after.grid, wc).lighter : null;
    if (lighter && activeMembers(after, t.id).some((z) => !z.placementLocked && z.weightClassId === lighter.id && z.discipline === y.discipline && z.ruleset === y.ruleset && z.sex === y.sex && z.ageBandCode === y.ageBandCode)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Score

export interface Score {
  alone: number;
  /** Par rang de la liste : nombre de déplacements dont la règle la plus coûteuse a ce rang. */
  counts: number[];
  moved: number;
  preference: number;
  gap: number;
  /** Identifiants des déplacements, triés. */
  ids: string[];
}

export interface Solution {
  score: Score;
  moves: SearchMove[];
  onCards: string[];
}

export function compareScores(a: Score, b: Score): number {
  if (a.alone !== b.alone) return a.alone - b.alone;
  for (let i = Math.max(a.counts.length, b.counts.length) - 1; i >= 0; i--) {
    const d = (a.counts[i] ?? 0) - (b.counts[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.moved - b.moved || a.preference - b.preference || a.gap - b.gap || cmp(a.ids.join('|'), b.ids.join('|'));
}

const mergeSorted = (a: string[], b: string[]) => (b.length === 0 ? a : a.length === 0 ? b : [...a, ...b].sort(cmp));

/** Le déplacement `m`, puis la solution `rest` (les deux scores s'ajoutent ; les seuls sont ceux de la fin). */
function prefix(m: SearchMove, rest: Solution): Solution {
  const counts = [...rest.score.counts];
  if (m.cost >= 0) counts[m.cost] = (counts[m.cost] ?? 0) + 1;
  const sc = rest.score;
  return {
    score: { alone: sc.alone, counts, moved: sc.moved + m.moved, preference: sc.preference + m.preference, gap: sc.gap + m.gap, ids: mergeSorted(sc.ids, [m.p.id]) },
    moves: [m, ...rest.moves],
    onCards: rest.onCards,
  };
}

/** Deux sous-problèmes indépendants : les scores s'additionnent. */
function combine(a: Solution, b: Solution): Solution {
  const n = Math.max(a.score.counts.length, b.score.counts.length);
  return {
    score: {
      alone: a.score.alone + b.score.alone,
      counts: Array.from({ length: n }, (_, i) => (a.score.counts[i] ?? 0) + (b.score.counts[i] ?? 0)),
      moved: a.score.moved + b.score.moved,
      preference: a.score.preference + b.score.preference,
      gap: a.score.gap + b.score.gap,
      ids: mergeSorted(a.score.ids, b.score.ids),
    },
    moves: [...a.moves, ...b.moves],
    onCards: mergeSorted(a.onCards, b.onCards),
  };
}

/** Fin d'une branche : les seuls de l'état, sans les corrections de poids impossibles (restées sur leur carte). */
function leaf(alone: string[], remaining: Case[]): Solution {
  const onCards = sorted(remaining.filter((c) => c.kind === 'weight_out').map((c) => c.registrationId));
  const cards = new Set(onCards);
  return { score: { alone: alone.filter((r) => !cards.has(r)).length, counts: [], moved: 0, preference: 0, gap: 0, ids: [] }, moves: [], onCards };
}

// ---------------------------------------------------------------------------------------------------------------
// Recherche

/** Recasés qui ne sont pas (encore) des cas mais pourraient revenir : leur catégorie d'origine existe ou peut être créée. */
function returnersLeft(s: State, ctx: SearchContext, decided: ReadonlySet<string>, remaining: Case[]): number {
  const inRemaining = new Set(remaining.map((c) => c.registrationId));
  let keys: Set<string> | null = null;
  let n = 0;
  for (const m of s.members) {
    if (!mayReturn(m) || decided.has(m.registrationId) || ctx.excluded.has(m.registrationId) || inRemaining.has(m.registrationId)) continue;
    const current = s.categories.find((c) => c.id === m.categoryId);
    if (!current || isLocked(current)) continue;
    const ks = homeKey(m);
    const home = categoryFor(s, ks);
    if (home) {
      if (!isLocked(home) && home.id !== m.categoryId) n++;
      continue;
    }
    keys ??= new Set(remaining.filter((c) => c.kind === 'weight_out').map((c) => {
      const x = s.members.find((y) => y.registrationId === c.registrationId);
      return x ? weightOutKey(s, x) : null;
    }).filter((k): k is string => k !== null));
    if (keys.has(ks)) n++;
  }
  return n;
}

/**
 * Empreinte d'un sous-problème : ses catégories, leurs inscrits tels qu'ils sont, et les inscriptions déjà décidées.
 * La part d'une catégorie est gardée par objet : un déplacement recopie les catégories qu'il change (`applyProposal`),
 * et rien ne les modifie pendant un calcul.
 */
function signature(s: State, decided: ReadonlySet<string>, parts: WeakMap<object, string>): string {
  let members: Map<string, Member[]> | null = null;
  const out: string[] = [];
  for (const c of [...s.categories].sort((a, b) => cmp(a.id, b.id))) {
    let part = parts.get(c);
    if (part === undefined) {
      if (!members) {
        members = new Map();
        for (const m of s.members) if (m.categoryId) members.set(m.categoryId, [...(members.get(m.categoryId) ?? []), m]);
      }
      const ms = (members.get(c.id) ?? []).sort((a, b) => cmp(a.registrationId, b.registrationId));
      part = `${c.id}=${keyString(c.key)}/${c.status}/${c.frozen ? 1 : 0}/${c.aliasKeys.join(',')}:${ms
        .map((m) => `${m.registrationId},${m.weightClassId},${m.discipline},${m.ruleset},${m.placementLocked ? 1 : 0},${m.presence}`)
        .join(';')}`;
      parts.set(c, part);
    }
    out.push(part);
  }
  const done = s.members.filter((m) => decided.has(m.registrationId)).map((m) => m.registrationId).sort(cmp);
  return `${out.join('#')}|${done.join(',')}`;
}

/**
 * Options encore valables après le déplacement `p` (de `before` à `after`) : celles des cas dont ni la catégorie, ni
 * aucune catégorie qu'ils pourraient atteindre (`makeNear`) n'a été touchée ; les autres sont recalculées.
 */
function keptOptions(before: State, after: State, p: Proposal, options: Map<string, SearchMove[]>, decided: ReadonlySet<string>): Map<string, SearchMove[]> {
  const near = makeNear(after);
  const ids = new Set(moversOf(p).flatMap((r) => [before, after].map((x) => x.members.find((m) => m.registrationId === r)?.categoryId ?? '')));
  ids.delete('');
  const keys = [before, after].flatMap((x) => x.categories.filter((c) => ids.has(c.id)).map((c) => c.key));
  const out = new Map<string, SearchMove[]>();
  for (const [r, os] of options) {
    if (decided.has(r)) continue;
    const m = after.members.find((x) => x.registrationId === r);
    if (!m || ids.has(m.categoryId ?? '') || keys.some((k) => near(m, k))) continue;
    out.set(r, os);
  }
  return out;
}

/** Borne d'une recherche : le score (sans les identifiants) à ne pas dépasser ; ses termes peuvent être négatifs. */
export type Bound = Omit<Score, 'ids'>;
export const NO_BOUND: Bound = { alone: Number.POSITIVE_INFINITY, counts: [], moved: 0, preference: 0, gap: 0 };

/** Comme `compareScores`, sans le départage par identifiants. */
function compareBounds(a: Bound, b: Bound): number {
  if (a.alone !== b.alone) return a.alone < b.alone ? -1 : 1;
  for (let i = Math.max(a.counts.length, b.counts.length) - 1; i >= 0; i--) {
    const d = (a.counts[i] ?? 0) - (b.counts[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.moved - b.moved || a.preference - b.preference || a.gap - b.gap;
}

/** `b − x` terme à terme (l'ordre lexicographique est invariant par translation : x + y ≤ b ⟺ y ≤ b − x). */
function minus(b: Bound, x: Bound): Bound {
  const n = Math.max(b.counts.length, x.counts.length);
  return {
    alone: b.alone - x.alone,
    counts: Array.from({ length: n }, (_, i) => (b.counts[i] ?? 0) - (x.counts[i] ?? 0)),
    moved: b.moved - x.moved,
    preference: b.preference - x.preference,
    gap: b.gap - x.gap,
  };
}

const moveBound = (m: SearchMove): Bound => {
  const counts: number[] = [];
  if (m.cost >= 0) counts[m.cost] = 1;
  return { alone: 0, counts, moved: m.moved, preference: m.preference, gap: m.gap };
};

/**
 * Meilleur plan d'un groupe, en profondeur : après chaque décision, les cas restants sont redécoupés en sous-problèmes
 * indépendants (résolus séparément : le score s'additionne), et chaque sous-problème résolu est mémorisé par son
 * empreinte. Chaque appel reçoit une borne (le meilleur score connu, moins ce qui est déjà engagé) : une branche dont
 * le minimum possible (seuls − 2 × cas restants, puis zéro pour les autres termes) la dépasse est abandonnée.
 * Le budget de nœuds est partagé par tout le groupe ; s'il est atteint, la recherche rend la meilleure solution trouvée
 * (ou la solution « carte par carte » à partir de là) et `exhausted` devient vrai.
 */
export class GroupSolver {
  private nodes: number;
  exhausted = false;
  /** Nœuds visités (pour mesurer). */
  visited = 0;
  /** Par empreinte : la plus grande borne pour laquelle aucune solution n'existe. */
  private readonly failed = new Map<string, Bound>();
  private readonly parts = new WeakMap<object, string>();

  constructor(
    private readonly ctx: SearchContext,
    budget: number,
    private readonly memo: Map<string, Solution>,
  ) {
    this.nodes = budget;
  }

  /** La meilleure solution si son score ne dépasse pas `cut` (exacte, et mémorisée) ; `null` sinon. */
  solve(s: State, decided: ReadonlySet<string>, cut: Bound, known?: Map<string, SearchMove[]>): Solution | null {
    const sig = signature(s, decided, this.parts);
    const solved = this.memo.get(sig);
    if (solved) return compareBounds(solved.score, cut) <= 0 ? solved : null;
    const failed = this.failed.get(sig);
    if (failed && compareBounds(cut, failed) <= 0) return null;
    this.visited++;
    if (this.exhausted || --this.nodes < 0) {
      this.exhausted = true;
      return this.greedy(s, decided);
    }
    const { ctx } = this;
    const fail = () => {
      if (!this.exhausted && (!failed || compareBounds(cut, failed) > 0)) this.failed.set(sig, cut);
      return null;
    };
    const keep = (sol: Solution | null) => {
      if (!sol) return fail();
      if (!this.exhausted) this.memo.set(sig, sol);
      return compareBounds(sol.score, cut) <= 0 ? sol : null;
    };
    const remaining = openCases(s, ctx, decided);
    const alone = aloneRegistrations(s, ctx.waveId);
    // Chaque cas restant (et chaque recasé qui pourrait revenir) retire au plus deux seuls ; jamais moins de zéro.
    const lowest = Math.max(0, alone.length - 2 * (remaining.length + returnersLeft(s, ctx, decided, remaining)));
    if (compareBounds({ alone: lowest, counts: [], moved: 0, preference: 0, gap: 0 }, cut) > 0) return fail();
    const rel = relate(s, ctx, decided, remaining, { known });
    if (remaining.every((c) => (rel.options.get(c.registrationId) ?? []).length === 0)) return keep(leaf(alone, remaining));

    // Catégories qu'aucun cas ne touche : leurs seuls ne changeront plus.
    const touchedCats = new Set(rel.components.flatMap((g) => [...g.categories]));
    const untouched = new Set(s.categories.filter((c) => !touchedCats.has(c.id)).map((c) => c.id));
    let total: Solution = { score: { alone: aloneRegistrations(subState(s, untouched), ctx.waveId).length, counts: [], moved: 0, preference: 0, gap: 0, ids: [] }, moves: [], onCards: [] };
    if (rel.components.length > 1) {
      // Les sous-problèmes suivants valent au moins zéro : chacun a pour borne ce qui reste après les précédents.
      for (const g of rel.components) {
        const part = this.solve(subState(s, g.categories), decided, minus(cut, total.score));
        if (!part) return this.exhausted ? null : fail();
        total = combine(total, part);
      }
      return keep(total);
    }
    const part = this.branch(untouched.size > 0 ? subState(s, touchedCats) : s, decided, remaining, rel, minus(cut, total.score));
    return keep(part ? combine(total, part) : null);
  }

  /** Un seul sous-problème : on essaie chaque option du premier cas qui en a, puis (si permis) de le laisser. */
  private branch(s: State, decided: ReadonlySet<string>, remaining: Case[], rel: Relation, cut: Bound): Solution | null {
    // Un cas sans option reste en attente : un déplacement suivant peut lui en donner une.
    const c = remaining.find((x) => (rel.options.get(x.registrationId) ?? []).length > 0)!;
    let best: Solution | null = null;
    const bound = (): Bound => (best && compareBounds(best.score, cut) < 0 ? best.score : cut);
    const consider = (sol: Solution | null) => {
      if (sol && (!best || compareScores(sol.score, best.score) < 0)) best = sol;
    };
    for (const m of rel.options.get(c.registrationId)!) {
      const next = applyAll(s, m.p);
      const d = new Set([...decided, c.registrationId, ...moversOf(m.p)]);
      const child = this.solve(next, d, minus(bound(), moveBound(m)), keptOptions(s, next, m.p, rel.options, d));
      consider(child ? prefix(m, child) : null);
      if (this.exhausted) break;
    }
    // Le laisser : jamais pour un retour ou une correction de poids possibles. L'état ne change pas : les options restent.
    if (!this.exhausted && c.kind !== 'return' && c.kind !== 'weight_out') {
      const d = new Set([...decided, c.registrationId]);
      const known = new Map([...rel.options].filter(([r, os]) => r !== c.registrationId && os.every((o) => !moversOf(o.p).includes(c.registrationId))));
      consider(this.solve(s, d, bound(), known));
    }
    if (this.exhausted && !best) return this.greedy(s, decided);
    return best;
  }

  /** « Carte par carte » à partir de `s` : la première option du premier cas qui en a une, jusqu'au bout. */
  greedy(s: State, decided: ReadonlySet<string>): Solution {
    const moves: SearchMove[] = [];
    let d = decided;
    for (;;) {
      const remaining = openCases(s, this.ctx, d);
      let pick: { c: Case; m: SearchMove } | null = null;
      for (const c of remaining) {
        const m = optionsOf(s, c, this.ctx, d)[0];
        if (m) {
          pick = { c, m };
          break;
        }
      }
      if (!pick) return moves.reduceRight((sol, m) => prefix(m, sol), leaf(aloneRegistrations(s, this.ctx.waveId), remaining));
      moves.push(pick.m);
      d = new Set([...d, pick.c.registrationId, ...moversOf(pick.m.p)]);
      s = applyAll(s, pick.m.p);
    }
  }
}

/** Score d'une suite de déplacements déjà connue (le rejeu « carte par carte »), appliquée à `s`. */
export function scoreOf(s: State, ctx: SearchContext, moves: SearchMove[]): Solution {
  let d: ReadonlySet<string> = new Set();
  for (const m of moves) {
    d = new Set([...d, m.p.caseId.slice(m.p.caseId.indexOf(':') + 1), ...moversOf(m.p)]);
    s = applyAll(s, m.p);
  }
  return moves.reduceRight((sol, m) => prefix(m, sol), leaf(aloneRegistrations(s, ctx.waveId), openCases(s, ctx, d)));
}

/**
 * L'ancien calcul « carte par carte », rejoué une fois sur tout l'état : les cas dans l'ordre de detectCases, le premier
 * qui a une option permise prend la première (ordre des cartes), on recalcule, on recommence. Les options d'un cas sont
 * gardées tant qu'aucun déplacement ne touche sa catégorie ni une catégorie qu'il pourrait viser.
 */
export function cardByCardReplay(state: State, ctx: SearchContext): { moves: SearchMove[]; touched: string[][] } {
  const near = makeNear(state);
  const cache = new Map<string, SearchMove[]>();
  const moves: SearchMove[] = [];
  /** Par déplacement : son cas et les catégories qu'il touche (une catégorie créée en route : la clé qui l'a créée). */
  const touched: string[][] = [];
  const node = (id: string) => (id.startsWith('new:') ? `k:${id.slice(4)}` : `c:${id}`);
  let s = state;
  let decided = new Set<string>();
  for (let guard = 0; guard <= state.members.length; guard++) {
    const cases = casesOfWave(s, detectCases(s), ctx.waveId).filter(isOpen(s, ctx, decided));
    let pick: { c: Case; m: SearchMove } | null = null;
    for (const c of cases) {
      let options = cache.get(c.id);
      if (!options) {
        options = optionsOf(s, c, ctx, decided).sort((a, b) => a.p.rank - b.p.rank);
        cache.set(c.id, options);
      }
      if (options[0]) {
        pick = { c, m: options[0] };
        break;
      }
    }
    if (!pick) break;
    const before = s;
    s = applyAll(s, pick.m.p);
    moves.push(pick.m);
    decided = new Set([...decided, pick.c.registrationId, ...moversOf(pick.m.p)]);
    // Catégories touchées (avant et après) : on oublie les options des cas qui pourraient les viser.
    const ids = new Set(moversOf(pick.m.p).flatMap((r) => [before, s].map((x) => x.members.find((m) => m.registrationId === r)?.categoryId ?? '')));
    ids.delete('');
    if (pick.c.categoryId) ids.add(pick.c.categoryId);
    if ('newKey' in pick.m.p.target) ids.add(`new:${keyString(pick.m.p.target.newKey)}`);
    touched.push([`r:${pick.c.registrationId}`, ...[...ids].map(node)]);
    const keys = [before, s].flatMap((x) => x.categories.filter((c) => ids.has(c.id)).map((c) => c.key));
    for (const id of [...cache.keys()]) {
      const m = s.members.find((x) => x.registrationId === id.slice(id.indexOf(':') + 1));
      if (!m || ids.has(m.categoryId ?? '') || keys.some((k) => near(m, k))) cache.delete(id);
    }
  }
  return { moves, touched };
}
