import { normalizeName } from '../names.js';
import { plural } from '../plural.js';
import { actorLabel, JOURNAL_VIA_LABELS, type JournalChange, type JournalEntryView } from './types.js';

/** Titre, détail et changements d'une entrée, à partir de ses seules données recopiées. */
export function journalText(e: Pick<JournalEntryView, 'action' | 'data'>): { title: string; detail: string | null; changes: JournalChange[] } {
  const d = e.data;
  const subject = d.subject ?? '';
  const changes = d.changes ?? [];
  let detail: string | null = d.detail ?? null;
  const f = d.sex === 'F';
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
      title = `${subject} · ${f ? 'ajoutée' : 'ajouté'}`;
      break;
    case 'fighter-removed':
      title = `${subject} · ${f ? 'supprimée' : 'supprimé'}`;
      break;
    case 'fighter-changed':
      title = `${subject} · ${f ? 'modifiée' : 'modifié'}`;
      break;
    case 'presence':
      title = `${subject} · présence`;
      break;
    case 'weigh-in': {
      const weight = changes.find((c) => c.label === 'Poids') ?? changes[0];
      title = `${subject} · ${weight && weight.before !== null ? 'poids corrigé' : 'poids saisi'}`;
      break;
    }
    case 'ffk-import':
      title = `Import FFK · ${subject}`;
      break;
    case 'weight-class-added':
      title = `Catégorie de poids créée · ${subject}`;
      break;
    case 'club-linked':
      title = `${subject} · relié à la FFK`;
      break;
    case 'ffk-unconfirmed':
      title = `${subject} · ${f ? 'gardée, absente' : 'gardé, absent'} de l’export FFK`;
      break;
    case 'raw':
      title = `Opération non détaillée : ${[d.method, d.route].filter(Boolean).join(' ')}`;
      break;
  }
  return { title, detail, changes };
}

/** Détail de l'entrée d'un import FFK : morceaux à zéro omis, combattants séparés par « , », groupes par « · ». */
export function ffkImportDetail(c: { added: number; changed: number; removed: number; unconfirmed: number; leftAside: number; weightClasses: number; clubs: number }): string {
  const fighters = [
    c.added && plural(c.added, 'ajouté'),
    c.changed && plural(c.changed, 'modifié'),
    c.removed && plural(c.removed, 'supprimé'),
  ].filter(Boolean).join(', ');
  const groups = [
    fighters,
    c.unconfirmed && `${plural(c.unconfirmed, 'gardé')} hors export`,
    c.leftAside && plural(c.leftAside, 'laissé de côté', 'laissés de côté'),
    c.weightClasses && plural(c.weightClasses, 'catégorie de poids créée', 'catégories de poids créées'),
    c.clubs && plural(c.clubs, 'club relié', 'clubs reliés'),
  ].filter(Boolean);
  return groups.length ? groups.join(' · ') : 'aucun changement';
}

/**
 * Ligne de détail d'une entrée regroupée, comme la maquette : le combattant, puis ce qui lui arrive, sans répéter le libellé
 * (« LEROY Emma (Dojo Marseille) : absente », « … : poids 52,4 kg → 53,1 kg », « … : ajouté · Kata Minimes F »).
 * Le genre est déjà dans la valeur recopiée (« absente » / « absent », écrite d'après le sexe du combattant).
 * Sans combattant : le titre de l'entrée, ses changements et son détail.
 */
export function journalDetailLine(e: Pick<JournalEntryView, 'action' | 'data'>): { lead: string; outcome: string | null; changes: JournalChange[]; detail: string | null } {
  const d = e.data;
  const changes = d.changes ?? [];
  const detail = d.detail ?? null;
  const f = d.sex === 'F';
  if (d.subject) {
    switch (e.action) {
      case 'presence': {
        const p = changes.find((c) => c.label === 'Présence');
        if (p) return { lead: d.subject, outcome: p.after ?? '—', changes: changes.filter((c) => c !== p), detail };
        break;
      }
      case 'weigh-in':
        return { lead: d.subject, outcome: null, changes: changes.map((c) => (c.label === 'Poids' ? { ...c, label: 'poids' } : c)), detail };
      case 'fighter-added':
        return { lead: d.subject, outcome: f ? 'ajoutée' : 'ajouté', changes, detail };
      case 'fighter-removed':
        return { lead: d.subject, outcome: f ? 'supprimée' : 'supprimé', changes, detail };
      case 'ffk-unconfirmed':
        return { lead: d.subject, outcome: f ? 'gardée, absente de l’export FFK' : 'gardé, absent de l’export FFK', changes, detail };
      case 'fighter-changed':
        return { lead: d.subject, outcome: null, changes, detail };
    }
  }
  const t = journalText(e);
  return { lead: t.title, outcome: null, changes: t.changes, detail: t.detail };
}

/** Texte de recherche : titre, détail, changements, qui et comment, sans accents ni casse. */
export function journalSearchText(e: Pick<JournalEntryView, 'action' | 'data' | 'actor' | 'via'>): string {
  const t = journalText(e);
  const parts = [t.title, t.detail ?? '', ...t.changes.flatMap((c) => [c.label, c.before ?? '', c.after ?? '']), actorLabel(e.actor), JOURNAL_VIA_LABELS[e.via]];
  return normalizeName(parts.join(' '));
}
