import { useEffect, useRef, useState, type DragEvent, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import { dropKind, type DropAction } from './model.js';

export type PlancheAction = DropAction & { source: string; target?: string };
interface Chip { registrationId: string; categoryId: string; locked: boolean }
interface Target { registrationId?: string; categoryId: string; locked: boolean }
type Over = Target & { kind: DropAction['kind'] };
/** Attributs d'une pastille ou d'une carte ; `data-drop` : cible surlignée pendant le glisser (`ok`), ou refusée (`no`). */
export type DragAttrs = HTMLAttributes<HTMLDivElement> & { 'data-drop'?: 'ok' | 'no'; 'data-dragging'?: true };

const sameTarget = (a: Target, b: { registrationId?: string; categoryId: string }) => a.categoryId === b.categoryId && a.registrationId === b.registrationId;

/**
 * Glisser-déposer (API HTML) et clic-clic de la planche : une pastille glissée ou choisie, puis une pastille ou une carte cible.
 * L'effet (échange de places, échange, déplacement, refus) est décidé par `dropKind` et confié à `onAction`.
 * Poste en lecture seule : aucun attribut, rien ne bouge.
 */
export function useDragMove(o: { readOnly: boolean; onAction: (a: PlancheAction) => void }): {
  selected: string | null;
  dragProps(chip: Chip): DragAttrs;
  dropProps(target: Target): DragAttrs;
  cancel(): void;
} {
  const [selected, setSelected] = useState<Chip | null>(null);
  const [dragging, setDragging] = useState<Chip | null>(null);
  const [over, setOverState] = useState<Over | null>(null);
  // Dernière cible survolée, à jour entre deux rendus (les `dragover` se suivent de près).
  const overRef = useRef<Over | null>(null);
  const setOver = (x: Over | null | ((x: Over | null) => Over | null)) => {
    overRef.current = typeof x === 'function' ? x(overRef.current) : x;
    setOverState(overRef.current);
  };

  // Échap annule le choix.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const act = (src: Chip, target: Target) => o.onAction({ ...dropKind(src, target), source: src.registrationId, target: target.registrationId });
  const cancel = () => setSelected(null);

  if (o.readOnly) return { selected: null, dragProps: () => ({}), dropProps: () => ({}), cancel };

  /** Clic sur une pastille : la choisir, la relâcher (re-clic), ou la prendre pour cible de celle déjà choisie. */
  const clickChip = (chip: Chip) => {
    if (!selected) {
      if (chip.locked) o.onAction({ kind: 'locked', source: chip.registrationId });
      else setSelected(chip);
      return;
    }
    if (selected.registrationId === chip.registrationId) return setSelected(null);
    setSelected(null);
    act(selected, chip);
  };

  const dragProps = (chip: Chip): DragAttrs => ({
    role: 'button',
    tabIndex: 0,
    'aria-pressed': selected?.registrationId === chip.registrationId,
    draggable: !chip.locked,
    'data-dragging': dragging?.registrationId === chip.registrationId || undefined,
    style: dragging?.registrationId === chip.registrationId ? { opacity: 0.4 } : undefined,
    onClick: (e: MouseEvent) => { e.stopPropagation(); clickChip(chip); },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation(); clickChip(chip);
    },
    onDragStart: (e: DragEvent) => {
      if (chip.locked) { e.preventDefault(); return; }
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', chip.registrationId);
      setSelected(null);
      setDragging(chip);
    },
    onDragEnd: () => { setDragging(null); setOver(null); },
  });

  const dropProps = (target: Target): DragAttrs => {
    const chipTarget = target.registrationId !== undefined;
    const here = over !== null && (chipTarget ? sameTarget(over, target) : over.categoryId === target.categoryId);
    const drop = !here ? undefined
      : over.kind === 'locked' ? 'no'
        : chipTarget ? (over.kind === 'swap' || over.kind === 'exchange' ? 'ok' : undefined)
          : over.kind === 'move' && over.registrationId === undefined ? 'ok' : undefined;
    return {
      'data-drop': drop,
      style: drop === 'ok' ? (chipTarget ? { outline: '2px dashed var(--sk-accent)', backgroundColor: 'var(--sk-chip)' } : { borderColor: 'var(--sk-accent)', boxShadow: '0 0 0 3px var(--sk-chip)' })
        : !chipTarget && selected ? { cursor: 'pointer' } : undefined,
      onDragOver: (e: DragEvent) => {
        if (!dragging) return;
        e.stopPropagation();
        const kind = dropKind(dragging, target).kind;
        if (kind === 'none') {
          e.dataTransfer.dropEffect = 'none';
          if (overRef.current) setOver(null);
          return;
        }
        const cur = overRef.current;
        if (!cur || !sameTarget(cur, target) || cur.kind !== kind) setOver({ ...target, kind });
        // Catégorie verrouillée : la carte le montre, et le dépôt est reçu pour dire pourquoi rien ne bouge.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      },
      onDragLeave: (e: DragEvent) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setOver((x) => (x && sameTarget(x, target) ? null : x));
      },
      onDrop: (e: DragEvent) => {
        if (!dragging) return;
        e.preventDefault(); e.stopPropagation();
        const src = dragging;
        setDragging(null); setOver(null);
        act(src, target);
      },
      // Clic-clic : une carte (hors pastilles et boutons) reçoit la pastille choisie.
      onClick: chipTarget ? undefined : (e: MouseEvent) => {
        if (!selected || (e.target instanceof Element && e.target.closest('button, a, input, [role="button"]'))) return;
        const src = selected;
        setSelected(null);
        act(src, target);
      },
    };
  };

  return { selected: selected?.registrationId ?? null, dragProps, dropProps, cancel };
}
