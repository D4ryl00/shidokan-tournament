import { useEffect, useSyncExternalStore } from 'react';

/** Saisies en cours non enregistrées (par écran), pour demander confirmation avant de les quitter. */
const dirty = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.size > 0) e.preventDefault();
}

/** Déclare une saisie en cours (`isDirty`) ; elle cesse de l'être quand l'écran disparaît. */
export function useUnsaved(key: string, isDirty: boolean): void {
  useEffect(() => {
    if (isDirty) dirty.add(key);
    else dirty.delete(key);
    if (dirty.size > 0) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
    notify();
    return () => {
      dirty.delete(key);
      if (dirty.size === 0) window.removeEventListener('beforeunload', onBeforeUnload);
      notify();
    };
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
