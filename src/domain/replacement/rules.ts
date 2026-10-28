import { z } from 'zod';
import type { CategoryGrid } from '../types.js';
import {
  OWN_SWITCH_RULES,
  RULE_IDS,
  ruleOrderSchema,
  type CompetitionSettings,
  type RuleId,
} from '../settings.js';
import type { Member } from './types.js';

export interface RulesView {
  order: RuleId[];
  on: Record<RuleId, boolean>;
  cutAfter: RuleId;
}

const onSchema = z
  .object({
    return: z.literal(true),
    weight: z.boolean(),
    split: z.boolean(),
    weightGap: z.boolean(),
    ageUp: z.boolean(),
    ageDown: z.boolean(),
    seniorsVeterans: z.boolean(),
    discipline: z.boolean(),
    shobuToJiyu: z.boolean(),
    mixSexes: z.boolean(),
    minorsAdults: z.boolean(),
  })
  .strict();

export const rulesViewSchema = z
  .object({ order: ruleOrderSchema, on: onSchema, cutAfter: z.enum(RULE_IDS) })
  .strict();

/** Règles qui ne demandent aucune validation d'un humain. */
export const NO_VALIDATION_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['return', 'weight', 'split']);
/** Règles qui exigent l'accord préalable du club. */
export const PRE_APPROVAL_RULES: ReadonlySet<RuleId> = new Set<RuleId>([
  'weightGap', 'ageUp', 'ageDown', 'seniorsVeterans', 'minorsAdults',
]);

export const RULE_LABELS: Record<RuleId, string> = {
  return: 'Retour dans la catégorie d’origine',
  weight: 'Catégorie de poids voisine',
  split: 'Split (autre catégorie)',
  weightGap: 'Écart de poids au-dessus du réglage',
  ageUp: 'Tranche d’âge au-dessus',
  ageDown: 'Tranche d’âge au-dessous',
  seniorsVeterans: 'Mélange seniors / vétérans',
  discipline: 'Autre discipline (préférences)',
  shobuToJiyu: 'Shobu → jiyu',
  mixSexes: 'Mélange filles / garçons',
  minorsAdults: 'Mélange mineurs / adultes',
};

export function isRuleOn(s: CompetitionSettings, r: RuleId): boolean {
  switch (r) {
    case 'return': return true;
    case 'minorsAdults': return s.mixMinorsAdults;
    case 'seniorsVeterans': return s.mixSeniorsVeterans;
    case 'mixSexes': return s.mixSexes.enabled;
    case 'shobuToJiyu': return s.shobuToJiyu;
    default: return !(s.replacementRules.off as readonly RuleId[]).includes(r);
  }
}

export function rulesView(s: CompetitionSettings): RulesView {
  const on = {} as Record<RuleId, boolean>;
  for (const r of RULE_IDS) on[r] = isRuleOn(s, r);
  return { order: [...s.replacementRules.order], on, cutAfter: s.replacementRules.cutAfter };
}

export function applyRulesView(s: CompetitionSettings, v: RulesView): CompetitionSettings {
  return {
    ...s,
    mixMinorsAdults: v.on.minorsAdults,
    mixSeniorsVeterans: v.on.seniorsVeterans,
    mixSexes: { ...s.mixSexes, enabled: v.on.mixSexes },
    shobuToJiyu: v.on.shobuToJiyu,
    replacementRules: {
      order: ['return', ...v.order.filter((r) => r !== 'return')],
      off: OWN_SWITCH_RULES.filter((r) => !v.on[r]),
      cutAfter: v.cutAfter,
    },
  };
}

/** Tout actif, toutes les tranches ouvertes au mélange filles / garçons (pour retrouver un déplacement déjà validé). */
export function withAllRules(s: CompetitionSettings, grid: CategoryGrid): CompetitionSettings {
  return {
    ...s,
    mixMinorsAdults: true,
    mixSeniorsVeterans: true,
    mixSexes: { enabled: true, ageBandCodes: grid.ageBands.map((b) => b.code) },
    shobuToJiyu: true,
    replacementRules: { ...s.replacementRules, off: [] },
  };
}

/** Rang d'une règle dans la liste ; un shobu qui accepte le jiyu en priorité passe `shobuToJiyu` avant `discipline`. */
export function ruleRank(
  s: CompetitionSettings,
  r: RuleId,
  m: Pick<Member, 'ruleset' | 'acceptsJiyuFirst'>,
): number {
  const { order } = s.replacementRules;
  if (m.ruleset === 'shobu' && m.acceptsJiyuFirst === true && (r === 'discipline' || r === 'shobuToJiyu')) {
    const a = order.indexOf('discipline');
    const b = order.indexOf('shobuToJiyu');
    return r === 'shobuToJiyu' ? Math.min(a, b) : Math.max(a, b);
  }
  return order.indexOf(r);
}

/** Règles actives dont l'index est au plus celui de `level` (`return` compris). */
export function allowedAt(s: CompetitionSettings, level: RuleId): Set<RuleId> {
  const { order } = s.replacementRules;
  const max = order.indexOf(level);
  const out = new Set<RuleId>();
  order.forEach((r, i) => {
    if (i <= max && isRuleOn(s, r)) out.add(r);
  });
  return out;
}

/** Numéro affiché d'une règle : « Retour » est dans la ligne de départ (pas de numéro), les autres comptent à partir de 1. */
export function ruleNumber(order: RuleId[], rule: RuleId): number | null {
  if (rule === 'return') return null;
  return order.filter((r) => r !== 'return').indexOf(rule) + 1;
}

export type CostBand = 0 | 1 | 2 | 3 | 4;
export const COST_BAND_LABELS: Record<CostBand, string> = {
  0: 'Sans validation',
  1: 'Concessions légères',
  2: 'Concessions moyennes',
  3: 'Concessions fortes',
  4: 'Concessions très fortes',
};

export function costBand(s: CompetitionSettings, rule: RuleId | null, manual: boolean): CostBand {
  if (!manual) return 0;
  const { order, cutAfter } = s.replacementRules;
  const cut = order.indexOf(cutAfter);
  const list = order.filter((r, i) => !NO_VALIDATION_RULES.has(r) && isRuleOn(s, r) && i <= cut);
  const idx = rule === null ? -1 : list.indexOf(rule);
  if (idx < 0) return 4;
  return (1 + Math.floor((idx * 4) / list.length)) as CostBand;
}
