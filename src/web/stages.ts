import { posteTabs, type Poste } from './poste.js';

/** Étapes d'une compétition : les onglets rangés par moment (adresses des onglets inchangées). */
export type StageId = 'preparer' | 'jour-j' | 'apres';
export interface Stage {
  id: StageId;
  label: string;
  tabs: string[];
}

export const STAGES: Stage[] = [
  { id: 'preparer', label: 'Préparer', tabs: ['inscriptions', 'clubs', 'fiche-club', 'import-ffk', 'sessions', 'grille', 'reglages'] },
  { id: 'jour-j', label: 'Jour J', tabs: ['pesee', 'reaffectation', 'tableaux', 'combats'] },
  { id: 'apres', label: 'Après', tabs: ['podiums'] },
];

export const stageOf = (tab: string): StageId => STAGES.find((s) => s.tabs.includes(tab))?.id ?? 'preparer';

/** Étapes et onglets permis à ce poste ; une étape sans onglet permis disparaît. */
export function visibleStages(poste: Poste): Stage[] {
  const allowed = new Set(posteTabs(poste));
  return STAGES.map((s) => ({ ...s, tabs: s.tabs.filter((t) => allowed.has(t)) })).filter((s) => s.tabs.length > 0);
}

const key = (competitionId: string, stage: StageId) => `etape:${competitionId}:${stage}`;
/** Dernier onglet visité d'une étape, gardé par le navigateur (rien si le stockage est indisponible). */
export function rememberTab(competitionId: string, tab: string): void {
  try {
    localStorage.setItem(key(competitionId, stageOf(tab)), tab);
  } catch {
    /* navigateur sans stockage : l'étape rouvrira son premier onglet */
  }
}
export function lastTab(competitionId: string, stage: StageId): string | null {
  try {
    return localStorage.getItem(key(competitionId, stage));
  } catch {
    return null;
  }
}
