import type { CompetitionSettings } from '../domain/settings.js';

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function diff(loaded: unknown, edited: unknown): unknown {
  if (!isObject(loaded) || !isObject(edited)) return JSON.stringify(loaded) === JSON.stringify(edited) ? undefined : edited;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(edited)) {
    const d = diff(loaded[k], v);
    if (d !== undefined) out[k] = d;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Ce que la page des réglages a changé depuis les réglages qu'elle a chargés, feuille par feuille (une liste compte comme
 * une feuille) : le serveur fusionne, et ce qu'un autre poste a changé entre-temps (la liste des règles et ses
 * interrupteurs, réglés par la Table centrale dans Réaffectation) n'est pas écrasé. La liste des règles n'est jamais envoyée d'ici.
 */
export function settingsPatch(loaded: CompetitionSettings, edited: CompetitionSettings): Partial<CompetitionSettings> {
  const { replacementRules: _ignored, ...rest } = edited;
  return (diff(loaded, rest) ?? {}) as Partial<CompetitionSettings>;
}

/**
 * Requêtes à recharger après une modification de la compétition : les réglages changent les tableaux et l'ordre de passage, sauf
 * les cases des fiches club jointes au mail, qui ne touchent que la compétition.
 */
export function queriesAfterCompetitionPatch(id: string, patch: { settings?: unknown } & Record<string, unknown>): unknown[][] {
  const { settings, ...rest } = patch;
  const onlyAttachments = Object.keys(rest).length === 0 && isObject(settings) && Object.keys(settings).every((k) => k === 'clubFormAttachments');
  return onlyAttachments ? [['competitions']] : [['competitions'], ['categories', id], ['schedule', id]];
}
