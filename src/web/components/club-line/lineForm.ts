import { PREF_DISCIPLINES, orderedPrefs, tidyReclass, type ClubFormLine, type CombatDiscipline, type PrefDiscipline } from '../../../domain/club-form.js';
import { entryKey } from '../../../domain/closed-categories.js';
import { DISCIPLINES } from '../../../domain/disciplines.js';
import type { DisciplineId, Ruleset } from '../../../domain/types.js';

export const NOT_OPEN = ' (non ouverte)';
export const COMBAT_LABELS: [CombatDiscipline, string][] = [['karate', 'Karaté'], ['shido-boxing', 'Boxing'], ['shido-mix', 'Mix'], ['triathlon', 'Triathlon']];
export const RULESET_LABELS: [Ruleset, string][] = [['jiyu', 'Jiyu'], ['shobu', 'Shobu']];

export interface AgeBandInfo { code: string; label: string; ages: string; isMinor: boolean }
export interface WeightClassInfo { id: string; ageBandCode: string; sex: 'F' | 'M'; label: string; maxKg: number | null }

/** Ce dont dépendent les choix de la fenêtre du combattant. */
export interface LineFormContext {
  /** Le coach ne se voit proposer que le ouvert ; l'organisateur voit aussi le fermé, marqué « (non ouverte) ». */
  mode: 'coach' | 'organiser';
  multipleCombats: boolean;
  /** Cases fermées (`entryKey`). */
  closed: Set<string>;
  ageBands: AgeBandInfo[];
  weightClasses: WeightClassInfo[];
  /** La ligne telle qu'enregistrée (null : création). */
  saved: ClubFormLine | null;
}

/** Ouvert pour la tranche et le sexe de la ligne (tout est ouvert tant qu'ils ne sont pas choisis). Le shobu n'existe pas chez les mineurs. */
function openFor(form: ClubFormLine, ctx: LineFormContext) {
  const band = ctx.ageBands.find((b) => b.code === form.ageBandCode);
  return (discipline: DisciplineId, ruleset: Ruleset | null) =>
    !band || !form.sex || (!ctx.closed.has(entryKey({ ageBandCode: band.code, sex: form.sex, discipline, ruleset })) && !(ruleset === 'shobu' && band.isMinor));
}

/** Ce que l'écran garde en choisissant : le coach, l'ouvert ; l'organisateur, tout sauf le shobu des mineurs. */
function allowedFor(form: ClubFormLine, ctx: LineFormContext) {
  if (ctx.mode === 'coach') return openFor(form, ctx);
  const band = ctx.ageBands.find((b) => b.code === form.ageBandCode);
  return (_discipline: DisciplineId, ruleset: Ruleset | null) => !(ruleset === 'shobu' && band?.isMinor);
}

/** Une tranche dont rien n'est ouvert pour ce sexe (proposée à l'organisateur, marquée). */
function bandShut(form: ClubFormLine, band: AgeBandInfo, ctx: LineFormContext): boolean {
  if (!form.sex) return false;
  const open = openFor({ ...form, ageBandCode: band.code }, ctx);
  return !open('kata', null) && !COMBAT_LABELS.some(([d]) => open(d, 'jiyu') || open(d, 'shobu'));
}

export function ageBandChoices(form: ClubFormLine, ctx: LineFormContext): { value: string; label: string }[] {
  return ctx.ageBands.map((b) => ({ value: b.code, label: `${b.label} (${b.ages})${ctx.mode === 'organiser' && bandShut(form, b, ctx) ? NOT_OPEN : ''}` }));
}

/** Combats proposés. Un combat enregistré reste affiché (coach) même s'il est fermé. */
export function combatChoices(form: ClubFormLine, ctx: LineFormContext): [CombatDiscipline, string][] {
  const open = openFor(form, ctx);
  return COMBAT_LABELS.flatMap(([d, label]): [CombatDiscipline, string][] => {
    if (open(d, 'jiyu') || open(d, 'shobu')) return [[d, label]];
    return ctx.mode === 'organiser' || ctx.saved?.combats.includes(d) ? [[d, label + NOT_OPEN]] : [];
  });
}

/** Règlements proposés : un seul pour tous les combats cochés, donc fermé dès qu'il l'est pour l'un d'eux. */
export function rulesetChoices(form: ClubFormLine, ctx: LineFormContext): [Ruleset, string][] {
  if (!form.combats.length) return RULESET_LABELS;
  const open = openFor(form, ctx);
  const sameCombats = !!ctx.saved && form.combats.every((c) => ctx.saved!.combats.includes(c));
  return RULESET_LABELS.flatMap(([r, label]): [Ruleset, string][] => {
    if (form.combats.every((c) => open(c, r))) return [[r, label]];
    if (ctx.mode === 'organiser') return allowedFor(form, ctx)(form.combats[0]!, r) ? [[r, label + NOT_OPEN]] : [];
    return sameCombats && ctx.saved!.ruleset === r ? [[r, label + NOT_OPEN]] : [];
  });
}

/** Disciplines proposables au reclassement : aucune des disciplines de combat cochées. */
export function reclassChoices(form: ClubFormLine, ctx: LineFormContext): [PrefDiscipline, string][] {
  const open = openFor(form, ctx);
  return PREF_DISCIPLINES.filter((d) => !form.combats.includes(d)).flatMap((d): [PrefDiscipline, string][] => {
    const { label } = DISCIPLINES[d];
    if (open(d, 'jiyu') || open(d, 'shobu')) return [[d, label]];
    return ctx.mode === 'organiser' || form.prefs[d] ? [[d, label + NOT_OPEN]] : [];
  });
}

/** Le kata : l'organisateur le voit toujours (marqué s'il est fermé), le coach seulement ouvert ou déjà enregistré. */
export function kataChoice(form: ClubFormLine, ctx: LineFormContext): { shown: boolean; label: string } {
  const open = openFor(form, ctx)('kata', null);
  return { shown: open || ctx.mode === 'organiser' || !!ctx.saved?.kata, label: open ? 'Kata' : `Kata${NOT_OPEN}` };
}

/**
 * Coche ou décoche un combat. Plusieurs combats ne se cochent que si le réglage le permet,
 * ou s'ils étaient tous déjà enregistrés (le réglage a pu être désactivé depuis : on peut seulement réduire).
 */
export function toggleCombat(form: ClubFormLine, combat: CombatDiscipline, ctx: LineFormContext): CombatDiscipline[] {
  if (form.combats.includes(combat)) return form.combats.filter((c) => c !== combat);
  const next = [...form.combats, combat];
  return ctx.multipleCombats || (!!ctx.saved && next.every((c) => ctx.saved!.combats.includes(c))) ? next : [combat];
}

/** Applique une modification ; tranche ou sexe changé : la catégorie de poids et (pour le coach) les choix devenus fermés sont retirés. */
export function applyChange(form: ClubFormLine, patch: Partial<ClubFormLine>, ctx: LineFormContext): ClubFormLine {
  const next = { ...form, ...patch };
  if (patch.ageBandCode === undefined && patch.sex === undefined) {
    // Un règlement qui n'est plus proposé pour les combats cochés est retiré (sinon il resterait choisi, invisible).
    if (patch.combats !== undefined && next.ruleset && !rulesetChoices(next, ctx).some(([r]) => r === next.ruleset)) next.ruleset = null;
    return tidyReclass(next);
  }
  // La catégorie de poids dépend de la tranche et du sexe.
  if (!ctx.weightClasses.some((w) => w.id === next.weightClassId && w.ageBandCode === next.ageBandCode && w.sex === next.sex)) next.weightClassId = null;
  const allowed = allowedFor(next, ctx);
  next.combats = next.combats.filter((c) => allowed(c, 'jiyu') || allowed(c, 'shobu'));
  if (!next.combats.length) next.ruleset = null;
  else if (next.ruleset && !next.combats.every((c) => allowed(c, next.ruleset))) next.ruleset = null;
  if (next.kata && !allowed('kata', null)) next.kata = false;
  next.prefs = Object.fromEntries(orderedPrefs(next.prefs).filter((d) => allowed(d, 'jiyu') || allowed(d, 'shobu')).map((d, i) => [d, i + 1]));
  return tidyReclass(next);
}
