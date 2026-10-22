import { keyString, naturalKey, type CategoryKey } from '../categories.js';
import { detectCases } from './detect.js';
import { proposalsFor } from './propose.js';
import type { Case, CaseKind, CategoryState, Member, Proposal, State } from './types.js';
import { casesOfWave } from './waves.js';

const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();

/**
 * Clé d'une catégorie d'après ses membres présents (union des tranches d'âge et des poids, mixte si besoin ;
 * tous les membres si tous sont absents) ; aliasKeys = clés naturelles de ses membres non verrouillés,
 * absents compris, pour que la synchronisation les y laisse.
 */
export function recompute(state: State, cat: CategoryState): void {
  const all = state.members.filter((m) => m.categoryId === cat.id);
  if (all.length === 0) return;
  const present = all.filter((m) => m.presence !== 'absent');
  const members = present.length > 0 ? present : all;
  const sexes = new Set(members.map((m) => m.sex));
  const key: CategoryKey = {
    discipline: members[0]!.discipline,
    ruleset: members[0]!.ruleset,
    sex: sexes.size === 1 ? members[0]!.sex : 'X',
    ageBandCodes: uniqSorted(members.map((m) => m.ageBandCode)),
    weightClassIds: uniqSorted(members.map((m) => m.weightClassId).filter((w): w is string => w !== null)),
  };
  cat.key = key;
  const own = keyString(key);
  cat.aliasKeys = uniqSorted(
    all.filter((m) => !m.placementLocked).map((m) => keyString(naturalKey(m, m))).filter((k) => k !== own),
  );
}

/** Applique une proposition à une copie de l'état (l'état reçu n'est pas modifié). */
export function applyProposal(state: State, p: Proposal): State {
  const next = structuredClone(state);
  const m = next.members.find((x) => x.registrationId === p.registrationId);
  if (!m) return next;
  const from = m.categoryId;

  let target: CategoryState;
  if ('categoryId' in p.target) {
    target = next.categories.find((c) => c.id === (p.target as { categoryId: string }).categoryId)!;
  } else {
    const ks = keyString(p.target.newKey);
    target = next.categories.find((c) => keyString(c.key) === ks) ?? { id: `new:${ks}`, key: p.target.newKey, status: 'provisional', aliasKeys: [], waveOverride: null };
    if (!next.categories.includes(target)) next.categories.push(target);
  }

  const isWeightCorrection = p.type === 'A' && p.changes.weightClassId !== undefined;
  if (p.type === 'R') {
    Object.assign(m, pickDefined(p.changes));
    m.placementLocked = false;
    m.original = null;
    m.recasementType = null;
  } else if (isWeightCorrection) {
    m.weightClassId = p.changes.weightClassId!;
  } else {
    if (!m.original) {
      const kind = p.type === 'M' ? 'manual' : (p.caseId.split(':')[0] as CaseKind);
      m.original = { discipline: m.discipline, ruleset: m.ruleset, weightClassId: m.weightClassId, reason: kind };
    }
    Object.assign(m, pickDefined(p.changes));
    m.placementLocked = true;
    m.recasementType = p.type;
  }
  m.categoryId = target.id;

  for (const id of [from, target.id]) {
    const cat = next.categories.find((c) => c.id === id);
    if (cat) recompute(next, cat);
  }
  next.categories = next.categories.filter(
    (c) => c.status === 'started' || c.status === 'finished' || next.members.some((x) => x.categoryId === c.id),
  );
  return next;
}

function pickDefined(changes: Proposal['changes']): Partial<Member> {
  return Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) as Partial<Member>;
}

export type BulkMode = 'simple' | 'all';
export interface BulkStep {
  proposal: Proposal;
  manual: boolean;
}

/**
 * Prochaine étape d'un recasement en masse : meilleure proposition sans changement de vague du premier cas traitable
 * de la vague (`null` : toutes), hors inscriptions déjà déplacées. Un changement de vague se valide un par un.
 */
export function nextBulkStep(state: State, mode: BulkMode, moved: Set<string>, waveId: string | null = null): Proposal | null {
  for (const c of casesOfWave(state, detectCases(state), waveId)) {
    if (moved.has(c.registrationId)) continue;
    const p = proposalsFor(state, c).find((x) => !x.waveChange && (mode === 'all' || x.type === 'A' || x.type === 'R'));
    if (p) return p;
  }
  return null;
}

/** Applique la meilleure proposition du premier cas traitable, recalcule, recommence ; une étape par inscription au plus. */
export function bulkPlan(state: State, mode: BulkMode, waveId: string | null = null): { steps: BulkStep[]; final: State; unresolved: Case[] } {
  let current = state;
  const steps: BulkStep[] = [];
  const moved = new Set<string>();
  for (let guard = 0; guard <= state.members.length; guard++) {
    const p = nextBulkStep(current, mode, moved, waveId);
    if (!p) break;
    current = applyProposal(current, p);
    steps.push({ proposal: p, manual: p.manual });
    moved.add(p.registrationId);
  }
  return { steps, final: current, unresolved: casesOfWave(current, detectCases(current), waveId) };
}

export function stateFingerprint(state: State): string {
  const data = JSON.stringify({
    m: [...state.members]
      .sort((a, b) => a.registrationId.localeCompare(b.registrationId))
      .map((m) => [
        m.registrationId, m.categoryId, m.presence, m.weighInKg, m.approxWeightKg, m.weightClassId, m.discipline, m.ruleset, m.ageBandCode, m.sex,
        m.placementLocked, m.clubId, m.clubPreApproval, m.otherDisciplines, m.acceptsJiyuFirst, m.original, m.recasementType,
      ]),
    c: [...state.categories].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [c.id, keyString(c.key), c.status, c.aliasKeys, c.waveOverride]),
    w: [...state.waves].sort((a, b) => a.id.localeCompare(b.id)).map((w) => [w.id, w.order, w.rules]),
    r: [...state.refused].sort(),
    s: state.settings,
    g: state.grid,
  });
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h * 33) ^ data.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
