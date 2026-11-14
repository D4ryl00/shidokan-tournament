import type { ClubFormLine } from '../../../domain/club-form.js';
import { PREF_DISCIPLINES, kgText } from '../../../domain/club-form.js';
import type { ImportDiff, ImportField } from '../../../domain/club-form-plan.js';
import { DISCIPLINES } from '../../../domain/disciplines.js';
import type { FfkField } from '../../../domain/ffk-pdf-plan.js';
import type { DisciplineId } from '../../../domain/types.js';
import type { SavedThen } from '../ClubLineForm.js';
import { COMBAT_LABELS, type AgeBandInfo, type WeightClassInfo } from './lineForm.js';

/** Une étape du parcours d'import du PDF de la FFK : ce que la fenêtre du combattant affiche et fait. */
export interface FfkFormStep {
  /** « Fiche {index+1} sur {total} ». */
  progress: { index: number; total: number };
  /** Valeurs de départ du formulaire (remplace `line.line`). */
  initial: ClubFormLine;
  /** Champs marqués « FFK ». */
  marks: ('name' | 'sex' | FfkField | 'discipline')[];
  /** `savedLabel` remplace le titre « Enregistré » de la case de la fiche, pour ce champ seulement. */
  diffs: (ImportDiff & { savedLabel?: string })[];
  /** Titres des deux cases (défaut : « FFK » / « Votre fiche »). */
  labels?: { imported: string; saved: string };
  /** Encadré jaune en tête (fiche renvoyée) : un titre en gras, une ligne de texte par élément. */
  notes?: { title: string; lines: string[] };
  /** Encadré « Fiche déjà créée. … ». */
  banner: string | null;
  hints: Partial<Record<'name' | 'ageBandCode' | 'weightClassId' | 'discipline', string>>;
  /** Sous les disciplines, tant que `discipline` n'est pas cochée (« … Cochez Karaté pour changer. »). */
  switchHint?: { text: string; discipline: DisciplineId } | null;
  /** `null` : pas de bouton pour passer (fiche verrouillée : « Suivant → » suffit). */
  skipLabel: 'Ne pas l’ajouter' | 'Laisser la fiche telle quelle' | null;
  onSkip: () => void;
  onPrevious: (() => void) | null;
  /** Après « Enregistrer · suivant → » (ou Entrée). */
  onSaved: SavedThen;
}

/** Quelle case est sélectionnée : la valeur FFK, celle de la fiche, ou aucune (autre valeur tapée). */
export function ffkChoiceState(value: string | null, diff: ImportDiff): 'ffk' | 'fiche' | null {
  if (value === diff.ffk) return 'ffk';
  if (value === diff.fiche) return 'fiche';
  return null;
}

/** « A », « A et B », « A, B et C ». */
export function listFr(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** `locked` : fiche non modifiable, rien à choisir (la raison est dite à côté). */
export function ffkBanner(firstName: string, disciplines: string[], opts: { locked?: boolean } = {}): string {
  const base = `Fiche déjà créée. Une seule fiche par combattant : celle de ${firstName} est inscrite en ${listFr(disciplines)}.`;
  return opts.locked ? base : `${base} Ce que vous choisissez ici vaut pour toutes ses disciplines.`;
}

/** Une valeur ne peut être reprise que si la liste actuelle du champ la propose (sinon le formulaire afficherait un champ vide que le serveur refuse). `null` (champ vidé) est toujours permis. */
export function ffkValueAvailable(value: string | null, options: string[]): boolean {
  return value === null || options.includes(value);
}

/** Le texte d'une valeur de champ d'import (celle de `fieldValue`) tel qu'on la montre dans une case de choix ; `null` : « — ». */
export function importValueText(field: ImportField, value: string | null, ctx: { ageBands: AgeBandInfo[]; weightClasses: WeightClassInfo[] }): string {
  if (value == null) return '—';
  switch (field) {
    case 'ageBandCode': return ctx.ageBands.find((b) => b.code === value)?.label ?? value;
    case 'weightClassId': { const w = ctx.weightClasses.find((x) => x.id === value); return w ? `${w.label} kg` : value; }
    case 'weightKg': return `${kgText(Number(value))} kg`;
    case 'disciplines': return listFr(value.split(',').map((d) => DISCIPLINES[d as DisciplineId]?.label ?? d));
    case 'ruleset': return value === 'shobu' ? 'Shobu' : 'Jiyu';
    case 'prefs': return value.split(',').map((d, i) => `${i + 1} ${COMBAT_LABELS.find(([c]) => c === d)?.[1] ?? d}`).join(' · ');
    case 'shobuKeep': return value === 'ruleset' ? 'Changer de discipline' : 'Passer en jiyu';
    case 'grade': return value;
  }
}

/** Une valeur « disciplines » (encodage de `fieldValue`) à laquelle on remet les disciplines commencées, qu'on ne peut pas décocher. */
export function withStartedDisciplines(value: string | null, started: DisciplineId[]): string | null {
  const parts = new Set(value ? value.split(',') : []);
  for (const d of started) parts.add(d);
  const list = [...PREF_DISCIPLINES.filter((d) => parts.has(d)), ...(parts.has('kata') ? ['kata'] : [])];
  return list.length ? list.join(',') : null;
}

/**
 * Valeurs des deux cases d'une différence. Disciplines : les disciplines commencées y sont remises des deux côtés (le formulaire
 * les garde cochées) ; si les deux valeurs deviennent alors égales, il n'y a plus rien à choisir (`null`).
 */
export function choiceValues(diff: Pick<ImportDiff, 'field' | 'ffk' | 'fiche'>, started: DisciplineId[]): { imported: string; saved: string | null } | null {
  if (diff.field !== 'disciplines') return { imported: diff.ffk, saved: diff.fiche };
  const imported = withStartedDisciplines(diff.ffk, started)!;
  const saved = withStartedDisciplines(diff.fiche, started);
  return imported === saved ? null : { imported, saved };
}

/** Différences dont le champ n'est pas affiché en ce moment (encadré Reclassement masqué, pas en shobu, kata décoché) : montrées à part. */
export function hiddenConflicts(diffs: Pick<ImportDiff, 'field'>[], shown: { reclassShown: boolean; shobu: boolean; kata: boolean }): ImportField[] {
  const visible: Partial<Record<ImportField, boolean>> = {
    prefs: shown.reclassShown,
    shobuKeep: shown.reclassShown && shown.shobu,
    grade: shown.kata,
  };
  return diffs.map((d) => d.field).filter((f) => visible[f] === false);
}
