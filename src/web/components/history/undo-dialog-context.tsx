import { createContext, useContext } from 'react';

/** Ouvre la confirmation d'annulation d'un lot (fournie par le panneau d'historique) ; sans fournisseur, ne fait rien. */
export interface UndoDialogApi {
  requestUndoDialog(targets: string[]): void;
}
export const UndoDialogContext = createContext<UndoDialogApi>({ requestUndoDialog: () => {} });
export const useUndoDialog = () => useContext(UndoDialogContext);
