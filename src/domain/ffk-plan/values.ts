import type { ClubFormLine } from '../club-form.js';
import { normalizeLicence } from '../club-form.js';
import { clubFormDiffs, fieldPatch, fieldValue, type ImportField } from '../club-form-plan.js';
import { normalizeName } from '../names.js';
import type { DisciplineId, Ruleset } from '../types.js';
import type { ExistingFighter, FfkCardDraft } from './cards.js';

/** Ce qu’on enregistrera pour une carte : la fiche (ou la ligne) complète, le club, le masquage du nom. */
export interface FfkCardValue {
  line: ClubFormLine;
  clubId: string | null;
  publicNameHidden: boolean;
}
export type FfkField = ImportField | 'clubId';
/** Un écart entre l’export et la fiche enregistrée (les deux côtés non vides). */
export interface FfkCardDiff {
  field: FfkField;
  ffk: string;
  fiche: string;
}

/** Le minimum pour dire une valeur en clair dans « Ce qui change ». */
export interface ChangeLabels {
  /** Code de tranche d’âge → « Benjamins ». */
  ageBand: (code: string) => string;
  /** Identifiant de catégorie de poids → « −35 kg ». */
  weightClass: (id: string) => string;
  /** Discipline → « Karaté ». */
  discipline: (id: DisciplineId) => string;
  ruleset: (ruleset: Ruleset) => string;
  /** Identifiant de club → nom. */
  club: (id: string) => string;
}

const FIELD_LABELS: Record<FfkField, string> = {
  lastName: 'Nom', firstName: 'Prénom', sex: 'Sexe', ageBandCode: 'Catégorie d’âge', weightClassId: 'Catégorie de poids', weightKg: 'Poids actuel',
  disciplines: 'Disciplines', ruleset: 'Règlement', grade: 'Grade', prefs: 'Reclassement', shobuKeep: 'Priorité en shobu', licence: 'N° de licence', clubId: 'Club',
};

/** La ligne enregistrée, avec la licence du combattant (qui vit à côté de la ligne). */
const savedLine = (s: ExistingFighter): ClubFormLine => ({ ...s.line, licence: s.line.licence ?? s.licence });

/** Écarts nom / prénom / sexe / club, que `clubFormDiffs` ne compte pas : les deux côtés non vides et différents. */
function identityDiffs(card: FfkCardDraft, saved: ExistingFighter): { field: FfkField; ffk: string; fiche: string }[] {
  const out: { field: FfkField; ffk: string; fiche: string }[] = [];
  for (const field of ['lastName', 'firstName'] as const) {
    const ffk = fieldValue(card.exportLine, field);
    const fiche = fieldValue(saved.line, field);
    if (ffk && fiche && normalizeName(ffk) !== normalizeName(fiche)) out.push({ field, ffk, fiche });
  }
  if (card.exportLine.sex && saved.line.sex && card.exportLine.sex !== saved.line.sex) out.push({ field: 'sex', ffk: card.exportLine.sex, fiche: saved.line.sex });
  if (card.clubId && saved.clubId && card.clubId !== saved.clubId) out.push({ field: 'clubId', ffk: card.clubId, fiche: saved.clubId });
  return out;
}

/** Écarts carte / fiche. Un champ vide d’un côté n’est pas un écart : la valeur de l’autre côté le complète. */
export function ffkCardDiffs(card: FfkCardDraft, saved: ExistingFighter | null): FfkCardDiff[] {
  if (!saved) return [];
  const diffs = clubFormDiffs(card.exportLine, savedLine(saved)).flatMap((d) => (d.fiche === null ? [] : [{ field: d.field, ffk: d.ffk, fiche: d.fiche }]));
  return [...identityDiffs(card, saved), ...diffs];
}

/**
 * Valeur de départ : rien n’est pris d’office quand l’export et la fiche se contredisent (le champ démarre vide,
 * c’est à l’organisateur de choisir). Les champs vides de la fiche sont complétés par l’export.
 */
export function initialValue(card: FfkCardDraft, saved: ExistingFighter | null): FfkCardValue {
  if (!saved) {
    const line = { ...card.exportLine };
    if (line.combats.length && !line.ruleset) line.ruleset = 'jiyu';
    if (card.weightIssue) line.weightClassId = null;
    return { line, clubId: card.clubId, publicNameHidden: false };
  }
  let line = savedLine(saved);
  // Compléter ce que la fiche n’a pas.
  for (const d of clubFormDiffs(card.exportLine, line)) if (d.fiche === null) line = { ...line, ...fieldPatch(d.field, d.ffk) };
  for (const field of ['lastName', 'firstName', 'sex'] as const) {
    const ffk = fieldValue(card.exportLine, field);
    if (ffk && fieldValue(line, field) === null) line = { ...line, ...fieldPatch(field, ffk) };
  }
  // `clubFormDiffs` ne signale pas une licence qu'un côté seulement a : la licence de l'export complète la fiche.
  const ffkLicence = normalizeLicence(card.exportLine.licence);
  if (ffkLicence && !normalizeLicence(line.licence)) line = { ...line, licence: ffkLicence };
  let clubId = saved.clubId ?? card.clubId;
  // Vider ce qui se contredit.
  for (const d of ffkCardDiffs(card, saved)) {
    if (d.field === 'clubId') clubId = null;
    else line = { ...line, ...fieldPatch(d.field, null) };
  }
  if (card.weightIssue) line = { ...line, weightClassId: null };
  return { line, clubId, publicNameHidden: saved.publicNameHidden };
}

/** Ce qu’il manque pour pouvoir enregistrer la carte, dans l’ordre du formulaire. */
export function missingFields(value: FfkCardValue): string[] {
  const l = value.line;
  const combat = l.combats.length > 0;
  const out: string[] = [];
  if (!l.lastName.trim()) out.push('Nom');
  if (!l.firstName.trim()) out.push('Prénom');
  if (!l.sex) out.push('Sexe');
  if (!l.ageBandCode) out.push('Catégorie d’âge');
  if (combat && !l.weightClassId) out.push('Catégorie de poids');
  if (!combat && !l.kata) out.push('Disciplines');
  if (combat && !l.ruleset) out.push('Règlement');
  if (!value.clubId) out.push('Club');
  return out;
}

function show(field: FfkField, v: string | null, labels: ChangeLabels): string {
  if (v === null) return '—';
  switch (field) {
    case 'ageBandCode': return labels.ageBand(v);
    case 'weightClassId': return labels.weightClass(v);
    case 'weightKg': return `${v.replace('.', ',')} kg`;
    case 'disciplines': return v.split(',').map((d) => labels.discipline(d as DisciplineId)).join(', ');
    case 'ruleset': return labels.ruleset(v as Ruleset);
    case 'sex': return v === 'M' ? 'Masculin' : 'Féminin';
    case 'clubId': return labels.club(v);
    case 'shobuKeep': return v === 'ruleset' ? 'Changer de discipline' : 'Passer en jiyu';
    default: return v;
  }
}

/**
 * Ce que l’enregistrement changerait sur la fiche, une ligne « Libellé : avant → après » par champ.
 * Nouveau combattant (`saved` nul) : aucune ligne, la création est comptée à part.
 */
export function cardChanges(saved: ExistingFighter | null, value: FfkCardValue, labels: ChangeLabels): string[] {
  if (!saved) return [];
  const before = savedLine(saved);
  const fields: FfkField[] = ['lastName', 'firstName', 'sex', 'ageBandCode', 'weightClassId', 'weightKg', 'disciplines', 'ruleset', 'grade', 'prefs', 'shobuKeep', 'licence'];
  const out: string[] = [];
  const push = (field: FfkField, a: string | null, b: string | null) => {
    if (a !== b) out.push(`${FIELD_LABELS[field]} : ${show(field, a, labels)} → ${show(field, b, labels)}`);
  };
  for (const f of fields) {
    if (f === 'licence') push(f, normalizeLicence(before.licence), normalizeLicence(value.line.licence));
    else push(f, fieldValue(before, f as ImportField), fieldValue(value.line, f as ImportField));
  }
  push('clubId', saved.clubId, value.clubId);
  if (saved.publicNameHidden !== value.publicNameHidden) out.push(`Nom public : ${saved.publicNameHidden ? 'masqué' : 'visible'} → ${value.publicNameHidden ? 'masqué' : 'visible'}`);
  return out;
}
