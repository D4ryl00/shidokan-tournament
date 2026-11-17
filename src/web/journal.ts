import { normalizeName } from '../domain/names.js';
import { JOURNAL_TYPES, type JournalEntryView, type JournalType } from '../domain/journal/types.js';

/** « Samedi 22 novembre » : jour local d'une entrée. */
const dayLabel = (iso: string): string => {
  const s = new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Entrées regroupées par jour local, dans l'ordre reçu (le plus récent d'abord). */
export function groupByDay(entries: JournalEntryView[]): { day: string; entries: JournalEntryView[] }[] {
  const groups: { key: string; day: string; entries: JournalEntryView[] }[] = [];
  for (const e of entries) {
    const key = dayKey(e.at);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.entries.push(e);
    else groups.push({ key, day: dayLabel(e.at), entries: [e] });
  }
  return groups.map(({ day, entries: list }) => ({ day, entries: list }));
}

/** « 09:05 » : heure locale d'une date. */
export const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « saisi 15:12 sur le portable, reçu 15:14 » pour une saisie faite sur un portable de zone ; null sinon. */
export const receivedNote = (e: Pick<JournalEntryView, 'at' | 'clientAt'>): string | null =>
  e.clientAt ? `saisi ${hhmm(e.clientAt)} sur le portable, reçu ${hhmm(e.at)}` : null;

/** Un caractère tel que la recherche le voit (sans accent ni casse, ponctuation en espace) : comme `normalizeName`, sans réduire les espaces. */
const normChar = (c: string): string =>
  c.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[’'`\-‐–—_.]/g, ' ').toUpperCase();

/**
 * Texte découpé en morceaux surlignés (`hit`) là où un mot de la recherche apparaît, sans accents ni casse ; recollés, les morceaux
 * redonnent le texte d'origine.
 */
export function highlight(text: string, q: string): { text: string; hit: boolean }[] {
  const words = normalizeName(q).split(' ').filter(Boolean);
  if (!text) return [];
  if (!words.length) return [{ text, hit: false }];
  // Texte normalisé, et pour chacun de ses caractères l'indice du caractère d'origine.
  let norm = '';
  const origin: number[] = [];
  const chars = Array.from(text);
  for (const [i, c] of chars.entries()) {
    const n = normChar(c);
    norm += n;
    for (let k = 0; k < n.length; k++) origin.push(i);
  }
  const hit = new Array<boolean>(chars.length).fill(false);
  for (const w of words) {
    for (let at = norm.indexOf(w); at !== -1; at = norm.indexOf(w, at + 1)) {
      for (let i = origin[at]!; i <= origin[at + w.length - 1]!; i++) hit[i] = true;
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (const [i, c] of chars.entries()) {
    const last = parts[parts.length - 1];
    if (last && last.hit === hit[i]) last.text += c;
    else parts.push({ text: c, hit: hit[i]! });
  }
  return parts;
}

/** Pastille de type cochée ou décochée ; les types restent dans l'ordre du filtre. */
export const toggleType = (selected: JournalType[], t: JournalType): JournalType[] => {
  const next = new Set(selected);
  if (next.has(t)) next.delete(t);
  else next.add(t);
  return JOURNAL_TYPES.filter((x) => next.has(x));
};
