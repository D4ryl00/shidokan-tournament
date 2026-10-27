import { categoryLabel, keyString, type CategoryKey } from '../categories.js';
import { DISCIPLINES } from '../disciplines.js';
import type { RuleId } from '../settings.js';
import { detectCases } from './detect.js';
import { manualProposal } from './manual.js';
import { applyAll } from './move.js';
import { solveGroups } from './plan-groups.js';
import { DEFAULT_NODE_BUDGET, aloneRegistrations, compareScores, costRank, moversOf, scoreOf, type SearchContext, type SearchMove } from './plan-search.js';
import { proposalsFor, rulesForMove } from './propose.js';
import { allowedAt, costBand, isRuleOn, NO_VALIDATION_RULES, ruleRank, withAllRules, type CostBand } from './rules.js';
import type { Proposal, State } from './types.js';
import { casesOfWave, memberWave } from './waves.js';
import { activeMembers, categoryWeightGap, gapThreshold } from './weights.js';

export { DEFAULT_NODE_BUDGET, aloneRegistrations } from './plan-search.js';

/** Décision de l'organisateur, fixée avant le calcul : une proposition validée, ou une catégorie choisie (« Modifier »). */
export type PlanChoice =
  | { kind: 'validate'; proposalId: string; caseId: string }
  | { kind: 'manual'; registrationId: string; categoryId: string }
  /**
   * Refus fait dans le plan : il ne vaut que pour le plan (voir `preparePlanState`) ; nom et raison pour la liste « Refusés »,
   * catégorie de départ du déplacement refusé (le combattant l'a quittée pour de vrai : le refus n'a plus d'objet).
   */
  | { kind: 'refuse'; proposalId: string; registrationId: string; reason: string; fromCategoryId?: string | null };

export interface PlanMove extends Proposal {
  /** Première inscription active de la cible au moment du déplacement, hors celles qui bougent (`null` : nouvelle catégorie). */
  anchor: string | null;
  fromCategoryId: string | null;
  /** Règle la plus coûteuse (rang le plus grand dans la liste) ; elle décide du groupe de coût. */
  costRule: RuleId | null;
  band: CostBand;
  /** Choix de l'organisateur (validé ou « Modifier ») : jamais défait par le calcul. */
  validated: boolean;
  /** Choix hors des règles actuelles : règle désactivée, sous la ligne, ou déplacement qui enfreint les règles. */
  outside: 'disabled' | 'below-cut' | 'breaks-rules' | null;
  details: { rule: RuleId; detail: string }[];
  /** Libellé de la catégorie du combattant une fois le déplacement fait. */
  toLabel: string;
}

export interface PlanOptions {
  waveId: string | null;
  /** Dernière règle permise (ligne de coupure). */
  level: RuleId;
  choices: PlanChoice[];
  /** Pour appliquer : seulement les déplacements sans validation, et les choix. */
  forApply?: boolean;
  /** Nombre de nœuds de la recherche, par groupe. */
  nodeBudget?: number;
}

export interface PlanResult {
  moves: PlanMove[];
  aloneBefore: string[];
  aloneAfter: string[];
  /** Corrections de poids impossibles dans le plan : elles restent sur leur carte, pas comptées seules. */
  onCards: string[];
  dropped: PlanChoice[];
  /** Pour appliquer : choix validés qui suivent un déplacement à valider non validé ; ni appliqués ni écartés. */
  waiting: PlanChoice[];
  /** Vrai si la recherche est allée au bout : aucun plan dans ces règles ne laisse moins de seuls. */
  proven: boolean;
  final: State;
  hash: string;
}

const kg = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');

/** Pastilles : le détail de chaque règle d'un déplacement (« écart 2,5 kg », « Cadets → Juniors »…). */
function detailsOf(before: State, p: Proposal, rules: RuleId[], gap: number, threshold: number): PlanMove['details'] {
  const m = before.members.find((x) => x.registrationId === p.registrationId);
  const { ageBands } = before.grid;
  const bandLabel = (code: string) => ageBands.find((b) => b.code === code)?.label ?? code;
  const bandIndex = (code: string) => ageBands.findIndex((b) => b.code === code);
  const targetKey: CategoryKey | undefined =
    'newKey' in p.target ? p.target.newKey : before.categories.find((c) => c.id === (p.target as { categoryId: string }).categoryId)?.key;
  return rules.map((rule) => {
    switch (rule) {
      case 'weight':
      case 'split':
        return { rule, detail: `écart ${kg(gap)} kg` };
      case 'weightGap':
        return { rule, detail: `${kg(gap)} kg (max ${kg(threshold)})` };
      case 'ageUp':
      case 'ageDown':
      case 'minorsAdults': {
        if (!m) return { rule, detail: '' };
        const bands = targetKey?.ageBandCodes ?? [];
        const others = bands.filter((b) => b !== m.ageBandCode);
        const to = (others.length ? others : bands).slice().sort((a, b) => bandIndex(a) - bandIndex(b));
        return { rule, detail: `${bandLabel(m.ageBandCode)} → ${to.map(bandLabel).join(' / ')}` };
      }
      case 'discipline': {
        if (!m) return { rule, detail: '' };
        const to = p.changes.discipline ?? targetKey?.discipline ?? m.discipline;
        return { rule, detail: `${DISCIPLINES[m.discipline].label} → ${DISCIPLINES[to].label}` };
      }
      default:
        return { rule, detail: '' };
    }
  });
}

/** Ligne du plan pour la proposition `p`, appliquée à `before` (qui donne `after`). */
function planMove(
  before: State,
  after: State,
  p: Proposal,
  o: { validated: boolean; outside: PlanMove['outside']; needsValidation: boolean; measured?: boolean },
): PlanMove {
  const movers = new Set([p.registrationId, ...(p.alsoMoved ?? [])]);
  const mover = before.members.find((x) => x.registrationId === p.registrationId);
  const targetId = 'categoryId' in p.target ? p.target.categoryId : null;
  const anchor = targetId === null ? null : activeMembers(before, targetId).map((x) => x.registrationId).filter((r) => !movers.has(r)).sort()[0] ?? null;
  const rank = costRank(before, p);
  const costRule = p.rules.find((r) => ruleRank(before.settings, r, mover ?? { ruleset: null, acceptsJiyuFirst: null }) === rank) ?? null;
  const arrivedIn = after.members.find((x) => x.registrationId === p.registrationId)?.categoryId ?? null;
  const arrival = after.categories.find((c) => c.id === arrivedIn);
  // Déplacement manuel : ses vérifications ne sont pas calculées, on mesure la catégorie d'arrivée.
  const merged = arrivedIn ? activeMembers(after, arrivedIn) : [];
  const gap = o.measured ? Math.round(categoryWeightGap(merged, after.grid) * 100) / 100 : p.checks.weightGapKg;
  const threshold = o.measured ? gapThreshold(merged, after) : p.checks.threshold;
  return {
    ...p,
    anchor,
    fromCategoryId: mover?.categoryId ?? null,
    costRule,
    band: costBand(before.settings, costRule, o.needsValidation),
    validated: o.validated,
    outside: o.outside,
    details: detailsOf(before, p, p.rules, gap, threshold),
    toLabel: arrival ? categoryLabel(arrival.key, after.grid) : '—',
  };
}

/** Catégories qu'un déplacement touche : celles des combattants qui bougent, avant et après, et la cible (`new:…` comprise). */
function touchedBy(before: State, after: State, p: Proposal): Set<string> {
  const ids = new Set(moversOf(p).flatMap((r) => [before, after].map((x) => x.members.find((m) => m.registrationId === r)?.categoryId ?? '')));
  ids.add('categoryId' in p.target ? p.target.categoryId : `new:${keyString(p.target.newKey)}`);
  ids.delete('');
  return ids;
}

/**
 * Plan d'ensemble d'une session : d'abord les choix de l'organisateur, dans l'ordre reçu ; puis, groupe par groupe,
 * le placement qui laisse le moins de combattants seuls avec les règles permises (actives, jusqu'à `level`).
 * Un choix dont le cas n'existe qu'après un autre déplacement du plan (le partenaire d'une correction de poids, une
 * catégorie créée en route) est placé juste après ces déplacements, qui sont alors fixés.
 */
export function computePlan(state: State, opts: PlanOptions): PlanResult {
  return solvePlan(state, opts, {}).result;
}

interface SolveExtra {
  /** Plan d'une ligne au-dessus (mêmes choix, règles moins nombreuses) : gardé s'il fait mieux que la recherche. */
  seed?: { pins: string; moves: SearchMove[] };
}

function solvePlan(state: State, opts: PlanOptions, extra: SolveExtra): { result: PlanResult; found: SearchMove[]; pins: string | null } {
  const forApply = opts.forApply === true;
  const atLevel = allowedAt(state.settings, opts.level);
  // Pour appliquer : les règles sans validation au-dessus de la ligne seulement (retours et corrections de poids s'imposent).
  const allowed = forApply ? new Set([...atLevel].filter((r) => NO_VALIDATION_RULES.has(r))) : atLevel;
  const budget = opts.nodeBudget ?? DEFAULT_NODE_BUDGET;
  const moves: PlanMove[] = [];
  const dropped: PlanChoice[] = [];
  const waiting: PlanChoice[] = [];
  const excluded = new Set<string>();
  let cur = state;
  let prefixed = false;

  /** Le choix dans l'état `s` (cas ou combattant de la session) ; `null` : pas (encore) là. */
  const resolve = (s: State, choice: PlanChoice): { p: Proposal; warnings: string[] } | null => {
    const everything = { ...s, settings: withAllRules(s.settings, s.grid) };
    if (choice.kind === 'validate') {
      const c = casesOfWave(s, detectCases(s), opts.waveId).find((x) => x.id === choice.caseId);
      const p = c ? proposalsFor(everything, c).find((x) => x.id === choice.proposalId) : undefined;
      return p ? { p, warnings: [] } : null;
    }
    if (choice.kind !== 'manual') return null;
    const m = s.members.find((x) => x.registrationId === choice.registrationId);
    if (!m || (opts.waveId !== null && memberWave(s, m) !== opts.waveId)) return null;
    const r = manualProposal(s, choice.registrationId, choice.categoryId);
    if (!('p' in r)) return null;
    return { p: { ...r.p, rules: rulesForMove(everything, choice.registrationId, choice.categoryId) ?? [] }, warnings: r.warnings };
  };
  const usable = (p: Proposal, taken: ReadonlySet<string>) => !p.waveChange && p.waveShifts.length === 0 && !moversOf(p).some((r) => taken.has(r));
  /** Épingle le choix dans l'état courant : `missing` s'il n'y est pas (encore), `dropped` s'il y est mais impossible. */
  const pin = (choice: PlanChoice): 'pinned' | 'dropped' | 'missing' => {
    const found = resolve(cur, choice);
    if (!found) return 'missing';
    const { p, warnings } = found;
    if (!usable(p, excluded)) return 'dropped';
    const rules = p.rules;
    const outside: PlanMove['outside'] =
      warnings.length > 0 ? 'breaks-rules'
      : rules.some((r) => !isRuleOn(state.settings, r)) ? 'disabled'
      : rules.some((r) => !atLevel.has(r)) ? 'below-cut'
      : null;
    const after = applyAll(cur, p);
    const needsValidation = choice.kind === 'manual' ? rules.length === 0 || rules.some((r) => !NO_VALIDATION_RULES.has(r)) : p.manual;
    moves.push(planMove(cur, after, p, { validated: true, outside, needsValidation, measured: choice.kind === 'manual' }));
    for (const r of moversOf(p)) excluded.add(r);
    cur = after;
    return 'pinned';
  };
  /** Épingle ce qui peut l'être, jusqu'à ce que plus rien ne change (une épingle peut en rendre une autre possible). */
  const pinAll = (list: PlanChoice[]): PlanChoice[] => {
    let pending = list;
    for (let progress = true; progress; ) {
      progress = false;
      const next: PlanChoice[] = [];
      for (const choice of pending) {
        const r = pin(choice);
        if (r === 'missing') next.push(choice);
        else {
          if (r === 'dropped') dropped.push(choice);
          progress = true;
        }
      }
      pending = next;
    }
    return pending;
  };

  // 1. Les choix d'abord : jamais défaits, même si leur règle est désactivée ou sous la ligne.
  // Les refus ne s'épinglent pas : `preparePlanState` les a déjà mis dans l'état.
  let pending = pinAll(opts.choices.filter((c) => c.kind !== 'refuse'));
  const pins = moves.map((m) => m.id).join('|');

  // 1 bis. Un choix encore absent : on cherche, dans le plan affiché (règles jusqu'à la ligne), les déplacements après
  // lesquels il apparaît ; seuls ceux qui y mènent (catégories touchées en chaîne) sont fixés avant lui.
  while (pending.length > 0) {
    const screen: SearchContext = { waveId: opts.waveId, allowed: atLevel, forApply: false, excluded };
    const plan = solveGroups(cur, screen, budget).moves;
    let hit: { at: number; choice: PlanChoice; p: Proposal; after: State } | null = null;
    const taken = new Set(excluded);
    let s = cur;
    for (let i = 0; i < plan.length && !hit; i++) {
      s = applyAll(s, plan[i]!.p);
      for (const r of moversOf(plan[i]!.p)) taken.add(r);
      for (const choice of pending) {
        const found = resolve(s, choice);
        if (found && usable(found.p, taken)) {
          hit = { at: i, choice, p: found.p, after: s };
          break;
        }
      }
    }
    if (!hit) break;
    const before = plan.slice(0, hit.at + 1);
    const needed = chainTo(cur, before, hit.p, hit.after);
    pending = pending.filter((c) => c !== hit.choice);
    // Pour appliquer : un déplacement à valider non validé n'est pas appliqué, le choix qui en dépend attend.
    if (forApply && needed.some((m) => m.p.manual)) {
      waiting.push(hit.choice);
      continue;
    }
    for (const m of needed) {
      const after = applyAll(cur, m.p);
      moves.push(planMove(cur, after, m.p, { validated: false, outside: null, needsValidation: m.p.manual }));
      for (const r of moversOf(m.p)) excluded.add(r);
      cur = after;
    }
    prefixed = true;
    if (pin(hit.choice) !== 'pinned') dropped.push(hit.choice);
    pending = pinAll(pending);
  }
  dropped.push(...pending);

  // 2. Les cas ouverts, en groupes indépendants ; chaque groupe part du rejeu « carte par carte » et cherche mieux.
  const ctx: SearchContext = { waveId: opts.waveId, allowed, forApply, excluded };
  const solved = solveGroups(cur, ctx, budget);
  let found = solved.moves;
  let onCards = solved.onCards;
  // Une chaîne fixée pour un choix n'est qu'un chemin parmi d'autres : le plan n'est alors plus prouvé.
  let proven = solved.proven && !prefixed;
  // Le plan de la ligne au-dessus reste permis ici (mêmes choix, plus de règles) : la recherche ne fait jamais moins bien.
  if (extra.seed && !prefixed && extra.seed.pins === pins) {
    const mine = scoreOf(cur, ctx, found);
    const theirs = scoreOf(cur, ctx, extra.seed.moves);
    if (compareScores(theirs.score, mine.score) < 0) {
      found = extra.seed.moves;
      onCards = theirs.onCards;
      proven = false;
    }
  }
  // 3. Fusion : les déplacements des groupes, appliqués à l'état courant dans l'ordre trouvé.
  for (const m of found) {
    const after = applyAll(cur, m.p);
    moves.push(planMove(cur, after, m.p, { validated: false, outside: null, needsValidation: m.p.manual }));
    cur = after;
  }

  const cards = new Set(onCards);
  return {
    result: {
      moves,
      aloneBefore: aloneRegistrations(state, opts.waveId),
      aloneAfter: aloneRegistrations(cur, opts.waveId).filter((r) => !cards.has(r)),
      onCards: [...cards].sort(),
      dropped,
      waiting,
      proven,
      final: cur,
      hash: moves.map((m) => m.id).join('|'),
    },
    found,
    pins: prefixed ? null : pins,
  };
}

/**
 * Parmi `prefix` (déplacements du plan appliqués à `start`, au bout desquels la proposition `p` apparaît dans `end`),
 * ceux qui y mènent : en remontant, chaque déplacement qui touche une catégorie déjà retenue (celles de `p` d'abord).
 * Si la chaîne seule ne fait pas apparaître `p`, tout le début du plan est gardé.
 */
function chainTo(start: State, prefix: SearchMove[], p: Proposal, end: State): SearchMove[] {
  const touched: Set<string>[] = [];
  let s = start;
  for (const m of prefix) {
    const after = applyAll(s, m.p);
    touched.push(touchedBy(s, after, m.p));
    s = after;
  }
  const need = touchedBy(end, end, p);
  const keep = new Set<number>();
  for (let i = prefix.length - 1; i >= 0; i--) {
    if (![...touched[i]!].some((id) => need.has(id))) continue;
    keep.add(i);
    for (const id of touched[i]!) need.add(id);
  }
  const chain = prefix.filter((_, i) => keep.has(i));
  if (chain.length === prefix.length) return chain;
  let t = start;
  for (const m of chain) t = applyAll(t, m.p);
  const everything = { ...t, settings: withAllRules(t.settings, t.grid) };
  const c = detectCases(t).find((x) => x.id === p.caseId);
  return c && proposalsFor(everything, c).some((x) => x.id === p.id) ? chain : prefix;
}

/** Détail de la ligne de départ : retours, corrections de poids, et choix de l'organisateur (comptés à part). */
function startDetail(moves: PlanMove[]): NonNullable<LadderRow['start']> {
  const free = moves.filter((m) => !m.validated);
  return {
    returns: free.filter((m) => m.type === 'R').length,
    weights: free.filter((m) => m.type !== 'R' && m.caseId.startsWith('weight_out:')).length,
    choices: moves.length - free.length,
  };
}

export interface LadderRow {
  /** `null` : la ligne de départ (aucune règle). */
  rule: RuleId | null;
  on: boolean;
  /** Combattants seuls une fois les règles jusqu'à celle-ci permises ; `null` : règle désactivée, rien n'est calculé. */
  alone: number | null;
  moves: number;
  /** Déplacements à valider à la main. */
  toValidate: number;
  proven: boolean;
  /** Ligne `return` seulement (le départ du diagramme) : ce que son plan contient, chaque déplacement compté une fois. */
  start?: { returns: number; weights: number; choices: number };
}

/** Avancement d'un diagramme : `done` calculs faits sur `total`, et les lignes déjà connues (départ et lignes désactivées comprises). */
export interface LadderProgress {
  done: number;
  total: number;
  rows: LadderRow[];
}

/**
 * Diagramme de la liste : un calcul du plan par règle active, chacune étant la dernière permise, avec son propre budget
 * de nœuds (`nodeBudget` par groupe, `DEFAULT_NODE_BUDGET` par défaut) : une ligne lourde n'en prive jamais une autre.
 * Le plan retenu est celui de la ligne de coupure ; si cette règle est désactivée, c'est celui de la dernière ligne active
 * au-dessus (mêmes règles permises), ou, à défaut, un calcul de plus.
 * Chaque ligne part aussi du plan de la ligne active au-dessus (ses déplacements restent permis avec une règle de
 * plus) : à partir de la première règle, les barres ne remontent jamais, même quand une recherche n'est pas prouvée.
 * `onProgress` est appelé une fois après chaque calcul.
 */
export function planLadder(
  state: State,
  opts: { waveId: string | null; choices: PlanChoice[]; nodeBudget?: number },
  onProgress?: (p: LadderProgress) => void,
): { rows: LadderRow[]; plan: PlanResult } {
  const { order, cutAfter } = state.settings.replacementRules;
  const cutIndex = order.indexOf(cutAfter);
  const active = order.filter((r) => isRuleOn(state.settings, r));
  const needsExtra = !isRuleOn(state.settings, cutAfter) && !order.some((r, i) => i < cutIndex && isRuleOn(state.settings, r));
  const total = active.length + (needsExtra ? 1 : 0);
  let done = 0;
  const off = (rule: RuleId): LadderRow => ({ rule, on: false, alone: null, moves: 0, toValidate: 0, proven: true });
  const report = (rows: LadderRow[], next: number) => {
    done++;
    if (!onProgress) return;
    const known = [...rows];
    for (let j = next; j < order.length && !isRuleOn(state.settings, order[j]!); j++) known.push(off(order[j]!));
    onProgress({ done, total, rows: known });
  };
  const base = { waveId: opts.waveId, choices: opts.choices, ...(opts.nodeBudget === undefined ? {} : { nodeBudget: opts.nodeBudget }) };
  let seed: SolveExtra['seed'];
  const rows: LadderRow[] = [
    { rule: null, on: true, alone: aloneRegistrations(state, opts.waveId).length, moves: 0, toValidate: 0, proven: true },
  ];
  let plan: PlanResult | null = null;
  let above: PlanResult | null = null;
  for (const [i, rule] of order.entries()) {
    if (!isRuleOn(state.settings, rule)) {
      rows.push(off(rule));
      continue;
    }
    const { result: r, found, pins } = solvePlan(state, { ...base, level: rule }, { seed });
    seed = pins === null ? undefined : { pins, moves: found };
    if (rule === cutAfter) plan = r;
    if (i < cutIndex) above = r;
    rows.push({
      rule, on: true, alone: r.aloneAfter.length, moves: r.moves.length, toValidate: r.moves.filter((m) => m.manual && !m.validated).length, proven: r.proven,
      ...(rule === 'return' ? { start: startDetail(r.moves) } : {}),
    });
    report(rows, i + 1);
  }
  if (!plan && above) plan = above;
  if (!plan) {
    plan = solvePlan(state, { ...base, level: cutAfter }, {}).result;
    report(rows, order.length);
  }
  return { rows, plan };
}
