import type { ClubFormLine, CombatDiscipline } from '../../../domain/club-form.js';
import { DISCIPLINES } from '../../../domain/disciplines.js';
import { normalizeName } from '../../../domain/names.js';
import { plural } from '../../../domain/plural.js';
import type { Ruleset, Sex } from '../../../domain/types.js';

/** Regroupement de la liste « Vos combattants » de la page du club. */
export type GroupMode = 'category' | 'age' | 'name';
export const GROUP_MODES: { value: GroupMode; label: string }[] = [
  { value: 'category', label: 'Catégorie' },
  { value: 'age', label: 'Âge' },
  { value: 'name', label: 'Nom (A→Z)' },
];

/** Ce que les titres disent déjà, donc que la ligne ne répète pas : la tranche d'âge, la discipline de combat (et son règlement), le kata. */
export interface Hidden { age: boolean; combat: boolean; kata: boolean }

/** Discipline et règlement (« Karaté · Jiyu »), au-dessus de ses cartes de catégorie. */
export interface LineSection { key: string; title: string; short: string; sub: string | null; size: number }

export interface LineGroup<L> {
  id: string;
  /** Par catégorie : la section (discipline et règlement) de la carte. */
  section: LineSection | null;
  /** null : liste unique, sans titre (tri par nom). */
  title: string | null;
  sub: string | null;
  /** « 3 combattants ». */
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
const RULESETS: (Ruleset | null)[] = ['jiyu', 'shobu', null];
const RULESET_TEXT: Record<Ruleset, string> = { jiyu: 'Jiyu', shobu: 'Shobu' };
const SEXES: (Sex | null)[] = ['F', 'M', null];
const NO_AGE = 'Sans tranche d’âge';
const SHOWN: Hidden = { age: false, combat: false, kata: false };
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
  const group = (id: string, section: LineSection | null, title: string | null, sub: string | null, hide: Hidden, items: L[], sort: (a: L, b: L) => number): LineGroup<L>[] =>
    items.length ? [{ id, section, title, sub, hide, count: plural(items.length, 'combattant'), lines: [...items].sort(sort) }] : [];

  // Une carte par tranche d'âge (dans l'ordre de la grille), puis celle des lignes sans tranche connue.
  const known = new Set(ctx.ageBands.map((b) => b.code));
  const byAge = (prefix: string, section: LineSection | null, hide: Hidden, items: L[]): LineGroup<L>[] => [
    ...ctx.ageBands.flatMap((b) => group(`${prefix}-${b.code}`, section, b.label, b.ages, hide, items.filter((l) => l.line.ageBandCode === b.code), byCategory)),
    ...group(`${prefix}-aucune`, section, NO_AGE, null, hide, items.filter((l) => !l.line.ageBandCode || !known.has(l.line.ageBandCode)), byCategory),
  ];

  if (ctx.mode === 'name') return group('tous', null, null, null, SHOWN, lines, (a, b) => byName(a.line, b.line));
  if (ctx.mode === 'age') return byAge('age', null, { ...SHOWN, age: true }, lines);

  // Par catégorie : chaque discipline de combat, jiyu puis shobu, puis le kata ; à l'intérieur, des plus jeunes aux plus âgés.
  const sections: { key: string; title: string; short: string; sub: string | null; hide: Hidden; items: L[] }[] = [
    ...COMBATS.flatMap((d) => RULESETS.map((r) => ({
      key: r ? `${d}-${r}` : d,
      title: r ? `${DISCIPLINES[d].label} · ${RULESET_TEXT[r]}` : DISCIPLINES[d].label,
      short: r ? `${DISCIPLINES[d].label} ${r}` : DISCIPLINES[d].label,
      sub: null,
      hide: { age: true, combat: true, kata: false },
      items: lines.filter((l) => l.line.combats.includes(d) && l.line.ruleset === r),
    }))),
    { key: 'kata', title: DISCIPLINES.kata.label, short: DISCIPLINES.kata.label, sub: 'sans catégorie de poids', hide: { age: true, combat: true, kata: true }, items: lines.filter((l) => l.line.kata) },
    { key: 'aucune', title: 'Sans discipline', short: 'Sans discipline', sub: null, hide: { ...SHOWN, age: true }, items: lines.filter((l) => !l.line.combats.length && !l.line.kata) },
  ];
  return sections.flatMap(({ hide, items, ...s }) => (items.length ? byAge(s.key, { ...s, size: items.length }, hide, items) : []));
}
