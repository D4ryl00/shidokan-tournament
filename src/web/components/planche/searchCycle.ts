import { useEffect, useRef, useState } from 'react';

/** Résultat suivant (`1`) ou précédent (`-1`), en boucle aux deux bouts ; 0 sans résultat. */
export function cycleIndex(current: number, delta: 1 | -1, total: number): number {
  if (total <= 0) return 0;
  const from = Math.min(Math.max(current, 0), total - 1);
  return (from + delta + total) % total;
}

/** Où en est la recherche qui passe d'un résultat à l'autre (planche, liste, galaxie). */
export interface SearchCycle {
  /** Rang du résultat courant (0 sans résultat). */
  index: number;
  total: number;
  /** Id du résultat courant. */
  current: string | null;
  step: (delta: 1 | -1) => void;
}

/**
 * Le résultat courant parmi `matches` (ids, ordre d'affichage) : le premier à chaque nouvelle recherche. À chaque demande
 * (nouvelle recherche, ↑ / ↓), `go` mène la vue au résultat courant, une seule fois (un rafraîchissement des données ne
 * fait rien bouger) ; il rend `false` tant que le résultat n'est pas affiché, et il est réessayé quand `ready` change.
 */
export function useSearchCycle(query: string, matches: string[], go: (id: string) => boolean | void, ready: unknown = null): SearchCycle {
  const [s, setS] = useState({ query, index: 0, request: 0 });
  // Nouvelle recherche : retour au premier résultat (mise à jour pendant le rendu, sans image intermédiaire).
  if (s.query !== query) setS({ query, index: 0, request: s.request + 1 });
  const total = matches.length;
  const index = total === 0 ? 0 : Math.min(s.index, total - 1);
  const current = matches[index] ?? null;
  const goTo = useRef(go);
  goTo.current = go;
  const done = useRef(0);
  useEffect(() => {
    if (!current || done.current === s.request || goTo.current(current) === false) return;
    done.current = s.request;
  }, [s.request, current, ready]);
  return {
    index, total, current,
    step: (delta) => setS((x) => (total === 0 ? x : { ...x, index: cycleIndex(x.index, delta, total), request: x.request + 1 })),
  };
}
