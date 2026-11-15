import { notifications } from '@mantine/notifications';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { newSameClubSentences } from '../../../domain/brackets/same-club.js';
import type { Category } from '../../../domain/categories.js';
import type { Wave } from '../../../domain/waves.js';
import { useSwap } from '../../api.js';
import type { EntrantInfo } from '../BracketView.js';
import { useUndoToast } from '../history/undoToast.js';
import { DropConfirmDialog, type PendingDrop } from './DropConfirmDialog.js';
import { isLockedCategory, LOCKED_DROP } from './model.js';
import { useDragMove, type DragAttrs, type PlancheAction } from './useDragMove.js';

/** Une pastille est à la fois source (glisser, clic) et cible (dépôt). */
const both = (a: DragAttrs, b: DragAttrs): DragAttrs => ({ ...a, ...b, onClick: a.onClick ?? b.onClick, style: { ...a.style, ...b.style } });

/**
 * Glisser-déposer et clic-clic, partagés par la planche et la galaxie : échange de places tout de suite,
 * échange et déplacement après confirmation, refus des catégories lancées. `dialog` est à rendre une fois.
 */
export function usePlancheDrop(o: { competitionId: string; categories: Category[]; entrants: Map<string, EntrantInfo>; waves: Wave[]; readOnly: boolean }): {
  drag: ReturnType<typeof useDragMove>;
  chipProps: (registrationId: string, c: Category) => HTMLAttributes<HTMLDivElement>;
  cardProps: (c: Category) => DragAttrs;
  dialog: ReactNode;
  nameOf: (rid?: string) => string;
} {
  const { competitionId, categories, entrants, waves, readOnly } = o;
  const swap = useSwap(competitionId);
  const undoToast = useUndoToast(competitionId);
  const [drop, setDrop] = useState<PendingDrop | null>(null);
  const nameOf = (rid?: string) => (rid ? entrants.get(rid)?.name : undefined) ?? '?';
  const onAction = (a: PlancheAction) => {
    if (a.kind === 'none') return;
    if (a.kind === 'locked') {
      notifications.show({ id: 'planche-locked', color: 'orange', message: LOCKED_DROP });
      return;
    }
    if (a.kind === 'swap' && a.target) {
      const before = categories.find((c) => c.id === a.from)?.bracket ?? null;
      const [x, y] = [a.source, a.target];
      swap.mutate({ cid: a.from, a: x, b: y }, {
        onSuccess: (c) => undoToast(`Places échangées : ${nameOf(x)} ↔ ${nameOf(y)}`, c.historyId ?? null, newSameClubSentences(before, c.bracket, (r) => entrants.get(r))),
        onError: (e) => notifications.show({ color: 'red', message: e.message }),
      });
      return;
    }
    if (a.kind === 'exchange' || a.kind === 'move') setDrop({ kind: a.kind, source: a.source, target: a.target, from: a.from, to: a.to });
  };
  const drag = useDragMove({ readOnly, onAction });
  const chipProps = (registrationId: string, c: Category) => {
    const t = { registrationId, categoryId: c.id, locked: isLockedCategory(c) };
    return both(drag.dragProps(t), drag.dropProps(t));
  };
  const cardProps = (c: Category) => drag.dropProps({ categoryId: c.id, locked: isLockedCategory(c) });
  const dialog = <DropConfirmDialog competitionId={competitionId} drop={drop} categories={categories} entrants={entrants} waves={waves} onClose={() => setDrop(null)} />;
  return { drag, chipProps, cardProps, dialog, nameOf };
}
