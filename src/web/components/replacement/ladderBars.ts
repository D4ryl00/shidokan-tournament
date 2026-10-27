import type { LadderRow } from '../../../domain/replacement/plan.js';
import type { CostBand } from '../../../domain/replacement/rules.js';
import type { RuleId } from '../../../domain/settings.js';

/** Combattants casés grâce à des règles d'un même groupe de coût. */
export interface BarSegment {
  band: CostBand;
  count: number;
}

/** Barre d'une règle : les casés (par couleur, de gauche à droite), puis ceux qui restent seuls ; `total` est l'échelle. */
export interface LadderBar {
  placed: BarSegment[];
  alone: number;
  total: number;
}

/**
 * Barres « casés · restent seuls » des règles après la ligne de départ (`start` seuls). Chaque ligne calculée apporte les
 * combattants qu'elle case de plus que la ligne calculée au-dessus, dans sa couleur ; une ligne désactivée ou pas encore
 * calculée (`alone: null`) n'a pas de barre et ne coupe pas la suite. Une remontée (ne devrait pas arriver) n'apporte rien.
 */
export function ladderBars(start: number, rows: { rule: RuleId; alone: number | null; band: CostBand }[]): Map<RuleId, LadderBar> {
  const out = new Map<RuleId, LadderBar>();
  let placed: BarSegment[] = [];
  let previous = start;
  for (const { rule, alone, band } of rows) {
    if (alone === null) continue;
    const gained = Math.max(0, previous - alone);
    const last = placed[placed.length - 1];
    if (gained > 0) placed = last?.band === band ? [...placed.slice(0, -1), { band, count: last.count + gained }] : [...placed, { band, count: gained }];
    const sum = placed.reduce((n, s) => n + s.count, 0);
    out.set(rule, { placed, alone, total: Math.max(start, sum + alone) });
    previous = alone;
  }
  return out;
}

/**
 * Barres du diagramme à partir des lignes calculées, dans **leur** ordre (celui du calcul) : après un rangement pas encore
 * recalculé (ou annulé), la liste affichée a un autre ordre, et additionner ses lignes dans cet ordre donnerait des barres fausses.
 * `start` : seuls de la ligne de départ (`return`), `null` tant qu'elle n'est pas calculée. Aucun seul au départ : aucune barre.
 */
export function rowBars(rows: LadderRow[], bandOf: (rule: RuleId) => CostBand): { start: number | null; bars: Map<RuleId, LadderBar> } {
  const start = rows.find((r) => r.rule === 'return')?.alone ?? null;
  if (start === null || start === 0) return { start, bars: new Map() };
  const after = rows.filter((r): r is LadderRow & { rule: RuleId } => r.rule !== null && r.rule !== 'return');
  return { start, bars: ladderBars(start, after.map((r) => ({ rule: r.rule, alone: r.on ? r.alone : null, band: bandOf(r.rule) }))) };
}
