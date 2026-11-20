import { keyString, type CategoryKey } from '../categories.js';
import { bandCounts, WAVE_NONE, waveOfCategory, type BandCounts } from '../waves.js';
import { applyProposal, type Move } from './move.js';
import type { Case, CategoryState, Member, Proposal, State } from './types.js';

const uniq = (xs: string[]) => [...new Set(xs)];

/** Voix des combattants d'une catégorie (recasés compris, sauf `except`), comme dans l'app ; sessions pas encore figées. */
const originBands = (state: State, categoryId: string, except?: string): BandCounts =>
  bandCounts(state.members.filter((m) => m.categoryId === categoryId && m.registrationId !== except), false);

/** Vague d'une catégorie, calculée comme dans l'app (null : en attente, ou pas de vague). */
export function categoryWave(state: State, cat: CategoryState): string | null {
  if (state.waves.length === 0) return null;
  return waveOfCategory({ key: cat.key, waveOverride: cat.waveOverride, bandCounts: originBands(state, cat.id) }, state.waves, state.grid);
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
  const own: BandCounts = { [m.ageBandCode]: 1 };
  let to: string | null;
  if (!target) to = 'newKey' in p.target ? waveOfCategory({ key: p.target.newKey, waveOverride: null, bandCounts: own }, state.waves, state.grid) : null;
  else {
    const counts = originBands(state, target.id, m.registrationId);
    counts[m.ageBandCode] = (counts[m.ageBandCode] ?? 0) + 1;
    // Sans voix, la clé (élargie à sa tranche, comme la recalcule applyProposal) décide.
    const key = { ...target.key, ageBandCodes: uniq([...target.key.ageBandCodes, m.ageBandCode]) };
    to = waveOfCategory({ key, waveOverride: target.waveOverride, bandCounts: counts }, state.waves, state.grid);
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
        : waveOfCategory({ key: c.key, waveOverride: c.waveOverride, bandCounts: bandCounts(members.get(c.id) ?? [], false) }, state.waves, state.grid),
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
 * La session d'une catégorie suit la majorité de ses combattants (recasés compris) : le déplacé retire sa voix de sa
 * catégorie et l'ajoute à la cible, et l'une ou l'autre peut basculer avec ses autres combattants. Seule une catégorie
 * sans autre combattant, ou dont la session est choisie à la main, ne peut rien emmener ; sinon la proposition est
 * appliquée pour vérifier.
 */
function mayMoveOthers(state: State, m: Member, p: Pick<Proposal, 'type' | 'target' | 'changes'>): boolean {
  const canShift = (id: string | null | undefined) => {
    const cat = id ? state.categories.find((c) => c.id === id) : undefined;
    if (!cat) return false;
    if (cat.waveOverride === WAVE_NONE || state.waves.some((w) => w.id === cat.waveOverride)) return false;
    return state.members.some((x) => x.categoryId === cat.id && x.registrationId !== m.registrationId);
  };
  if (canShift(m.categoryId)) return true;
  const target = 'categoryId' in p.target ? p.target.categoryId : state.categories.find((c) => keyString(c.key) === keyString((p.target as { newKey: CategoryKey }).newKey))?.id;
  return canShift(target);
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
