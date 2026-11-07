import { useMemo, useState, type ReactNode } from 'react';
import { UndoDialogContext, type UndoDialogApi, type UndoDialogOptions } from './undo-dialog-context.js';
import { UndoHighlightProvider } from './highlight.js';
import { UndoHistoryDialog } from './UndoHistoryDialog.js';

/**
 * Autour d'une compétition : la mise en évidence d'une annulation et la fenêtre de confirmation, ouvertes depuis le panneau
 * d'historique, le message « Annuler » ou les boutons d'annulation d'un déplacement manuel.
 */
export function HistoryProvider({ competitionId, children }: { competitionId: string; children: ReactNode }) {
  const [request, setRequest] = useState<{ targets: string[]; options: UndoDialogOptions } | null>(null);
  const api = useMemo<UndoDialogApi>(() => ({ requestUndoDialog: (targets, options = {}) => setRequest({ targets, options }) }), []);
  return (
    <UndoHighlightProvider competitionId={competitionId}>
      <UndoDialogContext.Provider value={api}>
        {children}
        {request && (
          <UndoHistoryDialog competitionId={competitionId} targets={request.targets} staying={request.options.staying}
            title={request.options.plan ? 'Annuler tout le plan d’ensemble ?' : 'Annuler cette action ?'}
            onUndone={request.options.onUndone} onClose={() => setRequest(null)} />
        )}
      </UndoDialogContext.Provider>
    </UndoHighlightProvider>
  );
}
