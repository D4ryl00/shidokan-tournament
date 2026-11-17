import type { JournalChange } from './types.js';

/** Photo d'un combattant, champs indexés par leur libellé affiché. */
export interface FighterSnapshot {
  name: string;
  club: string | null;
  fields: Record<string, string | null>;
  /** Clé : libellé de l'inscription (« Karaté Jiyu », « Kata »). */
  registrations: Record<string, Record<string, string | null>>;
}

/** « DUPONT Léa (Shidokan Lyon) », ou « DUPONT Léa » sans club. */
export function subjectOf(s: FighterSnapshot): string {
  return s.club ? `${s.name} (${s.club})` : s.name;
}

const keysOf = (a: object, b: object): string[] => [...new Set([...Object.keys(a), ...Object.keys(b)])];

function diffValues(label: string, before: string | null | undefined, after: string | null | undefined, out: JournalChange[]): void {
  const b = before ?? null;
  const a = after ?? null;
  if (b !== a) out.push({ label, before: b, after: a });
}

/** Écarts entre deux photos : nom, club, champs, puis inscriptions (changées, ajoutées, retirées). */
export function diffFighter(before: FighterSnapshot, after: FighterSnapshot): JournalChange[] {
  const out: JournalChange[] = [];
  diffValues('Nom', before.name, after.name, out);
  diffValues('Club', before.club, after.club, out);
  for (const k of keysOf(before.fields, after.fields)) diffValues(k, before.fields[k], after.fields[k], out);
  for (const reg of keysOf(before.registrations, after.registrations)) {
    const b = before.registrations[reg];
    const a = after.registrations[reg];
    if (!b) out.push({ label: reg, before: null, after: 'inscrit' });
    else if (!a) out.push({ label: reg, before: 'inscrit', after: null });
    else for (const k of keysOf(b, a)) diffValues(`${reg} · ${k}`, b[k], a[k], out);
  }
  return out;
}
