import { keyString, type CategoryKey } from '../categories.js';
import { waveOfCategory } from '../waves.js';
import { applyProposal, type Move } from './move.js';
import type { Case, CategoryState, Member, Proposal, State } from './types.js';

const uniq = (xs: string[]) => [...new Set(xs)];

/** Tranches des combattants d'origine (non recasés) d'une catégorie, comme dans l'app. */
const originBands = (state: State, categoryId: string, except?: string) =>
  uniq(state.members.filter((m) => m.categoryId === categoryId && !m.placementLocked && m.registrationId !== except).map((m) => m.ageBandCode));

/** Vague d'une catégorie, calculée comme dans l'app (null : en attente, ou pas de vague). */
export function categoryWave(state: State, cat: CategoryState): string | null {
  if (state.waves.length === 0) return null;
  return waveOfCategory({ key: cat.key, waveOverride: cat.waveOverride, waveBands: originBands(state, cat.id) }, state.waves, state.grid);
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
  let to: string | null;
  if (!target) to = 'newKey' in p.target ? keyWave(state, p.target.newKey) : null;
  else {
    // Comme applyProposal : un retour libère le combattant, une correction de poids le laisse tel quel, le reste le fige.
    const isWeightCorrection = p.type === 'A' && p.changes.weightClassId !== undefined;
    const unlockedAfter = p.type === 'R' || (isWeightCorrection && !m.placementLocked);
    const bands = uniq([...originBands(state, target.id, m.registrationId), ...(unlockedAfter ? [m.ageBandCode] : [])]);
    // Sans combattant d'origine, la clé (élargie à sa tranche) décide.
    const key = bands.length > 0 ? target.key : { ...target.key, ageBandCodes: uniq([...target.key.ageBandCodes, m.ageBandCode]) };
    to = waveOfCategory({ key, waveOverride: target.waveOverride, waveBands: bands }, state.waves, state.grid);
  }
  return from === to ? null : { from, to };
}

/** Vague de chaque catégorie, en un seul passage sur les inscriptions. */
export function categoryWaves(state: State): Map<string, string | null> {
  const bands = new Map<string, Set<string>>();
  for (const m of state.members) if (m.categoryId && !m.placementLocked) bands.set(m.categoryId, (bands.get(m.categoryId) ?? new Set()).add(m.ageBandCode));
  return new Map(
    state.categories.map((c) => [
      c.id,
      state.waves.length === 0 ? null : waveOfCategory({ key: c.key, waveOverride: c.waveOverride, waveBands: [...(bands.get(c.id) ?? [])] }, state.waves, state.grid),
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
 * Une catégorie change de vague quand ses tranches d'origine changent, ou quand elle n'a que des recasés (sa clé décide) :
 * le déplacement peut alors emmener d'autres combattants. Seuls ces cas, rares, sont vérifiés en appliquant la proposition.
 */
function mayMoveOthers(state: State, m: Member, p: Pick<Proposal, 'type' | 'target' | 'changes'>): boolean {
  const others = (id: string | null) => state.members.filter((x) => x.categoryId === id && x.registrationId !== m.registrationId);
  const shifts = (rest: Member[], moverUnlocked: boolean) =>
    rest.length > 0 && (rest.every((x) => x.placementLocked) || (moverUnlocked && !rest.some((x) => !x.placementLocked && x.ageBandCode === m.ageBandCode)));
  if (shifts(others(m.categoryId), !m.placementLocked)) return true;
  const target = 'categoryId' in p.target ? p.target.categoryId : state.categories.find((c) => keyString(c.key) === keyString((p.target as { newKey: CategoryKey }).newKey))?.id;
  if (!target) return false;
  const isWeightCorrection = p.type === 'A' && p.changes.weightClassId !== undefined;
  return shifts(others(target), p.type === 'R' || (isWeightCorrection && !m.placementLocked));
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
