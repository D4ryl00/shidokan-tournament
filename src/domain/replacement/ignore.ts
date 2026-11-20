import { originalCategory } from './detect.js';
import type { Case, State } from './types.js';

/** Membres actifs (non absents) d'une catégorie : [inscription, présence, poids pesé, poids déclaré], triés. */
function activeMembers(state: State, categoryId: string | null | undefined): [string, string, number | null, number | null][] {
  if (!categoryId) return [];
  return state.members
    .filter((m) => m.categoryId === categoryId && m.presence !== 'absent')
    .sort((a, b) => a.registrationId.localeCompare(b.registrationId))
    .map((m) => [m.registrationId, m.presence, m.weighInKg, m.approxWeightKg]);
}

/**
 * Empreinte de la situation d'une carte : une carte ignorée revient si elle change
 * (nouvel arrivant, pesée, absence, ou changement dans la catégorie d'origine pour un retour).
 */
export function caseFingerprint(state: State, c: Case): string {
  const origin = c.kind === 'return' ? originalCategory(state, state.members.find((m) => m.registrationId === c.registrationId)!) : undefined;
  return JSON.stringify([c.kind, c.detail, activeMembers(state, c.categoryId), ...(c.kind === 'return' ? [activeMembers(state, origin?.id)] : [])]);
}
