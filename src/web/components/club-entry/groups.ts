import type { ClubFormLine, CombatDiscipline } from '../../../domain/club-form.js';
import { DISCIPLINES } from '../../../domain/disciplines.js';
import { normalizeName } from '../../../domain/names.js';
import { plural } from '../../../domain/plural.js';
import type { Sex } from '../../../domain/types.js';

/** Regroupement de la liste « Vos combattants » de la page du club. */
export type GroupMode = 'age' | 'discipline' | 'name';
export const GROUP_MODES: { value: GroupMode; label: string }[] = [
  { value: 'age', label: 'Âge' },
  { value: 'discipline', label: 'Discipline' },
  { value: 'name', label: 'Nom (A→Z)' },
];

/** Ce que le titre du groupe dit déjà, donc que la ligne ne répète pas. */
export type Hidden = 'age' | CombatDiscipline | 'kata' | null;

export interface LineGroup<L> {
  id: string;
  /** null : liste unique, sans titre (tri par nom). */
  title: string | null;
  sub: string | null;
  /** « 3 combattants », ou « 3 inscrits » par discipline (un combattant peut être dans deux groupes). */
  count: string;
  hide: Hidden;
  lines: L[];
}

interface Context {
  mode: GroupMode;
  query: string;
  ageBands: { code: string; label: string; ages: string }[];
  weightClasses: { id: string; ageBandCode: string; sex: Sex }[];
}

const COMBATS: CombatDiscipline[] = ['karate', 'shido-boxing', 'shido-mix', 'triathlon'];
const SEXES: (Sex | null)[] = ['F', 'M', null];
const byName = (a: ClubFormLine, b: ClubFormLine) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr');

export function groupClubLines<L extends { line: ClubFormLine }>(all: L[], ctx: Context): LineGroup<L>[] {
  const words = normalizeName(ctx.query).split(' ').filter(Boolean);
  const lines = all.filter((l) => {
    const hay = normalizeName(`${l.line.lastName} ${l.line.firstName}`);
    return words.every((w) => hay.includes(w));
  });
  if (lines.length === 0) return [];

  const ageRank = (code: string | null) => { const i = ctx.ageBands.findIndex((b) => b.code === code); return i < 0 ? ctx.ageBands.length : i; };
  const weightRank = (id: string | null) => { const i = ctx.weightClasses.findIndex((w) => w.id === id); return i < 0 ? ctx.weightClasses.length : i; };
  // Âge, sexe (F d'abord), catégorie de poids, puis nom : l'ordre des catégories de l'appli.
  const byCategory = (a: L, b: L) =>
    ageRank(a.line.ageBandCode) - ageRank(b.line.ageBandCode) || SEXES.indexOf(a.line.sex) - SEXES.indexOf(b.line.sex)
    || weightRank(a.line.weightClassId) - weightRank(b.line.weightClassId) || byName(a.line, b.line);

  const count = (n: number) => (ctx.mode === 'discipline' ? plural(n, 'inscrit') : plural(n, 'combattant'));
  const group = (id: string, title: string | null, sub: string | null, hide: Hidden, items: L[], sort: (a: L, b: L) => number): LineGroup<L>[] =>
    items.length ? [{ id, title, sub, hide, count: count(items.length), lines: [...items].sort(sort) }] : [];

  if (ctx.mode === 'name') return group('tous', null, null, null, lines, (a, b) => byName(a.line, b.line));
  if (ctx.mode === 'age') {
    const known = new Set(ctx.ageBands.map((b) => b.code));
    return [
      ...ctx.ageBands.flatMap((b) => group(`age-${b.code}`, b.label, b.ages, 'age', lines.filter((l) => l.line.ageBandCode === b.code), byCategory)),
      ...group('age-aucune', 'Sans tranche d’âge', null, null, lines.filter((l) => !l.line.ageBandCode || !known.has(l.line.ageBandCode)), byCategory),
    ];
  }
  return [
    ...COMBATS.flatMap((d) => group(`discipline-${d}`, DISCIPLINES[d].label, null, d, lines.filter((l) => l.line.combat === d), byCategory)),
    ...group('discipline-kata', DISCIPLINES.kata.label, 'sans catégorie de poids', 'kata', lines.filter((l) => l.line.kata), byCategory),
    ...group('discipline-aucune', 'Sans discipline', null, null, lines.filter((l) => !l.line.combat && !l.line.kata), byCategory),
  ];
}
