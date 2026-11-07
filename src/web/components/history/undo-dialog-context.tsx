import { createContext, useContext } from 'react';

/** Réglages de la fenêtre d'annulation : titre « plan », actions bloquées qui restent en place, suite à donner une fois annulé. */
export interface UndoDialogOptions {
  /** « Annuler tout le plan d’ensemble ? » au lieu de « Annuler cette action ? ». */
  plan?: boolean;
  /** Actions du lot demandé que leur blocage laisse en place (dites dans la fenêtre). */
  staying?: string[];
  onUndone?: () => void;
}

/** Ouvre la confirmation d'annulation d'un lot (fournie par le panneau d'historique) ; sans fournisseur, ne fait rien. */
export interface UndoDialogApi {
  requestUndoDialog(targets: string[], options?: UndoDialogOptions): void;
}
export const UndoDialogContext = createContext<UndoDialogApi>({ requestUndoDialog: () => {} });
export const useUndoDialog = () => useContext(UndoDialogContext);
