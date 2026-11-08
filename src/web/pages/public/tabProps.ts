import type { PublicCompetition } from '../../../domain/public/types.js';

/** Ce que reçoit chaque onglet de la page publique d'une compétition. */
export interface PublicTabProps {
  pub: PublicCompetition;
  /** Identifiants des combattants suivis sur ce téléphone. */
  followed: Set<string>;
}
