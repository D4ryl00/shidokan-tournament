import { AsyncLocalStorage } from 'node:async_hooks';
import type { JournalActor, JournalVia } from '../../domain/journal/types.js';

/** Qui fait quoi, et comment, pour la requête (ou la tâche) en cours : lu à l'écriture de chaque entrée du journal. */
export interface JournalContext {
  actor: JournalActor;
  via: JournalVia;
  competitionId: string | null;
  /** Entrée « groupe » ouverte : les entrées écrites ensuite en sont des lignes de détail. */
  parentId: string | null;
  /** Nombre d'entrées écrites pendant la requête. */
  written: number;
  /**
   * La requête a noté elle-même ce qu'elle a fait, même sans rien écrire (enregistrer sans rien changer) : le filet de sécurité
   * n'écrit pas d'entrée brute pour elle.
   */
  handled: boolean;
}

export const journalStore = new AsyncLocalStorage<JournalContext>();

export const currentJournal = (): JournalContext | undefined => journalStore.getStore();

export function setJournalVia(via: JournalVia): void {
  const ctx = currentJournal();
  if (ctx) ctx.via = via;
}

/** Marque la requête en cours comme notée (voir `JournalContext.handled`). */
export function markJournalHandled(): void {
  const ctx = currentJournal();
  if (ctx) ctx.handled = true;
}

export function setJournalActor(actor: JournalActor, competitionId?: string): void {
  const ctx = currentJournal();
  if (!ctx) return;
  ctx.actor = actor;
  if (competitionId !== undefined) ctx.competitionId = competitionId;
}

/** Exécute `fn` dans un contexte de journal, hors requête : tests, ligne de commande, tâches. */
export function runJournal<T>(ctx: Partial<JournalContext>, fn: () => T): T {
  return journalStore.run({ actor: { kind: 'app' }, via: 'autre', competitionId: null, parentId: null, written: 0, handled: false, ...ctx }, fn);
}
