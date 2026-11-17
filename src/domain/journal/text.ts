import { normalizeName } from '../names.js';
import { actorLabel, JOURNAL_VIA_LABELS, type JournalChange, type JournalEntryView } from './types.js';

/** Titre, détail et changements d'une entrée, à partir de ses seules données recopiées. */
export function journalText(e: Pick<JournalEntryView, 'action' | 'data'>): { title: string; detail: string | null; changes: JournalChange[] } {
  const d = e.data;
  const subject = d.subject ?? '';
  const changes = d.changes ?? [];
  let detail: string | null = d.detail ?? null;
  let title: string;
  switch (e.action) {
    case 'competition-created':
      title = 'Compétition créée';
      break;
    case 'journal-opened':
      title = 'Journal ouvert';
      detail = d.detail ?? 'Ce qui a été fait avant n’y figure pas.';
      break;
    case 'weigh-in-closed':
      title = subject ? `Pesée close · ${subject}` : 'Pesée close';
      break;
    case 'fighter-added':
      title = `${subject} · ajouté`;
      break;
    case 'fighter-removed':
      title = `${subject} · supprimé`;
      break;
    case 'fighter-changed':
      title = `${subject} · modifié`;
      break;
    case 'presence':
      title = `${subject} · présence`;
      break;
    case 'weigh-in': {
      const weight = changes.find((c) => c.label === 'Poids') ?? changes[0];
      title = `${subject} · ${weight && weight.before !== null ? 'poids corrigé' : 'poids saisi'}`;
      break;
    }
    case 'raw':
      title = `Opération non détaillée : ${[d.method, d.route].filter(Boolean).join(' ')}`;
      break;
  }
  return { title, detail, changes };
}

/** Texte de recherche : titre, détail, changements, qui et comment, sans accents ni casse. */
export function journalSearchText(e: Pick<JournalEntryView, 'action' | 'data' | 'actor' | 'via'>): string {
  const t = journalText(e);
  const parts = [t.title, t.detail ?? '', ...t.changes.flatMap((c) => [c.label, c.before ?? '', c.after ?? '']), actorLabel(e.actor), JOURNAL_VIA_LABELS[e.via]];
  return normalizeName(parts.join(' '));
}
