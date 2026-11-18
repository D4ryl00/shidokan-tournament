import type { Presence } from '../../../domain/replacement/types.js';
import { SOURCE_LABELS, type RegistrationRow } from '../../../domain/registration.js';
import type { CategoryGrid } from '../../../domain/types.js';
import type { RecasementEntry } from '../../api.js';
import { ageBandLabel, disciplineLabel, kgLabel, rulesetShort, weightLabel } from '../../labels.js';

export interface SheetContext {
  grid: CategoryGrid;
  /** null : pas encore chargée. */
  presence: Presence | null;
  /** Autres inscriptions du même combattant : libellé de catégorie et nom de session. */
  others: { label: string; session: string | null }[];
  recasement: RecasementEntry | undefined;
}

const orDash = (v: string | null | undefined) => (v && v.trim() ? v : '—');

/** Lignes « libellé · valeur » de la fiche d'un combattant (jamais de donnée de contact du club). */
export function sheetLines(row: RegistrationRow, ctx: SheetContext): { label: string; value: string }[] {
  const f = row.fighter;
  const lines: { label: string; value: string }[] = [];
  const add = (label: string, value: string) => lines.push({ label, value });

  add('Sexe · âge', `${f.sex === 'M' ? 'Homme' : 'Femme'} · ${ageBandLabel(ctx.grid, f.ageBandCode)}`);
  add('Licence', orDash(f.licence));
  add('Grade', orDash(f.grade));

  let presence = ctx.presence === null ? '—' : ctx.presence === 'present' ? 'présent' : ctx.presence === 'absent' ? 'absent' : 'non pointé';
  if (presence !== '—') {
    if (row.weighInKg !== null) presence += ` · pesé ${kgLabel(row.weighInKg)}`;
    if (row.approxWeightKg !== null) presence += row.weighInKg !== null ? ` (déclaré ≈ ${kgLabel(row.approxWeightKg)})` : ` · déclaré ≈ ${kgLabel(row.approxWeightKg)}`;
  }
  add('Présence', presence);

  const weight = row.weightClassId ? weightLabel(ctx.grid, row.weightClassId) : null;
  add('Discipline', [disciplineLabel(row.discipline), row.ruleset ? rulesetShort(row.ruleset) : null, weight ? `${weight} kg` : null].filter(Boolean).join(' · '));

  let also = row.otherDisciplines.length ? row.otherDisciplines.map(disciplineLabel).join(', puis ') : '';
  if (row.ruleset === 'shobu' && row.acceptsJiyuFirst) also = `${also ? `${also} · ` : ''}accepte le jiyu en priorité`;
  add('Accepte aussi', orDash(also));

  add('Origine', SOURCE_LABELS[row.source] + (row.ffkConfirmed ? ' · confirmé FFK ✓' : ''));
  if (ctx.recasement) add('Réaffecté', `venu de ${ctx.recasement.fromLabel} (validé)`);
  add('Autres inscriptions', ctx.others.length ? ctx.others.map((o) => (o.session ? `${o.label} (session ${o.session})` : o.label)).join(' ; ') : 'aucune');
  if (row.withdrawn) add('Ne combat pas', 'oui');
  return lines;
}
