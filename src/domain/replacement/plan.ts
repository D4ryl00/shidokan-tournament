import { categoryLabel, type CategoryKey } from '../categories.js';
import { DISCIPLINES } from '../disciplines.js';
import type { RuleId } from '../settings.js';
import { detectCases } from './detect.js';
import { manualProposal } from './manual.js';
import { applyAll } from './move.js';
import { solveGroups } from './plan-groups.js';
import { DEFAULT_NODE_BUDGET, aloneRegistrations, costRank, type SearchContext } from './plan-search.js';
import { proposalsFor, rulesForMove } from './propose.js';
import { allowedAt, costBand, isRuleOn, NO_VALIDATION_RULES, ruleRank, withAllRules, type CostBand } from './rules.js';
import type { Proposal, State } from './types.js';
import { activeMembers, categoryWeightGap, gapThreshold } from './weights.js';

export { DEFAULT_NODE_BUDGET, aloneRegistrations } from './plan-search.js';

/** Décision de l'organisateur, fixée avant le calcul : une proposition validée, ou une catégorie choisie (« Modifier »). */
export type PlanChoice =
  | { kind: 'validate'; proposalId: string; caseId: string }
  | { kind: 'manual'; registrationId: string; categoryId: string };

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

/**
 * Plan d'ensemble d'une session : d'abord les choix de l'organisateur, dans l'ordre reçu ; puis, groupe par groupe,
 * le placement qui laisse le moins de combattants seuls avec les règles permises (actives, jusqu'à `level`).
 */
export function computePlan(state: State, opts: PlanOptions): PlanResult {
  const forApply = opts.forApply === true;
  const atLevel = allowedAt(state.settings, opts.level);
  const allowed = forApply ? NO_VALIDATION_RULES : atLevel;
  const moves: PlanMove[] = [];
  const dropped: PlanChoice[] = [];
  const excluded = new Set<string>();
  let cur = state;

  // 1. Les choix d'abord : jamais défaits, même si leur règle est désactivée ou sous la ligne.
  for (const choice of opts.choices) {
    const everything = { ...cur, settings: withAllRules(cur.settings, cur.grid) };
    let p: Proposal | null = null;
    let warnings: string[] = [];
    if (choice.kind === 'validate') {
      const c = detectCases(cur).find((x) => x.id === choice.caseId);
      p = c ? (proposalsFor(everything, c).find((x) => x.id === choice.proposalId) ?? null) : null;
    } else {
      const r = manualProposal(cur, choice.registrationId, choice.categoryId);
      if ('p' in r) {
        p = { ...r.p, rules: rulesForMove(everything, choice.registrationId, choice.categoryId) ?? [] };
        warnings = r.warnings;
      }
    }
    const movers = p ? [p.registrationId, ...(p.alsoMoved ?? [])] : [];
    if (!p || p.waveChange || p.waveShifts.length > 0 || movers.some((r) => excluded.has(r))) {
      dropped.push(choice);
      continue;
    }
    const rules = p.rules;
    const outside: PlanMove['outside'] =
      warnings.length > 0 ? 'breaks-rules'
      : rules.some((r) => !isRuleOn(state.settings, r)) ? 'disabled'
      : rules.some((r) => !atLevel.has(r)) ? 'below-cut'
      : null;
    const after = applyAll(cur, p);
    const needsValidation = choice.kind === 'manual' ? rules.length === 0 || rules.some((r) => !NO_VALIDATION_RULES.has(r)) : p.manual;
    moves.push(planMove(cur, after, p, { validated: true, outside, needsValidation, measured: choice.kind === 'manual' }));
    for (const r of movers) excluded.add(r);
    cur = after;
  }

  // 2. Les cas ouverts, en groupes indépendants ; chaque groupe part du rejeu « carte par carte » et cherche mieux.
  const ctx: SearchContext = { waveId: opts.waveId, allowed, forApply, excluded };
  const { moves: found, onCards, proven } = solveGroups(cur, ctx, opts.nodeBudget ?? DEFAULT_NODE_BUDGET);
  // 3. Fusion : les déplacements des groupes, appliqués à l'état courant dans l'ordre trouvé.
  for (const m of found) {
    const after = applyAll(cur, m.p);
    moves.push(planMove(cur, after, m.p, { validated: false, outside: null, needsValidation: m.p.manual }));
    cur = after;
  }

  const cards = new Set(onCards);
  return {
    moves,
    aloneBefore: aloneRegistrations(state, opts.waveId),
    aloneAfter: aloneRegistrations(cur, opts.waveId).filter((r) => !cards.has(r)),
    onCards: [...cards].sort(),
    dropped,
    proven,
    final: cur,
    hash: moves.map((m) => m.id).join('|'),
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
}

/**
 * Diagramme de la liste : un calcul du plan par règle active, chacune étant la dernière permise.
 * Le plan retenu est celui de la ligne de coupure, calculé une seule fois.
 */
export function planLadder(state: State, opts: { waveId: string | null; choices: PlanChoice[] }): { rows: LadderRow[]; plan: PlanResult } {
  const { order, cutAfter } = state.settings.replacementRules;
  const run = (level: RuleId) => computePlan(state, { waveId: opts.waveId, level, choices: opts.choices });
  const rows: LadderRow[] = [
    { rule: null, on: true, alone: aloneRegistrations(state, opts.waveId).length, moves: 0, toValidate: 0, proven: true },
  ];
  let plan: PlanResult | null = null;
  for (const rule of order) {
    const on = isRuleOn(state.settings, rule);
    if (!on) {
      rows.push({ rule, on, alone: null, moves: 0, toValidate: 0, proven: true });
      continue;
    }
    const r = run(rule);
    if (rule === cutAfter) plan = r;
    rows.push({ rule, on, alone: r.aloneAfter.length, moves: r.moves.length, toValidate: r.moves.filter((m) => m.manual && !m.validated).length, proven: r.proven });
  }
  return { rows, plan: plan ?? run(cutAfter) };
}
