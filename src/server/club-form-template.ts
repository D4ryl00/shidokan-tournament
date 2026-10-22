import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLUB_FORM_COLUMNS,
  CLUB_FORM_HEADER_FIELDS,
  CLUB_FORM_RECLASS_HEADER,
  CLUB_FORM_ROWS,
  CLUB_FORM_TITLE,
  SHOBU_KEEP_LABELS,
} from '../domain/club-form.js';
import type { Competition } from '../domain/competition.js';
import { DISCIPLINES, RULESETS } from '../domain/disciplines.js';
import type { CategoryGrid } from '../domain/types.js';
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
const WIDTHS = [3.2, 2.8, 1.9, 2.8, 1.7, 2.8, 1.6, 2.0, 1.8, 1.4, 1.4, 1.4, 3.0];
const LAST = WIDTHS.length - 1;

/** Feuilles « Fiche club » (à remplir, une ligne par combattant) et « Aide ». */
export function buildClubFormTemplate(competition: Competition, grid: CategoryGrid): OdsSheet[] {
  const offered = grid.ageBands.filter((b) => b.onClubForm);
  const validations = {
    sexe: ['Féminin', 'Masculin'],
    age: offered.map((b) => b.label),
    combat: COMBAT,
    ouinon: ['Oui', 'Non'],
    reglement: ['Jiyu', 'Shobu'],
    ordre: ['1', '2'],
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
        ...(last ? [c('« Oui » : le coach accepte d’avance les reclassements de ses combattants.', { style: 'note', colSpan: 8 })] : []),
      ];
    }),
    [c('Reclassement : numérotez 1 puis 2 les autres disciplines acceptées si le combattant se retrouve seul. Shobu : « Les règles shobu » = changer de discipline plutôt que passer en jiyu ; « La discipline » = passer en jiyu plutôt que changer de discipline.', { style: 'note', colSpan: WIDTHS.length })],
    [...Array.from({ length: 9 }, () => c(null)), c(CLUB_FORM_RECLASS_HEADER, { style: 'header', colSpan: 3 }), c(null)],
    CLUB_FORM_COLUMNS.map((label) => c(label, { style: 'header' })),
  ];
  for (let i = 0; i < CLUB_FORM_ROWS; i++) {
    const input = (extra: Partial<OdsCell> = {}) => c(null, { style: 'input', ...extra });
    rows.push([
      input(), input(), input({ validation: 'sexe' }), input({ validation: 'age' }), input({ text: true }), input({ validation: 'combat' }),
      input({ validation: 'ouinon' }), input({ text: true }), input({ validation: 'reglement' }),
      input({ validation: 'ordre' }), input({ validation: 'ordre' }), input({ validation: 'ordre' }), input({ validation: 'priorite' }),
    ]);
  }

  const help: OdsCell[][] = [
    [c('Comment remplir la fiche', { bold: true })],
    [c('Une ligne par combattant. S’il fait du kata et une discipline de combat, mettez Kata « Oui » et choisissez la discipline de combat sur la même ligne.')],
    [c('Poids actuel : le poids du combattant aujourd’hui, en kg (la catégorie de poids en est déduite).')],
    [c('Grade : seulement pour le kata, pour information des arbitres.')],
    [],
    [c('Reclassement', { bold: true })],
    [c('Si le combattant se retrouve seul dans sa catégorie, il peut être proposé dans une autre discipline : numérotez 1 puis 2 celles qu’il accepte. Laissez vide s’il ne veut pas changer de discipline.')],
    [c(`Shobu : « ${SHOBU_KEEP_LABELS.ruleset} » = changer de discipline plutôt que passer en jiyu ; « ${SHOBU_KEEP_LABELS.discipline} » = passer en jiyu plutôt que changer de discipline.`)],
    [],
    [c('Règlements', { bold: true })],
    ...Object.values(RULESETS).map((r) => [c(`${r.label} : ${r.ko ? 'avec KO, adultes uniquement' : 'sans KO, mineurs et adultes'}`)]),
    [],
    [c("Catégories d'âge", { bold: true })],
    ...offered.map((b) => [c(b.label), c(b.maxAge === null ? `${b.minAge} ans et plus` : `${b.minAge} à ${b.maxAge} ans`)]),
  ];
  const logo = logoPng();
  return [
    {
      name: 'Fiche club',
      rows,
      validations,
      columnWidthsCm: WIDTHS,
      rowHeightsCm: { 0: 2.4, 1: 0.7, 2: 0.8, 3: 0.65, 4: 0.65, 5: 0.65, 6: 0.65, 7: 0.9, 8: 1.2, 9: 0.9, 10: 1.6 },
      defaultRowHeightCm: { from: 11, heightCm: 0.75 },
      ...(logo ? { image: { data: logo, widthCm: 2.2, heightCm: 2.2 } } : {}),
      print: { repeatRow: 10 },
    },
    { name: 'Aide', rows: help, columnWidthsCm: [8, 8] },
  ];
}
