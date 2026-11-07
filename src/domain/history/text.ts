import type { HistoryEntryView } from './types.js';

const before = (detail: string | undefined) => (detail ?? '').split(' ➜ ')[0]!.split(' : ').pop()!;

/** Texte d'une ligne de l'historique : ce qui a été fait, puis le détail. */
export function entryHeadline(e: HistoryEntryView): { what: string; detail: string } {
  const s = e.summary;
  const route = s.fromLabel || s.toLabel ? `${s.fromLabel ?? ''} ➜ ${s.toLabel ?? ''}` : '';
  switch (e.kind) {
    case 'places':
      return { what: e.names.join(' ↔ '), detail: `${s.detail ?? ''} : places échangées dans le tableau` };
    case 'redraw':
      return { what: 'Nouveau tirage', detail: s.detail ?? '' };
    case 'format':
      return { what: 'Format changé', detail: s.detail ?? '' };
    case 'free':
      return { what: 'Tableau libre', detail: s.detail ?? '' };
    case 'withdraw':
      return { what: e.names.join(', '), detail: `ne combat pas${s.fromLabel ? ` (${s.fromLabel})` : ''}${s.reason ? ` : ${s.reason}` : ''}` };
    case 'exchange':
      return { what: e.names.join(' ↔ '), detail: s.fromLabel || s.toLabel ? `${s.fromLabel ?? ''} ↔ ${s.toLabel ?? ''}` : '' };
    default:
      return { what: e.names.join(', '), detail: route || (s.detail ?? '') };
  }
}

const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : (names[0] ?? ''));

/** Phrase décrivant ce que produit l'annulation de l'action. */
export function undoEffect(e: HistoryEntryView): string {
  const s = e.summary;
  const who = and(e.names);
  switch (e.kind) {
    case 'plan':
    case 'reaffectation':
    case 'manual':
      return `${who} retourne en ${s.fromLabel ?? ''}.`;
    case 'exchange':
      return `${who} retournent chacun dans leur catégorie d’avant.`;
    case 'withdraw':
      return `${who} combat de nouveau en ${s.fromLabel ?? ''}.`;
    case 'places':
      return `${who} reprennent leur place d’avant.`;
    case 'redraw':
      return `${s.detail ?? ''} retrouve son tirage d’avant.`;
    case 'format':
    case 'free':
      return `${s.detail?.split(' : ')[0] ?? ''} repasse en « ${before(s.detail)} ».`;
  }
}
