import { useEffect, useSyncExternalStore } from 'react';

/** Saisies en cours non enregistrées (par écran), pour demander confirmation avant de les quitter. */
const dirty = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const waiting: (() => void)[] = [];

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.size > 0) e.preventDefault();
}

/** Marque (ou démarque) une saisie en cours ; quand il n'en reste plus, les attentes de `whenSaved` sont servies. */
export function setDirty(key: string, isDirty: boolean): void {
  if (isDirty) dirty.add(key);
  else dirty.delete(key);
  if (typeof window !== 'undefined') {
    if (dirty.size > 0) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
  }
  notify();
  if (dirty.size === 0) for (const cb of waiting.splice(0)) cb();
}

/** Appelle `cb` dès qu'aucune saisie n'est en cours (tout de suite s'il n'y en a pas) : une mise à jour ne doit rien effacer à l'écran. */
export function whenSaved(cb: () => void): void {
  if (dirty.size === 0) cb();
  else waiting.push(cb);
}

/** Déclare une saisie en cours (`isDirty`) ; elle cesse de l'être quand l'écran disparaît. */
export function useUnsaved(key: string, isDirty: boolean): void {
  useEffect(() => {
    setDirty(key, isDirty);
    return () => setDirty(key, false);
  }, [key, isDirty]);
}

/** Vrai tant qu'une saisie de la page n'est pas enregistrée. */
export function useHasUnsaved(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => dirty.size > 0,
  );
}
