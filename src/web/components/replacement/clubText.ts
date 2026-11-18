import { categoryLabel } from '../../../domain/categories.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { RULE_LABELS } from '../../../domain/replacement/rules.js';
import type { MoveView } from '../../../domain/replacement/view.js';
import { whyText } from './keyDiff.js';

/**
 * Texte à envoyer à un club pour un déplacement, une ligne par combattant déplacé :
 * « Prénom NOM - Club - De : règles (vers Vers) ». Sans règle (correction imposée), la raison du déplacement.
 */
export function clubRequestText(
  view: MoveView,
  grid: CategoryGrid,
  person: (registrationId: string) => { firstName: string; lastName: string; club: string | null },
): string {
  const from = view.from ? categoryLabel(view.from, grid) : '—';
  const to = categoryLabel(view.to, grid);
  return view.movers.map((m) => {
    const p = person(m.registrationId);
    const rules = m.details
      .filter((d) => !(view.forced && d.rule === 'return'))
      .map((d) => (d.detail ? `${RULE_LABELS[d.rule]} ${d.detail}` : RULE_LABELS[d.rule]));
    const why = rules.length > 0 ? rules.join(' ; ') : whyText(view.why, view.sex);
    return `${p.firstName} ${p.lastName} - ${p.club ?? 'sans club'} - ${from} : ${why} (vers ${to})`;
  }).join('\n');
}
