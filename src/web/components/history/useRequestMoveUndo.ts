import { notifications } from '@mantine/notifications';
import { useHistory } from '../../api.js';
import { useUndoDialog } from './undo-dialog-context.js';

/**
 * « Annuler son déplacement manuel » : ouvre la fenêtre d'annulation de l'action de l'historique qui l'a déplacé (la plus
 * récente encore en place, manuelle ou échange, qui le concerne), avec sa cascade.
 */
export function useRequestMoveUndo(competitionId: string): (registrationId: string, onUndone?: () => void) => void {
  const { data } = useHistory(competitionId, null);
  const { requestUndoDialog } = useUndoDialog();
  return (registrationId, onUndone) => {
    const entry = data?.entries.find((e) => e.status === 'active' && (e.kind === 'manual' || e.kind === 'exchange') && e.summary.registrationIds.includes(registrationId));
    if (!entry) {
      notifications.show({ color: 'red', message: 'Ce déplacement n’est plus dans l’historique.' });
      return;
    }
    requestUndoDialog([entry.id], { onUndone });
  };
}
