import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLUB_FORM_COLUMNS,
  CLUB_FORM_HEADER_FIELDS,
  CLUB_FORM_RECLASS_HEADER,
  CLUB_FORM_SECOND_COMBAT_COLUMN,
  CLUB_FORM_ROWS,
  CLUB_FORM_TITLE,
  PRE_APPROVAL_TEXT,
  SHOBU_KEEP_LABELS,
} from '../domain/club-form.js';
import type { Competition } from '../domain/competition.js';
import { DISCIPLINES, RULESETS } from '../domain/disciplines.js';
import type { CategoryGrid } from '../domain/types.js';
import { offeredAgeBands } from '../domain/closed-categories.js';
import { ageRangeText } from '../domain/grid.js';
import type { OdsCell, OdsSheet } from './spreadsheet/ods.js';

const c = (value: string | number | null, extra: Partial<OdsCell> = {}): OdsCell => ({ value, ...extra });
const frDate = (iso: string) => iso.split('-').reverse().join('/');

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * Logo Shidokan France en PNG, cherché à partir de ce fichier (indépendant du dossier courant) :
 * dans le dépôt (src/server → assets/brand) ou parmi les fichiers du site compilé (dist/server → dist/web).
 */
export function logoPng(): Buffer | null {
  const candidates = [
    ...(process.env.WEB_DIST_DIR ? [path.resolve(process.env.WEB_DIST_DIR, 'shidokan-france-logo.png')] : []),
    path.resolve(here, '../../assets/brand/shidokan-france-logo.png'),
    path.resolve(here, '../web/shidokan-france-logo.png'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  return found ? fs.readFileSync(found) : null;
}

const COMBAT = (['karate', 'shido-boxing', 'shido-mix', 'triathlon'] as const).map((d) => DISCIPLINES[d].label);
const BASE_WIDTHS = [3.2, 2.8, 1.9, 2.8, 1.7, 2.8, 1.6, 2.0, 1.8, 1.3, 1.3, 1.3, 1.6, 3.0];

/** Feuilles « Fiche club » (à remplir, une ligne par combattant) et « Aide ». */
export function buildClubFormTemplate(competition: Competition, grid: CategoryGrid, closed: ReadonlySet<string>): OdsSheet[] {
  const offered = offeredAgeBands(grid, closed);
  const multiple = competition.settings.multipleCombatDisciplinesPerDay;
  // Réglage activé : une colonne de plus tout à la fin (les index des autres colonnes ne bougent pas).
  const WIDTHS = multiple ? [...BASE_WIDTHS, 2.8] : BASE_WIDTHS;
  const LAST = WIDTHS.length - 1;
  const validations = {
    sexe: ['Féminin', 'Masculin'],
    age: offered.map((b) => b.label),
    combat: COMBAT,
    ouinon: ['Oui', 'Non'],
    reglement: ['Jiyu', 'Shobu'],
    ordre: ['1', '2', '3'],
    priorite: [SHOBU_KEEP_LABELS.ruleset, SHOBU_KEEP_LABELS.discipline],
  };
  const subtitle = [competition.name, frDate(competition.date), competition.location].filter(Boolean).join(' — ');
  const rows: OdsCell[][] = [
    [c(null, { logo: true }), c(CLUB_FORM_TITLE, { style: 'title', colSpan: LAST - 1 }), c(null, { logo: true })],
    [c(null), c(subtitle, { style: 'subtitle', colSpan: LAST - 1 }), c(null)],
    [c('À remplir puis renvoyer par e-mail. Une ligne par combattant : kata et combat sur la même ligne. Voir aussi l’onglet « Aide ».', { style: 'note', colSpan: WIDTHS.length })],
    ...CLUB_FORM_HEADER_FIELDS.map((label, i) => {
      const last = i === CLUB_FORM_HEADER_FIELDS.length - 1;
      return [
        c(label, { style: 'label' }),
        c(null, { style: 'input', colSpan: 4, ...(last ? { validation: 'ouinon' } : { text: true }) }),
        ...(last ? [c(`« Oui » : ${PRE_APPROVAL_TEXT}`, { style: 'note', colSpan: WIDTHS.length - 5 })] : []),
      ];
    }),
    [c('Reclassement : si un combattant se retrouve seul dans sa catégorie, l’organisation cherche à lui trouver un adversaire.', { style: 'noteTitle', colSpan: WIDTHS.length })],
    [c('Autre discipline : numérotez 1, 2, 3 celles qu’il accepte, jamais celle où il est déjà inscrit. Vide = il reste dans sa discipline. Exemple : inscrit en karaté, Boxing 1 et Mix 2 = d’abord le boxing, sinon le mix.', { style: 'noteText', colSpan: WIDTHS.length })],
    [c(`Shobu : si vous avez numéroté une discipline, choisissez ce qu’on lui propose d’abord : « ${SHOBU_KEEP_LABELS.ruleset} » (il reste en shobu) ou « ${SHOBU_KEEP_LABELS.discipline} » (il reste dans sa discipline).`, { style: 'noteText', colSpan: WIDTHS.length })],
    [...Array.from({ length: 9 }, () => c(null)), c(CLUB_FORM_RECLASS_HEADER, { style: 'header', colSpan: 4 }), c(null), ...(multiple ? [c(null)] : [])],
    [...CLUB_FORM_COLUMNS, ...(multiple ? [CLUB_FORM_SECOND_COMBAT_COLUMN] : [])].map((label) => c(label, { style: 'header' })),
  ];
  for (let i = 0; i < CLUB_FORM_ROWS; i++) {
    const input = (extra: Partial<OdsCell> = {}) => c(null, { style: 'input', ...extra });
    rows.push([
      input(), input(), input({ validation: 'sexe' }), input({ validation: 'age' }), input({ text: true }), input({ validation: 'combat' }),
      input({ validation: 'ouinon' }), input({ text: true }), input({ validation: 'reglement' }),
      input({ validation: 'ordre' }), input({ validation: 'ordre' }), input({ validation: 'ordre' }), input({ validation: 'ordre' }), input({ validation: 'priorite' }),
      ...(multiple ? [input({ validation: 'combat' })] : []),
    ]);
  }

  const help: OdsCell[][] = [
    [c('Comment remplir la fiche', { bold: true })],
    [c('Une ligne par combattant. S’il fait du kata et une discipline de combat, mettez Kata « Oui » et choisissez la discipline de combat sur la même ligne.')],
    ...(multiple ? [[c('Plusieurs combats : choisissez la 2e discipline de combat dans la dernière colonne. Le règlement (Jiyu ou Shobu) vaut pour tous les combats du combattant.')]] : []),
    [c('Poids actuel : le poids du combattant aujourd’hui, en kg (la catégorie de poids en est déduite).')],
    [c('Grade : seulement pour le kata, pour information des arbitres.')],
    [],
    [c('Reclassement', { bold: true })],
    [c('Si un combattant se retrouve seul dans sa catégorie, l’organisation cherche à lui trouver un adversaire. Vos réponses disent ce qu’on peut lui proposer.')],
    [c(`Pré-accord : ${PRE_APPROVAL_TEXT}`)],
    [c('Autre discipline : numérotez 1, 2, 3 celles qu’il accepte, jamais celle où il est déjà inscrit. Vide = il reste dans sa discipline.')],
    [c('Exemple : inscrit en karaté, Boxing 1 et Mix 2 = d’abord le boxing, sinon le mix.')],
    [c(`Shobu : si vous avez numéroté une discipline, choisissez ce qu’on lui propose d’abord : « ${SHOBU_KEEP_LABELS.ruleset} » (il reste en shobu) ou « ${SHOBU_KEEP_LABELS.discipline} » (il reste dans sa discipline).`)],
    [],
    [c('Règlements', { bold: true })],
    ...Object.values(RULESETS).map((r) => [c(`${r.label} : ${r.ko ? 'avec KO, adultes uniquement' : 'sans KO, mineurs et adultes'}`)]),
    [],
    [c("Catégories d'âge", { bold: true })],
    ...offered.map((b) => [c(b.label), c(ageRangeText(b))]),
  ];
  const logo = logoPng();
  return [
    {
      name: 'Fiche club',
      rows,
      validations,
      columnWidthsCm: WIDTHS,
      rowHeightsCm: { 0: 2.4, 1: 0.7, 2: 0.8, 3: 0.65, 4: 0.65, 5: 0.65, 6: 0.65, 7: 0.9, 8: 0.6, 9: 1.0, 10: 0.6, 11: 1.1, 12: 1.6 },
      defaultRowHeightCm: { from: 13, heightCm: 0.75 },
      ...(logo ? { image: { data: logo, widthCm: 2.2, heightCm: 2.2 } } : {}),
      print: { repeatRow: 12 },
    },
    { name: 'Aide', rows: help, columnWidthsCm: [8, 8] },
  ];
}
