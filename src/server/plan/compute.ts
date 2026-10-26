/**
 * Réponse du plan d'ensemble à partir d'un `State` : rien que du calcul, sans base ni Fastify,
 * pour tourner aussi bien dans le fil de calcul (`worker.ts`) que dans le serveur.
 */
import { defaultFormat, generateBracket, resolveBracket } from '../../domain/brackets/index.js';
import { categoryLabel } from '../../domain/categories.js';
import {
  activeMembers,
  casesOfWave,
  computePlan,
  detectCases,
  planLadder,
  proposalsFor,
  rulesView,
  stateFingerprint,
  type LadderProgress,
  type LadderRow,
  type PlanChoice,
  type PlanMove,
  type PlanResult,
  type Proposal,
  type RulesView,
  type State,
} from '../../domain/replacement/index.js';

/** Demande de plan, une fois la vague vérifiée : `waveId` `null` pour tous les cas (compétition sans vague). */
export interface PlanInput {
  waveId: string | null;
  choices: PlanChoice[];
  forApply: boolean;
}

export interface PlanResponse {
  view: RulesView;
  /** Vide pour un plan à appliquer. */
  rows: LadderRow[];
  plan: {
    moves: PlanMove[];
    aloneBefore: number;
    alone: string[];
    onCards: string[];
    dropped: PlanChoice[];
    /** Pour appliquer : choix validés qui attendent un déplacement à valider non validé. */
    waiting: PlanChoice[];
    proven: boolean;
    hash: string;
    refused: { proposalId: string; registrationId: string; reason: string }[];
  };
  categories?: ReturnType<typeof previewTransition>;
  fingerprint: string;
}

/**
 * Plan d'ensemble de la session : le diagramme et le plan de la ligne de coupure, ou (`forApply`) le plan à appliquer et son aperçu.
 * `onProgress` : après chaque calcul du diagramme ; pour un plan à appliquer, une seule fois (`total` = 1, sans lignes).
 */
export function planPayload(state: State, input: PlanInput, onProgress?: (p: LadderProgress) => void): PlanResponse {
  const { waveId, choices, forApply } = input;
  const { cutAfter } = state.settings.replacementRules;
  let rows: LadderRow[] = [];
  let plan: PlanResult;
  if (forApply) {
    plan = computePlan(state, { waveId, level: cutAfter, choices, forApply: true });
    onProgress?.({ done: 1, total: 1, rows: [] });
  } else {
    ({ rows, plan } = planLadder(state, { waveId, choices }, onProgress));
  }
  const refused: PlanResponse['plan']['refused'] = [];
  for (const [, list] of displayedProposals(state, casesOfWave(state, detectCases(state), waveId))) {
    for (const p of list) if (p.refused) refused.push({ proposalId: p.id, registrationId: p.registrationId, reason: p.reason });
  }
  return {
    view: rulesView(state.settings),
    rows,
    plan: {
      moves: plan.moves,
      aloneBefore: plan.aloneBefore.length,
      alone: plan.aloneAfter,
      onCards: plan.onCards,
      dropped: plan.dropped,
      waiting: plan.waiting,
      proven: plan.proven,
      hash: plan.hash,
      refused,
    },
    ...(forApply ? { categories: previewTransition(state, plan.final) } : {}),
    fingerprint: stateFingerprint(state),
  };
}

/** Propositions à afficher : les valides, puis les refusées encore pertinentes (grisées, avec « Rétablir »). */
export function displayedProposals(state: State, cases = detectCases(state)): Map<string, (Proposal & { refused?: true })[]> {
  const all = { ...state, refused: [] };
  const refused = new Set(state.refused);
  return new Map(
    cases.map((c) => [
      c.id,
      [...proposalsFor(state, c), ...proposalsFor(all, c).filter((p) => refused.has(p.id)).map((p) => ({ ...p, refused: true as const }))],
    ]),
  );
}

// --- Aperçu ---

/** Paires du 1er tour (élimination) ou liste des membres (poule, kata) d'une catégorie de l'état. */
function lineup(state: State, categoryId: string): string[][] {
  const members = activeMembers(state, categoryId);
  const cat = state.categories.find((c) => c.id === categoryId);
  if (!cat || members.length === 0) return [];
  if (members.length < 2) return [members.map((m) => m.label)];
  const labels = new Map(members.map((m) => [m.registrationId, m.label]));
  const format = defaultFormat(cat.key.discipline, members.length, state.settings);
  if (format !== 'single_elimination' && format !== 'double_elimination') return [members.map((m) => m.label)];
  const bracket = generateBracket(
    format,
    members.map((m) => ({ registrationId: m.registrationId, clubId: m.clubId, label: m.label })),
    { repechage: false, thirdPlace: false, kataBronzeCount: state.settings.kataBronzeCount },
    1,
  );
  if (bracket.kind !== 'combat') return [members.map((m) => m.label)];
  return resolveBracket(bracket, {}).matches
    .filter((m) => m.round === 1 && m.phase === 'main')
    .map((m) => [m.entrantA, m.entrantB].filter((x): x is string => x !== null).map((id) => labels.get(id)!));
}

export function previewTransition(before: State, after: State) {
  const ids = new Set([...before.categories, ...after.categories].map((c) => c.id));
  const out: { label: string; before: string[][]; after: string[][] }[] = [];
  for (const id of ids) {
    const b = activeMembers(before, id).map((m) => m.registrationId).sort().join();
    const a = activeMembers(after, id).map((m) => m.registrationId).sort().join();
    if (a === b) continue;
    const cat = after.categories.find((c) => c.id === id) ?? before.categories.find((c) => c.id === id)!;
    out.push({ label: categoryLabel(cat.key, after.grid), before: lineup(before, id), after: lineup(after, id) });
  }
  return out;
}
