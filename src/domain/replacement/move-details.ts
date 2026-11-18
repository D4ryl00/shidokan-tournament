import type { Category } from '../categories.js';
import type { PlanChoice } from './plan.js';

/** Catégorie comme `GET /categories`, sans `id` si elle n'existe pas encore en base (créée par le déplacement ou un précédent). */
export type DetailsCategory = Omit<Category, 'id'> & { id?: string };

/**
 * « Détails » d'un déplacement, calculés à blanc par le serveur : la catégorie de départ juste avant lui (`null` : le combattant
 * n'en avait pas) et celle d'arrivée juste après ; `movers` : les inscriptions qui bougent (le combattant, puis celles qu'il emmène).
 */
export interface MoveDetails {
  from: DetailsCategory | null;
  to: DetailsCategory;
  movers: string[];
}

/** Corps de `POST /replacement/details/preview` : une proposition d'une carte, ou une ligne du plan affiché (rejoué jusqu'à elle). */
export type MoveDetailsBody =
  | { proposalId: string }
  | { plan: { waveId?: string; choices: PlanChoice[]; cardDecisions?: boolean; fingerprint: string; hash: string }; moveId: string };
