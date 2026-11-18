/**
 * Plans affichés (diagramme, sans `forApply`), gardés en mémoire pour les « Détails » d'une ligne : rejouer le plan sans relancer
 * la recherche. Clé : compétition, empreinte de l'état et hash du plan. Les plus anciens sortent au-delà de `MAX`.
 */
import type { PlanMove } from '../../domain/replacement/index.js';
import type { PlanResponse } from './compute.js';

const MAX = 20;
const plans = new Map<string, PlanMove[]>();
const keyOf = (competitionId: string, fingerprint: string, hash: string) => JSON.stringify([competitionId, fingerprint, hash]);

export function rememberDisplayedPlan(competitionId: string, r: PlanResponse): void {
  const key = keyOf(competitionId, r.fingerprint, r.plan.hash);
  plans.delete(key);
  plans.set(key, r.plan.moves);
  while (plans.size > MAX) plans.delete(plans.keys().next().value!);
}

export function recallDisplayedPlan(competitionId: string, fingerprint: string, hash: string): PlanMove[] | undefined {
  return plans.get(keyOf(competitionId, fingerprint, hash));
}

/** Oublie tous les plans (tests : comme après un redémarrage). */
export function forgetDisplayedPlans(): void {
  plans.clear();
}
