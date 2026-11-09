import type { PublicCompetition } from '../../../domain/public/types.js';
import type { PublicTimes } from '../../../domain/public/times.js';
import type { Pins } from '../../publicPins.js';

/** Ce que reçoit chaque onglet de la page publique d'une compétition. */
export interface PublicTabProps {
  pub: PublicCompetition;
  /** Heures estimées (une fois par page) ; vides pour une compétition passée. */
  times: PublicTimes;
  /** Identifiants des combattants suivis sur ce téléphone (épinglés et clubs suivis). */
  followed: Set<string>;
  /** Suivis bruts et leur mise à jour (gardés sur le téléphone). */
  pins: Pins;
  onPins: (next: Pins) => void;
}
