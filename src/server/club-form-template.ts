import {
  CLUB_FORM_LEGACY_COLUMNS,
  CLUB_FORM_HEADER_FIELDS,
  CLUB_FORM_ROWS,
  CLUB_FORM_TITLE,
} from '../domain/club-form.js';
import type { Competition } from '../domain/competition.js';
import { DISCIPLINES, RULESETS } from '../domain/disciplines.js';
import { weightClassesFor } from '../domain/grid.js';
import type { CategoryGrid } from '../domain/types.js';
import type { OdsCell, OdsSheet } from './spreadsheet/ods.js';

const c = (value: string | number | null, extra: Partial<OdsCell> = {}): OdsCell => ({ value, ...extra });
const frDate = (iso: string) => iso.split('-').reverse().join('/');

/** Feuilles « Fiche club » (à remplir) et « Aide » (codes et catégories de poids). */
export function buildClubFormTemplate(competition: Competition, grid: CategoryGrid): OdsSheet[] {
  const validations = {
    sexe: ['Féminin', 'Masculin'],
    age: grid.ageBands.map((b) => b.label),
    discipline: Object.values(DISCIPLINES).map((d) => d.label),
    reglement: ['Jiyu', 'Shobu'],
    ouinon: ['Oui', 'Non'],
  };
  const subtitle = [competition.name, frDate(competition.date), competition.location].filter(Boolean).join(' — ');
  const rows: OdsCell[][] = [
    [c(CLUB_FORM_TITLE, { bold: true })],
    [c(subtitle)],
    [c("À remplir puis renvoyer par e-mail. Une ligne par inscription (kata + combat = deux lignes). Voir l'onglet « Aide ».")],
    ...CLUB_FORM_HEADER_FIELDS.map((label, i) => [
      c(label, { bold: true }),
      c(null, i === CLUB_FORM_HEADER_FIELDS.length - 1 ? { validation: 'ouinon' } : { text: true }),
    ]),
    [],
    [c("Catégorie de poids sous la forme -35 ou +65 (liste dans l'onglet « Aide »). Autres disciplines : codes par ordre de préférence, ex. 32.")],
    CLUB_FORM_LEGACY_COLUMNS.map((label) => c(label, { bold: true })),
  ];
  for (let i = 0; i < CLUB_FORM_ROWS; i++) {
    rows.push([
      c(null), c(null), c(null, { validation: 'sexe' }), c(null, { validation: 'age' }), c(null, { text: true }),
      c(null, { validation: 'discipline' }), c(null, { validation: 'reglement' }), c(null, { text: true }), c(null, { validation: 'ouinon' }), c(null),
    ]);
  }

  const help: OdsCell[][] = [
    [c('Codes des autres disciplines (par ordre de préférence)', { bold: true })],
    ...Object.values(DISCIPLINES)
      .filter((d) => d.clubFormCode !== null)
      .map((d) => [c(`${d.clubFormCode} = ${d.label}`)]),
    [c('Exemple : 32 = d’abord shido-mix-martial, puis shido-boxing. Laisser vide si le combattant ne veut pas changer de discipline.')],
    [c('Kata et triathlon : inscription possible, mais jamais en préférence.')],
    [],
    [c('Règlements', { bold: true })],
    ...Object.values(RULESETS).map((r) => [c(`${r.label} : ${r.ko ? 'avec KO, adultes uniquement' : 'sans KO, mineurs et adultes'}`)]),
    [],
    [c('Catégories de poids', { bold: true })],
  ];
  for (const band of grid.ageBands) {
    for (const [sex, label] of [['F', 'féminines'], ['M', 'masculins']] as const) {
      const classes = weightClassesFor(grid, band.code, sex);
      if (classes.length) help.push([c(`${band.label} ${label}`), c(classes.map((w) => w.label).join(' '))]);
    }
  }
  return [
    { name: 'Fiche club', rows, validations, columnWidthsCm: [5, 4, 2.5, 3.5, 3, 4, 2.5, 6, 4.5, 3.5] },
    { name: 'Aide', rows: help, columnWidthsCm: [8, 8] },
  ];
}
