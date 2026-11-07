import { undoSet } from '../../../domain/history/cascade.js';
import type { HistoryEntryView } from '../../../domain/history/types.js';

/** Lot annulé pour annuler `targets` (plus récent d'abord) : les cibles et leur cascade, d'après la liste affichée. */
export function lotOf(entries: HistoryEntryView[], targets: string[]): HistoryEntryView[] {
  return undoSet(entries.map((e) => ({ ...e, active: e.status === 'active' })), targets);
}

/** « 09:52 » : heure locale d'une date ISO. */
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
