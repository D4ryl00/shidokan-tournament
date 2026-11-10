import type { ClubFormParse } from '../../domain/club-form.js';
import { normalizeName } from '../../domain/names.js';

/**
 * Titre de l'en-tête d'un aperçu de fiche. Fiche papier : le club choisi (le serveur le met dans `header.club`), sans ligne de coach.
 * Fichier : le club choisi ou reconnu, avec le nom du fichier quand il en diffère.
 */
export function previewHeader(header: ClubFormParse['header'], opts: { paper?: boolean; clubName?: string | null }): { title: string; showCoach: boolean } {
  if (opts.paper) return { title: `Club : ${header.club}`, showCoach: false };
  const chosen = opts.clubName || header.club;
  const same = normalizeName(chosen) === normalizeName(header.club);
  return { title: same ? `Club : ${chosen}` : `Club : ${chosen} (nom dans le fichier : ${header.club})`, showCoach: true };
}
