import { categoryLabel, type CategoryKey } from '../categories.js';
import { DISCIPLINES } from '../disciplines.js';
import type { RuleId } from '../settings.js';
import { applyAll } from './move.js';
import type { CaseKind, Proposal, State } from './types.js';
import { activeMembers, categoryWeightGap, gapThreshold } from './weights.js';

/** Pourquoi un déplacement est proposé (la ligne « Pourquoi » d'une carte ou d'une ligne du plan). */
export type MoveWhy =
  | { kind: 'weight_out'; weighInKg: number; limitLabel: string; toleranceKg: number }
  | { kind: 'alone' }
  | { kind: 'weight_gap' }
  | { kind: 'split'; forLabel: string; forCategoryLabel: string; count: number }
  | { kind: 'return' }
  | { kind: 'closed' }
  | { kind: 'manual' };

/** Ce qu'il faut pour lire une proposition d'un coup d'œil : pourquoi, d'où, où, avec qui. */
export interface MoveView {
  why: MoveWhy;
  /** Sexe du combattant qui bouge (accords des textes). */
  sex: 'F' | 'M';
  /** Catégorie de départ du (premier) combattant qui bouge. */
  from: CategoryKey | null;
  /** Catégorie d'arrivée une fois le déplacement fait (tranches et poids réunis). */
  to: CategoryKey;
  fromCount: number;
  fromRemaining: number;
  /** Actifs de la catégorie d'arrivée, hors ceux qui bougent. */
  opponents: string[];
  /** Écart de poids de la catégorie d'arrivée et son maximum ; `null` : discipline sans poids. */
  gap: { kg: number; max: number } | null;
  details: { rule: RuleId; detail: string }[];
}

const kg = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');

/** Pastilles : le détail de chaque règle d'un déplacement (« écart 2,5 kg », « Cadets → Juniors »…). */
export function detailsOf(before: State, p: Proposal, rules: RuleId[], gap: number, threshold: number): MoveView['details'] {
  const m = before.members.find((x) => x.registrationId === p.registrationId);
  const { ageBands } = before.grid;
  const bandLabel = (code: string) => ageBands.find((b) => b.code === code)?.label ?? code;
  const bandIndex = (code: string) => ageBands.findIndex((b) => b.code === code);
  const targetKey: CategoryKey | undefined =
    'newKey' in p.target ? p.target.newKey : before.categories.find((c) => c.id === (p.target as { categoryId: string }).categoryId)?.key;
  return rules.map((rule) => {
    switch (rule) {
      case 'weight':
      case 'split':
        return { rule, detail: `écart ${kg(gap)} kg` };
      case 'weightGap':
        return { rule, detail: `${kg(gap)} kg (max ${kg(threshold)})` };
      case 'ageUp':
      case 'ageDown':
      case 'minorsAdults': {
        if (!m) return { rule, detail: '' };
        const bands = targetKey?.ageBandCodes ?? [];
        const others = bands.filter((b) => b !== m.ageBandCode);
        const to = (others.length ? others : bands).slice().sort((a, b) => bandIndex(a) - bandIndex(b));
        return { rule, detail: `${bandLabel(m.ageBandCode)} → ${to.map(bandLabel).join(' / ')}` };
      }
      case 'discipline': {
        if (!m) return { rule, detail: '' };
        const to = p.changes.discipline ?? targetKey?.discipline ?? m.discipline;
        return { rule, detail: `${DISCIPLINES[m.discipline].label} → ${DISCIPLINES[to].label}` };
      }
      default:
        return { rule, detail: '' };
    }
  });
}

/** Vue d'une proposition, appliquée à `before` (`after` : l'état après, s'il est déjà calculé). */
export function moveView(before: State, p: Proposal, after: State = applyAll(before, p)): MoveView {
  const movers = new Set([p.registrationId, ...(p.alsoMoved ?? [])]);
  const m = before.members.find((x) => x.registrationId === p.registrationId);
  const fromCat = before.categories.find((c) => c.id === m?.categoryId);
  const arrivedIn = after.members.find((x) => x.registrationId === p.registrationId)?.categoryId ?? null;
  const arrival = after.categories.find((c) => c.id === arrivedIn);
  const to = arrival?.key ?? ('newKey' in p.target ? p.target.newKey : before.categories.find((c) => c.id === (p.target as { categoryId: string }).categoryId)!.key);
  const merged = arrivedIn ? activeMembers(after, arrivedIn) : [];
  const gapKg = Math.round(categoryWeightGap(merged, after.grid) * 100) / 100;
  const max = gapThreshold(merged, after);
  return {
    why: whyOf(before, p),
    sex: m?.sex ?? 'M',
    from: fromCat?.key ?? null,
    to,
    fromCount: fromCat ? activeMembers(before, fromCat.id).length : 0,
    fromRemaining: fromCat ? activeMembers(after, fromCat.id).length : 0,
    opponents: merged.filter((x) => !movers.has(x.registrationId)).map((x) => x.label),
    gap: DISCIPLINES[to.discipline].hasWeight ? { kg: gapKg, max } : null,
    details: detailsOf(before, p, p.rules, gapKg, max),
  };
}

function whyOf(before: State, p: Proposal): MoveWhy {
  if (p.type === 'M' || p.caseId === 'manual') return { kind: 'manual' };
  const at = p.caseId.indexOf(':');
  const kind = p.caseId.slice(0, at) as CaseKind;
  const caseReg = p.caseId.slice(at + 1);
  const subject = before.members.find((x) => x.registrationId === caseReg);
  if (kind === 'alone' && caseReg !== p.registrationId && subject) {
    const cat = before.categories.find((c) => c.id === subject.categoryId);
    return { kind: 'split', forLabel: subject.label, forCategoryLabel: cat ? categoryLabel(cat.key, before.grid) : '—', count: 1 + (p.alsoMoved?.length ?? 0) };
  }
  if (kind === 'weight_out' && subject?.weighInKg !== null && subject?.weighInKg !== undefined) {
    const limit = before.grid.weightClasses.find((w) => w.id === subject.weightClassId)?.label ?? '?';
    return { kind: 'weight_out', weighInKg: subject.weighInKg, limitLabel: limit, toleranceKg: before.settings.weighInToleranceKg[subject.sex] };
  }
  if (kind === 'return' || kind === 'closed' || kind === 'weight_gap') return { kind };
  return { kind: 'alone' };
}
