import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { CLUB_FORM_COLUMNS, CLUB_FORM_HEADER_FIELDS, CLUB_FORM_TITLE, parseClubForm } from '../../src/domain/club-form.js';
import type { Competition } from '../../src/domain/competition.js';
import { entryCells, entryKey } from '../../src/domain/closed-categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { defaultSettings } from '../../src/domain/settings.js';
import { buildClubFormTemplate } from '../../src/server/club-form-template.js';
import { UnreadableFileError, readWorkbook } from '../../src/server/spreadsheet/read.js';
import { writeOds } from '../../src/server/spreadsheet/ods.js';
import { fillClubForm } from '../helpers/club-form-fill.js';

const competition: Competition = {
  id: 'c1', name: "Coupe Shidokan – Côte d'Azur", date: '2026-11-22', location: 'Nice',
  settings: defaultSettings(), createdAt: '2026-10-21T00:00:00Z',
};
const grid = ffkDefaultGrid();
const template = () => writeOds(buildClubFormTemplate(competition, grid, new Set()));
const flat = (cells: unknown[][]) => cells.map((r) => r.filter((c) => c !== null).join(' ')).join('\n');

describe('modèle de fiche club', () => {
  test('contenu de la feuille « Fiche club »', async () => {
    const { sheets } = readWorkbook(await template());
    const fiche = sheets.find((s) => s.name === 'Fiche club')!;
    expect(String(fiche.cells[0]![1])).toContain(CLUB_FORM_TITLE);
    expect(String(fiche.cells[1]![1])).toContain("Coupe Shidokan – Côte d'Azur");
    expect(String(fiche.cells[1]![1])).toContain('22/11/2026');
    CLUB_FORM_HEADER_FIELDS.forEach((label, i) => expect(fiche.cells[3 + i]![0]).toBe(label));
    expect(fiche.cells[10]!.slice(0, CLUB_FORM_COLUMNS.length)).toEqual([...CLUB_FORM_COLUMNS]);
  });

  test('feuille « Aide » : remplissage, reclassement, âges', async () => {
    const { sheets } = readWorkbook(await template());
    const aide = flat(sheets.find((s) => s.name === 'Aide')!.cells);
    expect(aide).toContain('kata et une discipline de combat');
    expect(aide).toContain('numérotez 1 puis 2');
    expect(aide).toContain('« Les règles shobu » = changer de discipline plutôt que passer en jiyu');
    expect(aide).toContain('Cadets 14 à 15 ans');
    expect(aide).not.toContain('-47 -54 -61');
  });

  test('archive OpenDocument valide avec listes de validation', async () => {
    const buf = await template();
    expect(buf.subarray(30, 38).toString()).toBe('mimetype');
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe('application/vnd.oasis.opendocument.spreadsheet');
    const content = await zip.file('content.xml')!.async('string');
    for (const v of ['Féminin', 'Masculin', 'Cadets', 'Karaté', 'Kata', 'Jiyu', 'Shobu', 'Oui', 'Non']) {
      expect(content).toContain(v);
    }
    expect((content.match(/<table:content-validation /g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(content).toContain('table:content-validation-name=');
  });

  test('aller-retour : fiche remplie puis relue', async () => {
    const filled = fillClubForm(await template(), ['Tani Dojo', 'Jean', null, null, 'Oui'], [
      ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, null],
      ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Shido-boxing', 'Shobu', null, 'Oui', 74],
    ]);
    const { sheets } = readWorkbook(filled);
    const parse = parseClubForm(sheets[0]!.cells, grid);
    expect(parse.header.club).toBe('Tani Dojo');
    expect(parse.header.preApproval).toBe(true);
    expect(parse.rows.map((r) => r.errors)).toEqual([[], []]);
    expect(parse.rows.map((r) => r.input!.lastName)).toEqual(['MARTIN', 'DURAND']);
  });
});

describe('modèle de fiche club : présentation et nouveau contenu', () => {
  test('tranches d’âge proposées seulement', async () => {
    const closed = new Set(entryCells(grid).filter((c) => c.ageBandCode === 'mini-poussin' || c.ageBandCode === 'espoir').map(entryKey));
    const zip = await JSZip.loadAsync(await writeOds(buildClubFormTemplate(competition, grid, closed)));
    const content = await zip.file('content.xml')!.async('string');
    const ages = /of:cell-content-is-in-list\(([^)]*Cadets[^)]*)\)/.exec(content.replace(/&quot;/g, '"'))![1]!;
    expect(ages).toContain('Poussins');
    expect(ages).not.toContain('Mini-poussins');
    expect(ages).not.toContain('Espoirs');
  });

  test('logo, styles et mise en page A4 paysage', async () => {
    const zip = await JSZip.loadAsync(await template());
    expect(zip.file('Pictures/logo.png')).not.toBeNull();
    expect(await zip.file('META-INF/manifest.xml')!.async('string')).toContain('Pictures/logo.png');
    const content = await zip.file('content.xml')!.async('string');
    expect((content.match(/xlink:href="Pictures\/logo.png"/g) ?? []).length).toBe(2);
    expect(content).toContain('table:number-columns-spanned=');
    expect(content).toContain('fo:border');
    expect(content).toContain('<table:table-header-rows>');
    const styles = await zip.file('styles.xml')!.async('string');
    expect(styles).toContain('style:print-orientation="landscape"');
    expect(styles).toContain('fo:page-width="29.7cm"');
    expect(styles).toContain('style:scale-to-X="1"');
  });

  test('modèle rempli au nouveau format puis relu : kata et karaté sur une ligne', async () => {
    const filled = fillClubForm(await template(), ['Tani Dojo', 'Jean', null, null, 'Non'], [
      ['MARTIN', 'Léa', 'Féminin', 'Cadets', '53,5', 'Karaté', 'Oui', '1er kyu', 'Jiyu', null, '2', '1', null],
    ], 'new');
    const parse = parseClubForm(readWorkbook(filled).sheets[0]!.cells, grid);
    expect(parse.rows.map((r) => r.errors)).toEqual([[], []]);
    expect(parse.rows.map((r) => r.input!.discipline)).toEqual(['karate', 'kata']);
  });
});

describe('readWorkbook', () => {
  test('CSV en ; et UTF-8', () => {
    const csv = Buffer.from('Nom;Prenom\nDUPONT;Héloïse\n', 'utf8');
    expect(readWorkbook(csv).sheets[0]!.cells[1]).toEqual(['DUPONT', 'Héloïse']);
  });
  test('CSV en , et Windows-1252', () => {
    const csv = Buffer.from('Nom,Prenom\r\nDUPONT,Héloïse\r\n', 'latin1');
    expect(readWorkbook(csv).sheets[0]!.cells[1]).toEqual(['DUPONT', 'Héloïse']);
  });
  test('PNG → UnreadableFileError', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
    expect(() => readWorkbook(png)).toThrow(UnreadableFileError);
  });
  test('fichier vide → UnreadableFileError', () => {
    expect(() => readWorkbook(Buffer.alloc(0))).toThrow(UnreadableFileError);
  });
});

test('poids, grade et téléphone en format texte dans le modèle', async () => {
  const zip = await JSZip.loadAsync(await template());
  const content = await zip.file('content.xml')!.async('string');
  expect(content).toContain('<number:text-style');
  // ligne 6 (téléphone), colonne B : cellule au format texte
  const rows = content.split(/<table:table-row[ >]/);
  expect(rows[6]).toMatch(/table:style-name="ce_input_txt"/);
  // 1re ligne de combattant (ligne 12) : poids actuel (E) et grade (H) au format texte
  expect((rows[12]!.match(/table:style-name="ce_input_txt"/g) ?? []).length).toBe(2);
});

test('relecture (mineurs) : logo trouvé quel que soit le dossier courant', () => {
  const cwd = process.cwd();
  try {
    process.chdir('/');
    expect(buildClubFormTemplate(competition, grid, new Set())[0]!.image).toBeDefined();
  } finally {
    process.chdir(cwd);
  }
});

test('relecture : en-têtes de reclassement simples, sous un en-tête commun', async () => {
  const fiche = readWorkbook(await template()).sheets.find((s) => s.name === 'Fiche club')!;
  expect(fiche.cells[10]!.slice(9, 12)).toEqual(['Karaté', 'Boxing', 'Mix']);
  expect(String(fiche.cells[9]![9])).toBe('Si reclassement : autres disciplines, numéroter 1, 2');
});
