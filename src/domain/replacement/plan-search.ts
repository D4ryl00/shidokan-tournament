import { keyString, naturalKey } from '../categories.js';
import { DISCIPLINES } from '../disciplines.js';
import type { RuleId } from '../settings.js';
import type { DisciplineId, Ruleset } from '../types.js';
import { categoryForKey, detectCases, isClosedMember, isLocked } from './detect.js';
import { applyAll } from './move.js';
import { proposalsFor, ruleProfile } from './propose.js';
import { ruleRank } from './rules.js';
import type { Case, CaseKind, Member, Proposal, State } from './types.js';
import { casesOfWave, categoryWaves } from './waves.js';
import { effectiveWeight, weighInClass } from './weights.js';

/** Nombre de nœuds de la recherche, par groupe : une limite fixe, jamais un temps, pour qu'un même état donne le même plan. */
export const DEFAULT_NODE_BUDGET = 20_000;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
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

/** Un déplacement retenu par la recherche, avec le rang (dans la liste) de sa règle la plus coûteuse (-1 : aucune). */
export interface SearchMove {
  p: Proposal;
  cost: number;
}

const KIND_ORDER: CaseKind[] = ['return', 'weight_out', 'closed', 'alone'];
const moversOf = (p: Pick<Proposal, 'registrationId' | 'alsoMoved'>) => [p.registrationId, ...(p.alsoMoved ?? [])];

/** Cas que le plan traite : ceux de la session, sans les cartes mises de côté, les écarts de poids ni les inscriptions décidées. */
export function openCases(s: State, ctx: SearchContext, decided: ReadonlySet<string>): Case[] {
  return casesOfWave(s, detectCases(s), ctx.waveId)
    .filter((c) => c.kind !== 'weight_gap' && !s.setAside.includes(c.id) && !decided.has(c.registrationId) && !ctx.excluded.has(c.registrationId))
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
  for (const p of proposalsFor(s, c)) {
    if (p.waveChange || p.waveShifts.length > 0) continue;
    if (moversOf(p).some((r) => r !== c.registrationId && (decided.has(r) || ctx.excluded.has(r)))) continue;
    // Retour et correction de poids s'imposent : seule la validation compte (pour appliquer, jamais un déplacement à valider).
    const ok = ruleProfile(s, p).forced ? !ctx.forApply || !p.manual : p.rules.every((r) => ctx.allowed.has(r));
    if (ok) out.push({ p, cost: costRank(s, p) });
  }
  return out.sort((a, b) => a.cost - b.cost || a.p.rank - b.p.rank);
}

/** Recasé parce qu'il était seul : il peut revenir dans sa catégorie d'origine dès qu'elle a un adversaire. */
const mayReturn = (m: Member) => m.placementLocked && m.original !== null && m.presence !== 'absent' && (!m.original.reason || m.original.reason === 'alone');
const homeKey = (m: Member) => keyString(naturalKey({ ...m.original! }, m));
const weightOutKey = (s: State, m: Member) => {
  const wic = weighInClass(m, s);
  return wic ? keyString(naturalKey({ ...m, weightClassId: wic.id }, m)) : null;
};

// ---------------------------------------------------------------------------------------------------------------
// Groupes indépendants

interface Profile {
  m: Member;
  disciplines: Set<DisciplineId>;
  rulesets: Set<Ruleset | null>;
  weight: number | null;
}

/**
 * Ce qu'un combattant peut devenir : sa discipline, celles qu'il accepte (si la règle est permise), et pour un recasé
 * la discipline et le règlement d'origine (retour). Poids inconnu si un retour peut changer sa catégorie de poids.
 */
function profileOf(state: State, m: Member, allowed: ReadonlySet<RuleId>): Profile {
  const disciplines = new Set<DisciplineId>([m.discipline]);
  if (allowed.has('discipline')) for (const d of m.otherDisciplines) disciplines.add(d);
  const rulesets = new Set<Ruleset | null>([m.ruleset]);
  if (m.original) {
    disciplines.add(m.original.discipline);
    rulesets.add(m.original.ruleset);
  }
  const returnsChangeClass = m.original !== null && m.original.weightClassId !== m.weightClassId;
  const weight = m.weighInKg ?? m.approxWeightKg ?? (returnsChangeClass ? null : effectiveWeight(m, state.grid));
  return { m, disciplines, rulesets, weight };
}

/**
 * Deux combattants peuvent-ils finir dans la même catégorie ? Sur-approximation des vérifications d'`evaluate`
 * (jamais faux quand un déplacement permis les réunirait), pour que les groupes se calculent séparément.
 */
function makeMayShare(state: State, allowed: ReadonlySet<RuleId>) {
  const { settings, grid } = state;
  const links = new Set(grid.ageLinks.flatMap((l) => [`${l.from}>${l.to}`, `${l.to}>${l.from}`]));
  const ageRule = (['ageUp', 'ageDown', 'seniorsVeterans', 'minorsAdults'] as const).some((r) => allowed.has(r));
  const mixBands = new Set(settings.mixSexes.ageBandCodes);
  const minors = new Set(grid.ageBands.filter((b) => b.isMinor).map((b) => b.code));
  const thresholdOf = (m: Member) => (minors.has(m.ageBandCode) ? settings.weightGapMaxKg.children : settings.weightGapMaxKg.adults);
  const widest = Math.max(settings.weightGapMaxKg.children, settings.weightGapMaxKg.adults);
  return (a: Profile, b: Profile): boolean => {
    const common = [...a.disciplines].filter((d) => b.disciplines.has(d));
    if (common.length === 0) return false;
    const rulesetOk = [...a.rulesets].some((x) =>
      [...b.rulesets].some((y) => x === y || (allowed.has('shobuToJiyu') && ((x === 'shobu' && y === 'jiyu') || (x === 'jiyu' && y === 'shobu')))),
    );
    if (!rulesetOk) return false;
    const sameSex = a.m.sex === b.m.sex;
    // evaluate ne vérifie que la tranche de celui qui se déplace : l'une des deux suffit.
    if (!sameSex && !(allowed.has('mixSexes') && (mixBands.has(a.m.ageBandCode) || mixBands.has(b.m.ageBandCode)))) return false;
    const sameBand = a.m.ageBandCode === b.m.ageBandCode;
    if (!sameBand && !(ageRule && links.has(`${a.m.ageBandCode}>${b.m.ageBandCode}`))) return false;
    if (common.some((d) => !DISCIPLINES[d].hasWeight)) return true;
    if (sameBand && sameSex && allowed.has('weightGap')) return true;
    if (a.weight === null || b.weight === null) return true;
    // Le seuil d'une catégorie est celui des enfants dès qu'un mineur y est : avec le mélange permis, un tiers peut l'imposer.
    const threshold = allowed.has('minorsAdults') ? widest : Math.max(thresholdOf(a.m), thresholdOf(b.m));
    return Math.abs(a.weight - b.weight) <= threshold + 1e-9;
  };
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let root = x;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    if (!this.parent.has(x)) this.parent.set(x, x);
    let cur = x;
    while (cur !== root) {
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
    if (ra !== rb) {
      if (ra < rb) this.parent.set(rb, ra);
      else this.parent.set(ra, rb);
    }
  }
}

/**
 * Découpe les cas ouverts en groupes indépendants : un combattant ne peut finir qu'avec des combattants de son groupe.
 * Chaque groupe est rendu sous forme de sous-état (ses catégories et leurs membres), triés par plus petite inscription.
 *
 * Au-delà des cas, sont aussi reliés comme des cas : les recasés qui peuvent revenir, et les combattants qui peuvent
 * être laissés seuls en route (tous les autres actifs de leur catégorie peuvent partir), pour que la découpe reste sûre.
 */
export function independentGroups(state: State, ctx: SearchContext, cases: Case[]): State[] {
  const mayShare = makeMayShare(state, ctx.allowed);
  const unlocked = state.categories.filter((c) => !isLocked(c));
  const unlockedIds = new Set(unlocked.map((c) => c.id));
  const active = state.members.filter((m) => m.presence !== 'absent' && m.categoryId !== null && unlockedIds.has(m.categoryId));
  const byCategory = new Map<string, Member[]>();
  for (const m of active) byCategory.set(m.categoryId!, [...(byCategory.get(m.categoryId!) ?? []), m]);
  const profiles = new Map(active.map((m) => [m.registrationId, profileOf(state, m, ctx.allowed)]));
  const byId = new Map(state.members.map((m) => [m.registrationId, m]));

  // Qui peut bouger : les cas, les recasés qui peuvent revenir, puis (point fixe) ceux qu'on peut laisser seuls en route.
  const movers = new Set(cases.map((c) => c.registrationId));
  for (const m of active) if (mayReturn(m)) movers.add(m.registrationId);
  const pullable = new Set<string>();
  const seen = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    // « Split » : seul celui qui est seul reçoit, et seulement des combattants qui peuvent le rejoindre.
    if (ctx.allowed.has('split')) {
      for (const id of sorted(movers)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const p = profiles.get(id);
        if (!p) continue;
        for (const x of active) if (!x.placementLocked && x.registrationId !== id && mayShare(p, profiles.get(x.registrationId)!)) pullable.add(x.registrationId);
      }
    }
    for (const c of unlocked) {
      const open = (byCategory.get(c.id) ?? []).filter((m) => !isClosedMember(state, m));
      for (const y of open) {
        if (movers.has(y.registrationId)) continue;
        const others = open.filter((o) => o !== y);
        // Un « split » laisse toujours au moins deux actifs : il faut qu'au moins un autre parte de lui-même.
        if (others.some((o) => movers.has(o.registrationId)) && others.every((o) => movers.has(o.registrationId) || pullable.has(o.registrationId))) {
          movers.add(y.registrationId);
          changed = true;
        }
      }
    }
  }

  const uf = new UnionFind();
  const extraLocked = new Map<string, Set<string>>();
  const linkKey = (node: string, ks: string) => {
    uf.union(node, `k:${ks}`);
    const existing = categoryForKey(state, ks);
    if (!existing) return;
    if (!isLocked(existing)) uf.union(`k:${ks}`, `c:${existing.id}`);
    // Une catégorie lancée n'est ni cible ni source, mais le sous-état doit la connaître (sinon on la recréerait).
    else extraLocked.set(`k:${ks}`, (extraLocked.get(`k:${ks}`) ?? new Set()).add(existing.id));
  };
  for (const id of sorted(movers)) {
    const m = byId.get(id);
    const p = profiles.get(id);
    if (!m || !p || !m.categoryId) continue;
    uf.union(`r:${id}`, `c:${m.categoryId}`);
    for (const c of unlocked) {
      if ((byCategory.get(c.id) ?? []).some((x) => x.registrationId !== id && mayShare(p, profiles.get(x.registrationId)!))) uf.union(`r:${id}`, `c:${c.id}`);
    }
    if (mayReturn(m)) linkKey(`r:${id}`, homeKey(m));
  }
  for (const c of cases) {
    const m = byId.get(c.registrationId);
    const ks = c.kind === 'weight_out' && m ? weightOutKey(state, m) : null;
    if (ks) linkKey(`r:${c.registrationId}`, ks);
  }

  const groups = new Map<string, { categories: Set<string>; first: string }>();
  for (const c of cases) {
    const root = uf.find(`r:${c.registrationId}`);
    const g = groups.get(root) ?? { categories: new Set<string>(), first: c.registrationId };
    if (cmp(c.registrationId, g.first) < 0) g.first = c.registrationId;
    groups.set(root, g);
  }
  for (const c of state.categories) {
    const node = `c:${c.id}`;
    const g = unlockedIds.has(c.id) ? groups.get(uf.find(node)) : undefined;
    g?.categories.add(c.id);
  }
  for (const [key, ids] of extraLocked) {
    const g = groups.get(uf.find(key));
    if (g) for (const id of ids) g.categories.add(id);
  }
  return [...groups.values()]
    .sort((a, b) => cmp(a.first, b.first))
    .map((g) => ({
      ...state,
      categories: state.categories.filter((c) => g.categories.has(c.id)),
      members: state.members.filter((m) => m.categoryId !== null && g.categories.has(m.categoryId)),
    }));
}

// ---------------------------------------------------------------------------------------------------------------
// Recherche

interface Score {
  alone: number;
  /** Par rang de la liste : nombre de déplacements dont la règle la plus coûteuse a ce rang. */
  counts: number[];
  moved: number;
  preference: number;
  /** Somme des écarts de poids, en centièmes de kg (entiers : pas d'erreur d'arrondi). */
  gap: number;
  ids: string;
}

function compareScores(a: Score, b: Score): number {
  if (a.alone !== b.alone) return a.alone - b.alone;
  for (let i = Math.max(a.counts.length, b.counts.length) - 1; i >= 0; i--) {
    const d = (a.counts[i] ?? 0) - (b.counts[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.moved - b.moved || a.preference - b.preference || a.gap - b.gap || cmp(a.ids, b.ids);
}

export interface GroupResult {
  moves: SearchMove[];
  onCards: string[];
  proven: boolean;
}

interface Solution {
  score: Score;
  moves: SearchMove[];
  onCards: string[];
}

/**
 * Meilleur plan d'un groupe : la solution « carte par carte » d'abord (le plan n'est jamais moins bon), puis une
 * recherche en profondeur avec élagage, dans la limite de `budget` nœuds (`proven` faux si elle est atteinte).
 */
export function searchGroup(sub: State, ctx: SearchContext, budget: number): GroupResult {
  const aloneOf = (s: State) => aloneRegistrations(s, ctx.waveId);
  const leaf = (s: State, alone: string[], moves: SearchMove[], remaining: Case[]): Solution => {
    // Correction de poids impossible : sur sa carte, pas comptée seule.
    const onCards = sorted(remaining.filter((c) => c.kind === 'weight_out').map((c) => c.registrationId));
    const cards = new Set(onCards);
    const counts = new Array<number>(s.settings.replacementRules.order.length).fill(0);
    for (const m of moves) if (m.cost >= 0) counts[m.cost] = (counts[m.cost] ?? 0) + 1;
    const byId = new Map(s.members.map((m) => [m.registrationId, m]));
    const score: Score = {
      alone: alone.filter((r) => !cards.has(r)).length,
      counts,
      moved: moves.reduce((n, m) => n + moversOf(m.p).length, 0),
      preference: moves.reduce((n, m) => n + (m.p.changes.discipline ? Math.max(0, byId.get(m.p.registrationId)?.otherDisciplines.indexOf(m.p.changes.discipline) ?? 0) : 0), 0),
      gap: moves.reduce((n, m) => n + Math.round(m.p.checks.weightGapKg * 100), 0),
      ids: sorted(moves.map((m) => m.p.id)).join('|'),
    };
    return { score, moves, onCards };
  };
  const firstWithOptions = (s: State, remaining: Case[], decided: ReadonlySet<string>) => {
    for (const c of remaining) {
      const options = optionsOf(s, c, ctx, decided);
      if (options.length > 0) return { c, options };
    }
    return null;
  };
  const decide = (decided: ReadonlySet<string>, c: Case, m?: SearchMove) => new Set([...decided, c.registrationId, ...(m ? moversOf(m.p) : [])]);

  // Point de départ : la première option de chaque cas, dans l'ordre, sans jamais laisser un cas qui en a une.
  let best: Solution;
  {
    let s = sub;
    let decided: ReadonlySet<string> = new Set();
    const moves: SearchMove[] = [];
    for (;;) {
      const remaining = openCases(s, ctx, decided);
      const pick = firstWithOptions(s, remaining, decided);
      if (!pick) {
        best = leaf(s, aloneOf(s), moves, remaining);
        break;
      }
      const m = pick.options[0]!;
      moves.push(m);
      decided = decide(decided, pick.c, m);
      s = applyAll(s, m.p);
    }
  }

  let nodes = budget;
  let exhausted = false;
  const visit = (s: State, decided: ReadonlySet<string>, moves: SearchMove[]): void => {
    if (exhausted) return;
    if (--nodes < 0) {
      exhausted = true;
      return;
    }
    const remaining = openCases(s, ctx, decided);
    const alone = aloneOf(s);
    // Chaque cas restant (et chaque recasé qui pourrait revenir) retire au plus deux seuls.
    if (alone.length - 2 * (remaining.length + returnersLeft(s, ctx, decided, remaining)) > best.score.alone) return;
    // Un cas sans option reste en attente : un déplacement suivant peut lui en donner une.
    const pick = firstWithOptions(s, remaining, decided);
    if (!pick) {
      const sol = leaf(s, alone, moves, remaining);
      if (compareScores(sol.score, best.score) < 0) best = sol;
      return;
    }
    for (const m of pick.options) {
      visit(applyAll(s, m.p), decide(decided, pick.c, m), [...moves, m]);
      if (exhausted) return;
    }
    // Le laisser : jamais pour un retour ou une correction de poids possibles.
    if (pick.c.kind !== 'return' && pick.c.kind !== 'weight_out') visit(s, decide(decided, pick.c), moves);
  };
  visit(sub, new Set(), []);
  return { moves: best.moves, onCards: best.onCards, proven: !exhausted };
}

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
    const home = categoryForKey(s, ks);
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
