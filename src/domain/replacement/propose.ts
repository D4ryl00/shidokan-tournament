import { ageMove } from '../ages.js';
import type { RuleId } from '../settings.js';
import { categoryLabel, keyString, naturalKey, type CategoryKey } from '../categories.js';
import { DISCIPLINES } from '../disciplines.js';
import { neighborWeightClasses } from '../weights.js';
import { categoryForKey, isClosedTarget, isLocked, originalCategory } from './detect.js';
import type { Case, CategoryState, Member, Proposal, ProposalType, State } from './types.js';
import { isRuleOn, NO_VALIDATION_RULES, PRE_APPROVAL_RULES } from './rules.js';
import { waveEffects } from './waves.js';
import { applyProposal } from './move.js';
import { activeMembers, categoryWeightGap, effectiveWeight, gapThreshold, weighInClass } from './weights.js';

/**
 * Compatibilité d'âge entre `band` et toutes les tranches d'une catégorie : chaque paire doit être la même tranche
 * ou deux tranches reliées (C ou D, dans un sens ou l'autre), selon les réglages. Jamais deux tranches d'écart.
 */
export function ageCompatibility(
  state: State,
  band: string,
  targetBands: string[],
  /** Déplacement manuel : deux tranches voisines dans les deux sens (un benjamin parmi des pupilles). */
  opts: { bothWays?: boolean } = {},
): { ok: boolean; kind: 'same' | 'C' | 'D'; crossesMinorAdult: boolean; directions: ('up' | 'down')[] } {
  const { grid, settings } = state;
  const allowed = (x: ReturnType<typeof ageMove>) =>
    (x.kind === 'C' || x.kind === 'D') && (x.kind !== 'D' || settings.mixSeniorsVeterans) && (!x.crossesMinorAdult || settings.mixMinorsAdults);
  let kind: 'same' | 'C' | 'D' = 'same';
  let crossesMinorAdult = false;
  const dirs = new Set<'up' | 'down'>();
  for (const b of targetBands) {
    if (b === band) continue;
    const up = ageMove(grid, band, b);
    const down = ageMove(grid, b, band);
    // On monte d'une tranche ; une tranche plus jeune n'est admise que si la sienne est déjà dans la catégorie.
    const goesUp = allowed(up);
    const link = goesUp ? up : (opts.bothWays || targetBands.includes(band)) && allowed(down) ? down : null;
    if (!link || (link.kind !== 'C' && link.kind !== 'D')) return { ok: false, kind, crossesMinorAdult, directions: [] };
    if (link.crossesMinorAdult) crossesMinorAdult = true;
    if (!targetBands.includes(band)) {
      kind = kind === 'D' ? 'D' : link.kind;
      dirs.add(goesUp ? 'up' : 'down');
    }
  }
  return { ok: true, kind, crossesMinorAdult, directions: (['up', 'down'] as const).filter((d) => dirs.has(d)) };
}

const isMinor = (state: State, code: string) => state.grid.ageBands.find((b) => b.code === code)?.isMinor ?? false;

/** Pourquoi la tranche `band` ne peut pas rejoindre ces tranches (déplacement manuel, dans les deux sens). */
function ageViolations(state: State, band: string, targetBands: string[]): string[] {
  const out = new Set<string>();
  for (const b of targetBands) {
    if (b === band) continue;
    const links = [ageMove(state.grid, band, b), ageMove(state.grid, b, band)].filter((x) => x.kind === 'C' || x.kind === 'D');
    if (links.length === 0) out.add("Écart d'âge de plus d'une tranche.");
    for (const x of links) {
      if (x.kind === 'D' && !state.settings.mixSeniorsVeterans) out.add('Mélange seniors / vétérans non autorisé (réglages).');
      if ('crossesMinorAdult' in x && x.crossesMinorAdult && !state.settings.mixMinorsAdults) out.add('Mélange mineurs / adultes non autorisé (réglages).');
    }
  }
  return [...out];
}

interface Evaluation {
  type: ProposalType;
  changes: Proposal['changes'];
  checks: Proposal['checks'];
}

/** Compatibilité d'un déplacement de `m` vers la catégorie `t` (null = interdit). */
function evaluate(state: State, m: Member, t: CategoryState): Evaluation | null {
  const { settings, grid } = state;
  const tk = t.key;
  const changes: Proposal['changes'] = {};
  let H = false;
  let G = false;
  let F = false;
  let age: 'same' | 'C' | 'D' = 'same';
  let crossesMinorAdult = false;

  if (tk.discipline !== m.discipline) {
    if (!DISCIPLINES[m.discipline].inPreferences || !DISCIPLINES[tk.discipline].inPreferences || !m.otherDisciplines.includes(tk.discipline)) return null;
    H = true;
    changes.discipline = tk.discipline;
  }
  if (tk.ruleset !== m.ruleset) {
    if (m.ruleset === 'shobu' && tk.ruleset === 'jiyu' && settings.shobuToJiyu) {
      G = true;
      changes.ruleset = 'jiyu';
    } else return null;
  }
  if (tk.ruleset === 'shobu' && isMinor(state, m.ageBandCode)) return null;

  const sameSex = tk.sex === m.sex;
  if (!sameSex) {
    if (!settings.mixSexes.enabled || !settings.mixSexes.ageBandCodes.includes(m.ageBandCode)) return null;
    F = true;
  }
  const ages = ageCompatibility(state, m.ageBandCode, tk.ageBandCodes, { bothWays: true });
  if (!ages.ok) return null;
  age = ages.kind;
  crossesMinorAdult = ages.crossesMinorAdult;
  const ageDirections = ages.directions;

  const merged = [...activeMembers(state, t.id).filter((x) => x.registrationId !== m.registrationId), m];
  const hasWeight = DISCIPLINES[tk.discipline].hasWeight;
  const gap = hasWeight ? categoryWeightGap(merged, grid) : 0;
  const threshold = gapThreshold(merged, state);
  let B = false;
  if (hasWeight && m.weightClassId) {
    const sameBandSex = sameSex && tk.ageBandCodes.includes(m.ageBandCode);
    if (sameBandSex) {
      const wc = grid.weightClasses.find((w) => w.id === m.weightClassId);
      const { lighter, heavier } = wc ? neighborWeightClasses(grid, wc) : { lighter: null, heavier: null };
      const near = [m.weightClassId, lighter?.id, heavier?.id];
      if (!tk.weightClassIds.some((id) => near.includes(id))) return null;
      B = gap > threshold + 1e-9;
    } else if (gap > threshold + 1e-9) return null;
  }

  const type: ProposalType = F ? 'F' : crossesMinorAdult ? 'E' : H ? 'H' : G ? 'G' : age !== 'same' ? age : B ? 'B' : 'A';
  return { type, changes, checks: { weightGapKg: Math.round(gap * 100) / 100, threshold, ageMove: age, crossesMinorAdult, mixedSex: F, ageDirections } };
}

type ProfileInput = Omit<Proposal, 'rules' | 'manual' | 'preApproved' | 'rank'>;

/**
 * Règles qu'une proposition utilise, et si elle s'impose (retour, correction d'un poids hors catégorie : jamais
 * retirée même si une règle est désactivée).
 */
export function ruleProfile(state: State, p: ProfileInput): { rules: RuleId[]; forced: boolean } {
  const over = p.checks.weightGapKg > p.checks.threshold + 1e-9;
  if (p.type === 'R') return { rules: ['return'], forced: true };
  const m = state.members.find((x) => x.registrationId === p.registrationId);
  const caseReg = p.caseId.slice(p.caseId.indexOf(':') + 1);
  if (p.caseId.startsWith('alone:') && p.registrationId !== caseReg) return { rules: over ? ['split', 'weightGap'] : ['split'], forced: false };
  if (m && p.caseId.startsWith('weight_out:') && p.changes.weightClassId !== undefined) {
    const wic = weighInClass(m, state);
    if (wic) {
      const ks = keyString(naturalKey({ ...m, weightClassId: wic.id }, m));
      const own = 'newKey' in p.target ? keyString(p.target.newKey) === ks : categoryForKey(state, ks)?.id === p.target.categoryId;
      if (own) return { rules: over ? ['weightGap'] : [], forced: true };
    }
  }
  const rules: RuleId[] = [];
  if (p.changes.discipline) rules.push('discipline');
  if (p.changes.ruleset === 'jiyu') rules.push('shobuToJiyu');
  if (p.checks.mixedSex) rules.push('mixSexes');
  if (p.checks.crossesMinorAdult) rules.push('minorsAdults');
  else if (p.checks.ageMove === 'D') rules.push('seniorsVeterans');
  else for (const d of p.checks.ageDirections) rules.push(d === 'up' ? 'ageUp' : 'ageDown');
  if (over) rules.push('weightGap');
  if (rules.length === 0) rules.push('weight');
  return { rules, forced: false };
}

/** Règles d'un déplacement de l'inscription vers une catégorie existante (comme une proposition) ; `null` si interdit. */
export function rulesForMove(state: State, registrationId: string, categoryId: string): RuleId[] | null {
  const m = state.members.find((x) => x.registrationId === registrationId);
  const t = state.categories.find((c) => c.id === categoryId);
  if (!m || !t) return null;
  const ev = evaluate(state, m, t);
  if (!ev) return null;
  return ruleProfile(state, {
    id: `M:${registrationId}>${categoryId}`, caseId: 'manual', type: ev.type, registrationId, target: { categoryId },
    changes: ev.changes, checks: ev.checks, waveChange: null, waveShifts: [], reason: '',
  }).rules;
}

/** Drapeaux dérivés des règles d'une proposition ; `null` si une règle utilisée est désactivée (sauf si elle s'impose). */
function withRules<T extends ProfileInput>(state: State, movers: Member[], p: T): (T & Pick<Proposal, 'rules' | 'manual' | 'preApproved'>) | null {
  const { rules, forced } = ruleProfile(state, p);
  if (!forced && rules.some((r) => !isRuleOn(state.settings, r))) return null;
  return {
    ...p,
    rules,
    manual: rules.some((r) => !NO_VALIDATION_RULES.has(r)),
    // Le pré-accord ne couvre que l'âge et le poids : toute règle à valider hors de ces deux-là l'exclut (§2.1).
    preApproved:
      movers.every((x) => x.clubPreApproval) &&
      !p.waveChange &&
      p.waveShifts.length === 0 &&
      rules.some((r) => !NO_VALIDATION_RULES.has(r)) &&
      rules.every((r) => NO_VALIDATION_RULES.has(r) || PRE_APPROVAL_RULES.has(r)),
  };
}

function order(m: Member): ProposalType[] {
  const gh: ProposalType[] = m.acceptsJiyuFirst ? ['G', 'H'] : ['H', 'G'];
  return ['R', 'A', 'B', 'C', 'D', ...gh, 'E', 'F'];
}

export function proposalsFor(state: State, c: Case): Proposal[] {
  const m = state.members.find((x) => x.registrationId === c.registrationId);
  if (!m) return [];
  const current = state.categories.find((x) => x.id === m.categoryId);
  const labelOf = (key: CategoryKey) => categoryLabel(key, state.grid);
  const from = current ? labelOf(current.key) : '—';
  const out: (Omit<Proposal, 'rank'> & { sortKey: (number | string)[] })[] = [];
  const make = (type: ProposalType, target: Proposal['target'], toKey: CategoryKey, ev: Omit<Evaluation, 'type'>, members: number, extra: (number | string)[] = []) => {
    const targetId = 'categoryId' in target ? target.categoryId : keyString(target.newKey);
    const id = `${type}:${m.registrationId}>${targetId}`;
    const opponents = 'categoryId' in target ? activeMembers(state, target.categoryId).filter((x) => x.registrationId !== m.registrationId) : [];
    const waves = waveEffects(state, { caseId: c.id, type, registrationId: m.registrationId, target, changes: ev.changes });
    const built = withRules(state, [m], {
      id,
      caseId: c.id,
      type,
      registrationId: m.registrationId,
      target,
      changes: ev.changes,
      checks: ev.checks,
      ...waves,
      // La catégorie telle qu'elle sera après le déplacement (« Benjamins / Minimes M · -45 / -50 kg »), et combien d'adversaires il y aura.
      reason: `${m.label} : ${from} → ${labelOf(arrivalKey(state, m, toKey, ev.changes))}${withWhom(opponents)}`,
    });
    if (built) out.push({ ...built, sortKey: [order(m).indexOf(type), ...extra, members === 1 ? 0 : 1, ev.checks.weightGapKg, labelOf(toKey)] });
  };

  if (c.kind === 'weight_out') {
    const wic = weighInClass(m, state);
    if (!wic) return [];
    const key = naturalKey({ ...m, weightClassId: wic.id }, m);
    const existing = categoryForKey(state, keyString(key));
    if (isLocked(existing)) return [];
    const merged = [...(existing ? activeMembers(state, existing.id) : []), m];
    const checks = { weightGapKg: Math.round(categoryWeightGap(merged, state.grid) * 100) / 100, threshold: gapThreshold(merged, state), ageMove: 'same' as const, crossesMinorAdult: false, mixedSex: false, ageDirections: [] };
    make('A', existing ? { categoryId: existing.id } : { newKey: key }, existing?.key ?? key, { changes: { weightClassId: wic.id }, checks }, merged.length - 1);
    if (merged.length === 1) {
      // Catégorie du poids réel vide : il y serait seul. Proposée en dernier, après les catégories où il aurait un adversaire.
      const alone = out.at(-1);
      if (!alone) return [];
      alone.reason += ' — il y sera seul (sans adversaire), à réaffecter ensuite';
      alone.sortKey[0] = Number.MAX_SAFE_INTEGER;
      const corrected = { ...m, weightClassId: wic.id };
      const hypothetical = { ...state, members: state.members.map((x) => (x.registrationId === m.registrationId ? corrected : x)) };
      for (const t of state.categories) {
        if (t.id === m.categoryId || isLocked(t) || !acceptsWeight(state, m, t)) continue;
        const others = activeMembers(state, t.id).filter((x) => x.registrationId !== m.registrationId);
        if (others.length === 0) continue;
        const ev = evaluate(hypothetical, corrected, t);
        if (!ev) continue;
        const prefIndex = ev.changes.discipline ? m.otherDisciplines.indexOf(ev.changes.discipline) : 0;
        const before = out.length;
        make(ev.type, { categoryId: t.id }, t.key, { changes: { ...ev.changes, weightClassId: wic.id }, checks: ev.checks }, others.length, [prefIndex]);
        if (out.length > before) out.at(-1)!.reason += ` — lui en ${wic.label} kg, la catégorie de son poids réel`;
      }
    }
  } else if (c.kind === 'return') {
    const home = originalCategory(state, m);
    if (!home || !m.original) return [];
    const merged = [...activeMembers(state, home.id), m];
    const checks = { weightGapKg: Math.round(categoryWeightGap(merged, state.grid) * 100) / 100, threshold: gapThreshold(merged, state), ageMove: 'same' as const, crossesMinorAdult: false, mixedSex: false, ageDirections: [] };
    const changes: Proposal['changes'] = { discipline: m.original.discipline, ...(m.original.ruleset ? { ruleset: m.original.ruleset } : {}), ...(m.original.weightClassId ? { weightClassId: m.original.weightClassId } : {}) };
    make('R', { categoryId: home.id }, home.key, { changes, checks }, merged.length - 1);
  } else {
    for (const t of state.categories) {
      if (t.id === m.categoryId || isLocked(t)) continue;
      const others = activeMembers(state, t.id).filter((x) => x.registrationId !== m.registrationId);
      if (others.length === 0) continue;
      const ev = evaluate(state, m, t);
      if (!ev) continue;
      const prefIndex = ev.changes.discipline ? m.otherDisciplines.indexOf(ev.changes.discipline) : 0;
      make(ev.type, { categoryId: t.id }, t.key, ev, others.length, [prefIndex]);
    }
  }

  if (c.kind === 'alone') {
    for (const pull of pullProposals(state, m)) {
      const waves = waveEffects(state, { caseId: c.id, type: pull.type, registrationId: pull.moved[0]!.registrationId, target: pull.target, changes: {} });
      const names = pull.moved.map((x) => x.label).join(' et ');
      const k = pull.moved.length;
      const built = withRules(state, pull.moved, {
        id: `${pull.type}:${pull.moved.map((x) => x.registrationId).join('+')}>${pull.target.categoryId}`,
        caseId: c.id,
        type: pull.type,
        registrationId: pull.moved[0]!.registrationId,
        alsoMoved: pull.moved.slice(1).map((x) => x.registrationId),
        target: pull.target,
        changes: {},
        checks: pull.checks,
        ...waves,
        reason: `${names} : ${labelOf(pull.from)} → ${labelOf(pull.to)}, pour donner ${k > 1 ? 'une poule' : 'un adversaire'} à ${m.label}`,
      });
      // Après les déplacements du combattant lui-même (de même type) : la poule de 3 d'abord.
      if (built) out.push({ ...built, sortKey: [order(m).indexOf(pull.type), 0, k > 1 ? 2 : 3, pull.checks.weightGapKg, labelOf(pull.to)] });
    }
  }

  const cmp = (a: (number | string)[], b: (number | string)[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x === y) continue;
      return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    }
    return 0;
  };
  // Les tris G/H n'ont pas d'indice de préférence : on aligne les clés sur la même longueur.
  for (const p of out) if (p.sortKey.length === 4) p.sortKey.splice(1, 0, 0);
  // Une catégorie fermée n'est jamais une cible (existante ou à créer).
  const closedTarget = (p: (typeof out)[number]) => {
    if ('newKey' in p.target) return isClosedTarget(state, p.target.newKey);
    const id = p.target.categoryId;
    const t = state.categories.find((x) => x.id === id);
    return t !== undefined && isClosedTarget(state, t.key);
  };
  return out
    .filter((p) => !state.refused.includes(p.id) && !closedTarget(p))
    .sort((a, b) => cmp(a.sortKey, b.sortKey))
    .map(({ sortKey: _s, ...p }, rank) => ({ ...p, rank }));
}

/** Clé de la catégorie d'arrivée une fois `m` arrivé (avec ses changements) : tranches, poids et sexe réunis. */
function arrivalKey(state: State, m: Member, toKey: CategoryKey, changes: Proposal['changes']): CategoryKey {
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const wc = changes.weightClassId !== undefined ? changes.weightClassId : m.weightClassId;
  return {
    ...toKey,
    sex: toKey.sex === m.sex ? toKey.sex : 'X',
    ageBandCodes: uniq([...toKey.ageBandCodes, m.ageBandCode]),
    weightClassIds: wc && DISCIPLINES[toKey.discipline].hasWeight ? uniq([...toKey.weightClassIds, wc]) : toKey.weightClassIds,
  };
}

/** « (1 adversaire) », « (4 adversaires) » : qui il rencontre se voit dans l'aperçu. */
function withWhom(opponents: Member[]): string {
  return opponents.length === 0 ? '' : ` (${opponents.length} adversaire${opponents.length > 1 ? 's' : ''})`;
}

/** La catégorie `t` accepte le poids pesé de `m` (tolérance comprise) : sa catégorie de poids la plus lourde n'est pas en dessous. */
function acceptsWeight(state: State, m: Member, t: CategoryState): boolean {
  if (m.weighInKg === null || !DISCIPLINES[t.key.discipline].hasWeight) return true;
  const limits = t.key.weightClassIds.map((id) => state.grid.weightClasses.find((w) => w.id === id)?.maxKg);
  if (limits.length === 0 || limits.some((kg) => kg === null || kg === undefined)) return true;
  const grams = (kg: number) => Math.round(kg * 1000);
  return grams(m.weighInKg) <= grams(Math.max(...(limits as number[]))) + grams(state.settings.weighInToleranceKg[m.sex]);
}

/**
 * « Split » : le combattant seul `m` reçoit le plus lourd (ou les deux plus lourds, pour une poule) d'une catégorie de la
 * catégorie de poids juste en dessous (même discipline, règlement, sexe et tranche d'âge), s'il y en reste au moins deux.
 * On ne fait jamais descendre un combattant vers une catégorie plus légère.
 */
function pullProposals(state: State, m: Member): { type: 'A' | 'B'; moved: Member[]; target: { categoryId: string }; from: CategoryKey; to: CategoryKey; checks: Proposal['checks'] }[] {
  const t = state.categories.find((x) => x.id === m.categoryId);
  if (!t || isLocked(t) || !m.weightClassId || !DISCIPLINES[m.discipline].hasWeight) return [];
  const wc = state.grid.weightClasses.find((w) => w.id === m.weightClassId);
  const lighter = wc ? neighborWeightClasses(state.grid, wc).lighter : null;
  if (!lighter) return [];
  const out: ReturnType<typeof pullProposals> = [];
  for (const source of state.categories) {
    if (source.id === t.id || isLocked(source)) continue;
    const active = activeMembers(state, source.id);
    const candidates = active
      .filter((y) => !y.placementLocked && y.weightClassId === lighter.id && y.discipline === m.discipline && y.ruleset === m.ruleset && y.sex === m.sex && y.ageBandCode === m.ageBandCode)
      .sort((a, b) => (effectiveWeight(b, state.grid) ?? 0) - (effectiveWeight(a, state.grid) ?? 0) || a.label.localeCompare(b.label));
    for (const k of [2, 1]) {
      if (candidates.length < k || active.length - k < 2) continue;
      let current = state;
      let type: 'A' | 'B' = 'A';
      const moved = candidates.slice(0, k);
      const ok = moved.every((y) => {
        const target = current.categories.find((x) => x.id === t.id)!;
        const ev = evaluate(current, y, target);
        if (!ev || (ev.type !== 'A' && ev.type !== 'B')) return false;
        if (ev.type === 'B') type = 'B';
        current = applyProposal(current, { type: ev.type, registrationId: y.registrationId, target: { categoryId: t.id }, changes: {}, caseId: `alone:${m.registrationId}` });
        return true;
      });
      if (!ok) continue;
      const merged = activeMembers(current, t.id);
      const checks = { weightGapKg: Math.round(categoryWeightGap(merged, state.grid) * 100) / 100, threshold: gapThreshold(merged, state), ageMove: 'same' as const, crossesMinorAdult: false, mixedSex: false, ageDirections: [] };
      out.push({ type, moved, target: { categoryId: t.id }, from: source.key, to: current.categories.find((x) => x.id === t.id)!.key, checks });
    }
  }
  return out;
}

/** Règles qu'enfreindrait un déplacement libre de `m` vers `t` (avertissements, en français). */
export function moveViolations(state: State, m: Member, t: CategoryState): string[] {
  const v: string[] = [];
  const { settings, grid } = state;
  if (isLocked(t)) v.push('La catégorie est lancée.');
  if (t.key.discipline !== m.discipline && !m.otherDisciplines.includes(t.key.discipline)) v.push('Discipline hors des préférences du combattant.');
  if (m.ruleset === 'jiyu' && t.key.ruleset === 'shobu') v.push('Passage de jiyu à shobu.');
  if (m.ruleset === 'shobu' && t.key.ruleset === 'jiyu' && !settings.shobuToJiyu) v.push('Passage de shobu à jiyu non autorisé (réglages).');
  if (t.key.ruleset === 'shobu' && isMinor(state, m.ageBandCode)) v.push('Le shobu est réservé aux adultes.');
  if (t.key.sex !== m.sex && (!settings.mixSexes.enabled || !settings.mixSexes.ageBandCodes.includes(m.ageBandCode))) {
    v.push('Mélange filles / garçons non autorisé (mixité désactivée).');
  }
  if (!ageCompatibility(state, m.ageBandCode, t.key.ageBandCodes, { bothWays: true }).ok) v.push(...ageViolations(state, m.ageBandCode, t.key.ageBandCodes));
  if (DISCIPLINES[t.key.discipline].hasWeight) {
    const merged = [...activeMembers(state, t.id).filter((x) => x.registrationId !== m.registrationId), m];
    const gap = categoryWeightGap(merged, grid);
    const threshold = gapThreshold(merged, state);
    if (gap > threshold + 1e-9) v.push(`Écart de poids de ${gap.toFixed(1).replace('.', ',')} kg (maximum ${threshold} kg).`);
  }
  return v;
}
