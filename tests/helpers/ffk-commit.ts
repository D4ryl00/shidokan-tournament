import type { FastifyInstance } from 'fastify';
import type { FfkCard, FfkChoices } from '../../src/domain/ffk-plan/plan.js';
import { initialValue } from '../../src/domain/ffk-plan/values.js';

/**
 * Les nouveaux combattants ne sont jamais créés d’office : comme l’organisateur qui coche « ➕ Nouveau combattant » puis
 * « Valider la carte », un choix validé (valeurs de départ de la carte) pour chaque carte `newFighter` sans choix.
 */
export function newFighterChoices(cards: Pick<FfkCard, 'key' | 'newFighter' | 'exportLine' | 'clubId' | 'weightIssue'>[], choices: FfkChoices = {}): FfkChoices {
  const added = cards
    .filter((c) => c.newFighter && !choices.cards?.[c.key])
    .map((c) => [c.key, { kind: 'validated' as const, fighterId: 'new', value: initialValue(c as FfkCard, null) }]);
  return { ...choices, cards: { ...choices.cards, ...Object.fromEntries(added) } };
}

/**
 * Import FFK comme la page le fait : aperçu (pour son empreinte), puis import avec cette empreinte. `competition` : `/api/competitions/<id>`.
 * `createNew` : les cartes des nouveaux combattants sont validées avant l’import.
 */
export async function ffkCommit(app: FastifyInstance, competition: string, up: { uploadId: string; sheets: unknown[] }, choices: FfkChoices = {}, { createNew = false } = {}) {
  const url = `${competition}/ffk-imports/${up.uploadId}`;
  let preview = await app.inject({ method: 'POST', url: `${url}/preview`, payload: { sheets: up.sheets, choices } });
  if (createNew) {
    choices = newFighterChoices(preview.json().cards, choices);
    preview = await app.inject({ method: 'POST', url: `${url}/preview`, payload: { sheets: up.sheets, choices } });
  }
  return app.inject({ method: 'POST', url: `${url}/commit`, payload: { sheets: up.sheets, choices, fingerprint: preview.json().fingerprint } });
}
