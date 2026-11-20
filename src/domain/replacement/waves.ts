import { isFreeKey, keyString, type CategoryKey } from '../categories.js';
import { bandCounts, hasFixedWave, waveOfCategory, type BandCounts } from '../waves.js';
import { applyProposal, membersKey, pickDefined, type Move } from './move.js';
import type { Case, CategoryState, Member, Proposal, State } from './types.js';

const uniq = (xs: string[]) => [...new Set(xs)];

/** Voix des combattants d'une catégorie (recasés compris, sauf `except`), comme dans l'app ; absents exclus une fois figées. */
const originBands = (state: State, categoryId: string, except?: string): BandCounts =>
  bandCounts(state.members.filter((m) => m.categoryId === categoryId && m.registrationId !== except), state.sessionsFrozen);

/** Voix du combattant déplacé dans sa cible (recasé ou non) : aucune s'il est absent et que les sessions sont figées. */
const ownVote = (state: State, m: Member): BandCounts => bandCounts([m], state.sessionsFrozen);

/** Vague d'une catégorie, calculée comme dans l'app (null : en attente, ou pas de vague). */
export function categoryWave(state: State, cat: CategoryState): string | null {
  if (state.waves.length === 0) return null;
  return waveOfCategory({ key: cat.key, waveOverride: cat.waveOverride, frozenWave: cat.frozenWave, bandCounts: originBands(state, cat.id) }, state.waves, state.grid);
}

/** Vague d'une nouvelle catégorie, d'après sa clé. */
export function keyWave(state: State, key: CategoryKey): string | null {
  if (state.waves.length === 0) return null;
  return waveOfCategory({ key, waveOverride: null }, state.waves, state.grid);
}

/** Vague de la catégorie d'une inscription. */
export function memberWave(state: State, m: Member): string | null {
  const cat = state.categories.find((c) => c.id === m.categoryId);
  return cat ? categoryWave(state, cat) : null;
}

/** Cas des catégories d'une vague (`null` : tous). */
export function casesOfWave(state: State, cases: Case[], waveId: string | null): Case[] {
  if (waveId === null) return cases;
  const waves = new Map(state.categories.map((c) => [c.id, categoryWave(state, c)]));
  return cases.filter((c) => c.categoryId !== null && waves.get(c.categoryId) === waveId);
}

/**
 * Changement de vague qu'entraînerait une proposition : vague de départ (catégorie actuelle) et d'arrivée
 * (catégorie cible telle qu'elle serait après le déplacement), null si elles sont égales.
 */
export function waveChangeOf(state: State, p: Pick<Proposal, 'type' | 'registrationId' | 'target' | 'changes'>): Proposal['waveChange'] {
  if (state.waves.length === 0) return null;
  const m = state.members.find((x) => x.registrationId === p.registrationId);
  if (!m) return null;
  const from = memberWave(state, m);
  let target: CategoryState | undefined;
  if ('categoryId' in p.target) {
    const id = p.target.categoryId;
    target = state.categories.find((c) => c.id === id);
  } else {
    const ks = keyString(p.target.newKey);
    target = state.categories.find((c) => keyString(c.key) === ks);
  }
  // Le combattant déplacé vote dans la cible, recasé ou non.
  const own = ownVote(state, m);
  let to: string | null;
  if (!target) to = 'newKey' in p.target ? waveOfCategory({ key: p.target.newKey, waveOverride: null, bandCounts: own }, state.waves, state.grid) : null;
  else {
    const counts = originBands(state, target.id, m.registrationId);
    for (const [band, n] of Object.entries(own)) counts[band] = (counts[band] ?? 0) + n;
    // Sans voix, la clé (élargie à sa tranche, comme la recalcule applyProposal) décide.
    const key = { ...target.key, ageBandCodes: uniq([...target.key.ageBandCodes, m.ageBandCode]) };
    to = waveOfCategory({ key, waveOverride: target.waveOverride, frozenWave: target.frozenWave, bandCounts: counts }, state.waves, state.grid);
  }
  return from === to ? null : { from, to };
}

/** Vague de chaque catégorie, en un seul passage sur les inscriptions. */
export function categoryWaves(state: State): Map<string, string | null> {
  const members = new Map<string, Member[]>();
  for (const m of state.members) {
    if (!m.categoryId) continue;
    const list = members.get(m.categoryId);
    if (list) list.push(m);
    else members.set(m.categoryId, [m]);
  }
  return new Map(
    state.categories.map((c) => [
      c.id,
      state.waves.length === 0
        ? null
        : waveOfCategory(
            { key: c.key, waveOverride: c.waveOverride, frozenWave: c.frozenWave, bandCounts: bandCounts(members.get(c.id) ?? [], state.sessionsFrozen) },
            state.waves,
            state.grid,
          ),
    ]),
  );
}

/** Inscriptions dont la vague diffère entre deux états (le combattant déplacé comme ceux que sa catégorie emmène). */
export function waveMoves(before: State, after: State): { registrationId: string; from: string | null; to: string | null }[] {
  if (before.waves.length === 0 && after.waves.length === 0) return [];
  const wb = categoryWaves(before);
  const wa = categoryWaves(after);
  const previous = new Map(before.members.map((m) => [m.registrationId, m.categoryId]));
  return after.members
    .map((m) => ({ registrationId: m.registrationId, from: wb.get(previous.get(m.registrationId) ?? '') ?? null, to: wa.get(m.categoryId ?? '') ?? null }))
    .filter((x) => x.from !== x.to);
}

/**
 * Le déplacement peut-il emmener d'autres combattants ? La session d'une catégorie suit la majorité de ses combattants
 * (recasés compris) : le déplacé retire sa voix de sa catégorie et l'ajoute à la cible. Filtre peu coûteux, sans
 * appliquer la proposition : pour la catégorie de départ et celle d'arrivée, compare la session avant et après le
 * déplacement (voix et clé recalculée, comme `applyProposal`). Vrai seulement si l'une d'elles change et qu'il y reste
 * d'autres combattants ; une catégorie figée ou choisie à la main ne change jamais.
 */
export function mayMoveOthers(state: State, m: Member, p: Pick<Proposal, 'type' | 'target' | 'changes'>): boolean {
  const target = p.target;
  let targetId: string | undefined;
  if ('categoryId' in target) targetId = target.categoryId;
  else {
    const ks = keyString(target.newKey);
    targetId = state.categories.find((c) => keyString(c.key) === ks)?.id;
  }
  // Le combattant tel que `applyProposal` le place (une correction de poids ne change que la catégorie de poids).
  const changes = p.type === 'A' && p.changes.weightClassId !== undefined ? { weightClassId: p.changes.weightClassId } : pickDefined(p.changes);
  const moved: Member = { ...m, ...changes, categoryId: targetId ?? null };
  const shifts = (id: string | null | undefined) => {
    const cat = id ? state.categories.find((c) => c.id === id) : undefined;
    // Une catégorie figée ou choisie à la main ne change jamais de session.
    if (!cat || hasFixedWave(cat, state.waves)) return false;
    // Combattants avant et après, dans l'ordre de l'état (comme `applyProposal`, dont la clé recalculée en dépend).
    const before: Member[] = [];
    const after: Member[] = [];
    let others = false;
    for (const x of state.members) {
      if (x.registrationId === m.registrationId) {
        if (x.categoryId === id) before.push(x);
        if (id === targetId) after.push(moved);
      } else if (x.categoryId === id) {
        before.push(x);
        after.push(x);
        others = true;
      }
    }
    // Personne d'autre : rien à emmener.
    if (!others) return false;
    const wave = (key: CategoryKey, members: Member[]) =>
      waveOfCategory({ key, waveOverride: cat.waveOverride, frozenWave: cat.frozenWave, bandCounts: bandCounts(members, state.sessionsFrozen) }, state.waves, state.grid);
    return wave(cat.key, before) !== wave(isFreeKey(cat.key) ? cat.key : membersKey(after), after);
  };
  return shifts(m.categoryId) || (targetId !== m.categoryId && shifts(targetId));
}

/** Changement de vague du combattant et des autres combattants qu'emmènerait la proposition. */
export function waveEffects(state: State, p: Move): Pick<Proposal, 'waveChange' | 'waveShifts'> {
  const m = state.members.find((x) => x.registrationId === p.registrationId);
  if (state.waves.length === 0 || !m) return { waveChange: null, waveShifts: [] };
  if (!mayMoveOthers(state, m, p)) return { waveChange: waveChangeOf(state, p), waveShifts: [] };
  const moves = waveMoves(state, applyProposal(state, p));
  const own = moves.find((x) => x.registrationId === m.registrationId);
  const label = new Map(state.members.map((x) => [x.registrationId, x.label]));
  return {
    waveChange: own ? { from: own.from, to: own.to } : null,
    waveShifts: moves.filter((x) => x !== own).map((x) => ({ ...x, label: label.get(x.registrationId) ?? '' })),
  };
}
