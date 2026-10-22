import { keyString, naturalKey, type CategoryKey } from '../categories.js';
import type { CaseKind, CategoryState, Member, Proposal, State } from './types.js';

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

/** Ce dont a besoin l'application d'une proposition. */
export type Move = Pick<Proposal, 'type' | 'registrationId' | 'target' | 'changes' | 'caseId'> & Pick<Partial<Proposal>, 'alsoMoved'>;

/** Les déplacements d'une proposition, un par inscription (plusieurs pour un « split »). */
export function proposalMoves<T extends Move>(p: T): T[] {
  return [p, ...(p.alsoMoved ?? []).map((registrationId) => ({ ...p, registrationId, alsoMoved: undefined }))];
}

/** Applique une proposition entière (tous ses déplacements) à une copie de l'état. */
export function applyAll(state: State, p: Move): State {
  return proposalMoves(p).reduce(applyProposal, state);
}

/** Applique le déplacement d'une inscription (`p.registrationId`, sans `alsoMoved`) à une copie de l'état (l'état reçu n'est pas modifié). */
export function applyProposal(state: State, p: Move): State {
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
      // Un combattant emmené par un « split » n'avait pas de cas : il ne revient pas de lui-même.
      const [caseKind, caseRegistration] = p.caseId.split(':') as [CaseKind, string];
      const kind = p.type === 'M' ? 'manual' : caseRegistration === p.registrationId ? caseKind : 'pulled';
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
