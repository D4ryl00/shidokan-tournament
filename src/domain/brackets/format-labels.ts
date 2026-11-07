import type { CombatFormat } from '../settings.js';
import type { BracketFormat } from './index.js';

/** Libellés des formats de combat (réglages de la compétition). */
export const FORMAT_LABELS: Record<CombatFormat, string> = {
  single_match: 'Un seul combat',
  best_of_three: 'Au meilleur des trois',
  round_robin: 'Poule (tous contre tous)',
  three_with_repechage: '3 combattants avec repêchage',
  single_elimination: 'Élimination directe',
  double_elimination: 'Double élimination',
  pools_then_bracket: 'Poules puis tableau final',
};

/** Libellés de tous les formats d'un tableau (combat, plus le kata). */
export const ALL_FORMAT_LABELS: Record<BracketFormat, string> = { ...FORMAT_LABELS, kata_two_rounds: 'Kata : tour 1 puis finale à deux' };
