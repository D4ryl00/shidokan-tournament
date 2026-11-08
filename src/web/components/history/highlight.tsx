import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useHistory } from '../../api.js';
import { lotOf } from './lot.js';

/** Ce que l'annulation en préparation emporte : l'action choisie (`main`), celles de sa cascade (`also`) et les catégories touchées. */
export interface UndoHighlight {
  main: Set<string>;
  also: Set<string>;
  categories: Set<string>;
  /** Survol ou focus d'un « Annuler… » ; sans effet tant qu'une fenêtre d'annulation est ouverte. */
  show(targets: string[]): void;
  clear(): void;
  /** Fenêtre ouverte : la mise en évidence reste. `alsoOnly` : tout le lot est « annulé aussi » (ex. « Repartir de zéro »). */
  pin(targets: string[], alsoOnly?: boolean): void;
  unpin(): void;
}

const EMPTY = new Set<string>();
const NONE: UndoHighlight = { main: EMPTY, also: EMPTY, categories: EMPTY, show: () => {}, clear: () => {}, pin: () => {}, unpin: () => {} };
const Ctx = createContext<UndoHighlight>(NONE);
export const useUndoHighlight = () => useContext(Ctx);

type Pick = { targets: string[]; alsoOnly: boolean };

export function UndoHighlightProvider({ competitionId, children }: { competitionId: string; children: ReactNode }) {
  const [hover, setHover] = useState<string[]>([]);
  const [pinned, setPinned] = useState<Pick | null>(null);
  // Chargé seulement pendant qu'une annulation se prépare (survol, fenêtre ouverte) : les pages sans historique (Zone, Pesée…)
  // ne le chargent pas, ni à chaque changement.
  const { data } = useHistory(competitionId, null, (pinned?.targets.length ?? hover.length) > 0);
  const show = useCallback((t: string[]) => setHover(t), []);
  const clear = useCallback(() => setHover([]), []);
  const pin = useCallback((targets: string[], alsoOnly = false) => setPinned({ targets, alsoOnly }), []);
  const unpin = useCallback(() => { setPinned(null); setHover([]); }, []);
  const value = useMemo<UndoHighlight>(() => {
    const pick: Pick = pinned ?? { targets: hover, alsoOnly: false };
    const lot = data && pick.targets.length ? lotOf(data.entries, pick.targets) : [];
    const asked = new Set(pick.targets);
    return {
      main: new Set(pick.alsoOnly ? [] : lot.filter((e) => asked.has(e.id)).map((e) => e.id)),
      also: new Set(lot.filter((e) => pick.alsoOnly || !asked.has(e.id)).map((e) => e.id)),
      categories: new Set(lot.flatMap((e) => e.categoryIds)),
      show: pinned ? () => {} : show,
      clear: pinned ? () => {} : clear,
      pin,
      unpin,
    };
  }, [data, hover, pinned, show, clear, pin, unpin]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
