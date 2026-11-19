import { Paper, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState, type ReactNode } from 'react';
import { newSameClubSentences } from '../../../domain/brackets/same-club.js';
import type { Category } from '../../../domain/categories.js';
import type { Wave } from '../../../domain/waves.js';
import { useSwap } from '../../api.js';
import type { EntrantInfo } from '../BracketView.js';
import { useUndoToast } from '../history/undoToast.js';
import { DropConfirmDialog, type PendingDrop } from './DropConfirmDialog.js';
import { isLockedCategory, LOCKED_DROP, UNDER_PLANCHE_BAR } from './model.js';
import { useDragMove, type DragAttrs, type PlancheAction } from './useDragMove.js';

/** Une pastille est à la fois source (glisser, clic) et cible (dépôt). */
const both = (a: DragAttrs, b: DragAttrs): DragAttrs => ({ ...a, ...b, onClick: a.onClick ?? b.onClick, style: { ...a.style, ...b.style } });

/**
 * Glisser-déposer et clic-clic, partagés par la planche et la galaxie : échange de places tout de suite,
 * échange et déplacement après confirmation, refus des catégories lancées. `dialog` est à rendre une fois.
 */
export function usePlancheDrop(o: { competitionId: string; categories: Category[]; entrants: Map<string, EntrantInfo>; waves: Wave[]; readOnly: boolean }): {
  drag: ReturnType<typeof useDragMove>;
  chipProps: (registrationId: string, c: Category) => DragAttrs;
  cardProps: (c: Category) => DragAttrs;
  dialog: ReactNode;
  /** Bandeau du clic-clic (« Sélection : … »), affiché tant qu'une pastille est choisie ; à rendre une fois. */
  banner: ReactNode;
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
  const banner = drag.selected && (
    <Paper data-testid="planche-banner" role="status" px="sm" py={6} radius="sm"
      style={{ position: 'fixed', top: UNDER_PLANCHE_BAR, left: '50%', transform: 'translateX(-50%)', width: 'min(900px, calc(100vw - 32px))', zIndex: 90, pointerEvents: 'none', boxShadow: 'var(--mantine-shadow-md)', backgroundColor: 'var(--sk-chip)', color: 'var(--sk-chip-text)', border: '1px solid var(--sk-accent)' }}>
      <Text size="sm" fw={500}>Sélection : {nameOf(drag.selected)}. Cliquez sur un autre combattant pour échanger, ou sur une catégorie pour l’y déplacer. (Échap pour annuler)</Text>
    </Paper>
  );
  return { drag, chipProps, cardProps, dialog, banner, nameOf };
}
