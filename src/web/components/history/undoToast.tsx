import { Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { undoSet } from '../../../domain/history/cascade.js';
import type { HistoryEntryView } from '../../../domain/history/types.js';
import { api, useUndoHistory } from '../../api.js';
import { useUndoDialog } from './undo-dialog-context.js';

/** Que fait « Annuler » du message : annuler tout de suite, demander confirmation (la cascade emporte d'autres actions), ou rien (déjà annulée). */
export function toastUndoPlan(entries: HistoryEntryView[], historyId: string): 'direct' | 'dialog' | 'gone' {
  const entry = entries.find((e) => e.id === historyId);
  if (!entry || entry.status !== 'active') return 'gone';
  const set = undoSet(entries.map((e) => ({ id: e.id, seq: e.seq, active: e.status === 'active', kind: e.kind, categoryIds: e.categoryIds, afterMembers: e.afterMembers })), [historyId]);
  return set.length === 1 && set[0]!.id === historyId ? 'direct' : 'dialog';
}

/** Message de 5 secondes après une action : texte, phrases « même club » en orange, bouton « Annuler ». */
export function useUndoToast(competitionId: string): (text: string, historyId: string | null, sameClub?: string[]) => void {
  const qc = useQueryClient();
  const undo = useUndoHistory(competitionId);
  const { requestUndoDialog } = useUndoDialog();

  const onUndo = async (toastId: string, historyId: string) => {
    notifications.hide(toastId);
    try {
      const { entries } = await api<{ entries: HistoryEntryView[] }>('GET', `/api/competitions/${competitionId}/history`);
      const plan = toastUndoPlan(entries, historyId);
      if (plan === 'gone') return;
      if (plan === 'dialog') return requestUndoDialog([historyId]);
      await undo.mutateAsync({ ids: [historyId], expect: [historyId] });
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Annulation impossible.' });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === competitionId });
    }
  };

  return (text, historyId, sameClub = []) => {
    const toastId = `undo-${historyId ?? Date.now()}`;
    notifications.show({
      id: toastId,
      autoClose: 5000,
      message: (
        <Stack gap={4}>
          <Text size="sm">{text}</Text>
          {sameClub.map((s) => (
            <Text key={s} size="sm" c="orange">{s}</Text>
          ))}
          {historyId && (
            <Group>
              <Button size="compact-sm" variant="light" data-testid="undo-toast-action" onClick={() => void onUndo(toastId, historyId)}>Annuler</Button>
            </Group>
          )}
        </Stack>
      ),
    });
  };
}
