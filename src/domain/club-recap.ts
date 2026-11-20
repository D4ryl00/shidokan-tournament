import { bandLabel } from './authorizations.js';
import { keyString, naturalKey } from './categories.js';
import { DISCIPLINES } from './disciplines.js';
import type { ProposalType } from './replacement/types.js';
import type { CategoryGrid, DisciplineId, Ruleset, Sex } from './types.js';

export interface RecapRegistration {
  lastName: string; firstName: string; sex: Sex; ageBandCode: string;
  registered: { discipline: DisciplineId; ruleset: Ruleset | null; weightClassId: string | null };
  final: { kind: 'category'; label: string; keyString: string } | { kind: 'absent' } | { kind: 'withdrawn' } | { kind: 'unplaced' };
  recasementType: ProposalType | null;
}
export interface RecapLine { fighter: string; registered: string; final: string; changed: boolean; reason: string | null }

export const RECAP_REASONS: Partial<Record<ProposalType, string>> = {
  A: 'catégorie de poids voisine',
  B: 'catégorie de poids voisine',
  C: 'tranche d’âge voisine',
  D: 'mélange seniors / vétérans',
  E: 'mélange mineurs / adultes',
  F: 'mélange filles / garçons',
  G: 'passage du shobu au jiyu',
  H: 'autre discipline',
  M: 'placé par l’organisation',
};

const DISCIPLINE_ORDER = Object.keys(DISCIPLINES) as DisciplineId[];

function registeredText(r: RecapRegistration, grid: CategoryGrid): string {
  const { discipline, ruleset, weightClassId } = r.registered;
  const weight = weightClassId ? grid.weightClasses.find((w) => w.id === weightClassId)?.label : undefined;
  return [
    DISCIPLINES[discipline].label,
    ...(ruleset ? [ruleset === 'jiyu' ? 'Jiyu' : 'Shobu'] : []),
    bandLabel(grid, r.ageBandCode, r.sex),
    ...(weight ? [`${weight} kg`] : []),
  ].join(' · ');
}

const finalText = (f: RecapRegistration['final']): string =>
  f.kind === 'category' ? f.label : f.kind === 'absent' ? 'Absent (désisté)' : f.kind === 'withdrawn' ? 'Ne combat pas' : 'Pas encore placé';

/** Une ligne par inscription : ce qui était inscrit, ce que le combattant fait finalement, et pourquoi si cela diffère. */
export function recapLines(regs: RecapRegistration[], grid: CategoryGrid): RecapLine[] {
  const sorted = [...regs].sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, 'fr') ||
      a.firstName.localeCompare(b.firstName, 'fr') ||
      DISCIPLINE_ORDER.indexOf(a.registered.discipline) - DISCIPLINE_ORDER.indexOf(b.registered.discipline),
  );
  return sorted.map((r) => {
    const changed = r.final.kind !== 'category' || r.final.keyString !== keyString(naturalKey(r.registered, r));
    const moved = r.recasementType ? RECAP_REASONS[r.recasementType] : undefined;
    const reason = changed && r.final.kind === 'category' ? (moved ?? 'catégorie regroupée') : null;
    return { fighter: `${r.lastName.toLocaleUpperCase('fr')} ${r.firstName}`, registered: registeredText(r, grid), final: finalText(r.final), changed, reason };
  });
}
