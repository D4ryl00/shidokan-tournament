import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { CLUB_FORM_COLUMNS, CLUB_FORM_HEADER_FIELDS, CLUB_FORM_TITLE, parseClubForm } from '../../src/domain/club-form.js';
import type { Competition } from '../../src/domain/competition.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { defaultSettings } from '../../src/domain/settings.js';
import { buildClubFormTemplate } from '../../src/server/club-form-template.js';
import { UnreadableFileError, readWorkbook } from '../../src/server/spreadsheet/read.js';
import { writeOds } from '../../src/server/spreadsheet/ods.js';
import { fillClubForm } from '../helpers/club-form-fill.js';

const competition: Competition = {
  id: 'c1', name: "Coupe Shidokan – Côte d'Azur", date: '2026-11-22', location: 'Nice', tatamiCount: 2,
  settings: defaultSettings(), createdAt: '2026-10-21T00:00:00Z',
};
const grid = ffkDefaultGrid();
const template = () => writeOds(buildClubFormTemplate(competition, grid));
const flat = (cells: unknown[][]) => cells.map((r) => r.filter((c) => c !== null).join(' ')).join('\n');

describe('modèle de fiche club', () => {
  test('contenu de la feuille « Fiche club »', async () => {
    const { sheets } = readWorkbook(await template());
    const fiche = sheets.find((s) => s.name === 'Fiche club')!;
    expect(String(fiche.cells[0]![0])).toContain(CLUB_FORM_TITLE);
    expect(String(fiche.cells[1]![0])).toContain("Coupe Shidokan – Côte d'Azur");
    expect(String(fiche.cells[1]![0])).toContain('22/11/2026');
    CLUB_FORM_HEADER_FIELDS.forEach((label, i) => expect(fiche.cells[3 + i]![0]).toBe(label));
    expect(fiche.cells[10]!.slice(0, CLUB_FORM_COLUMNS.length)).toEqual([...CLUB_FORM_COLUMNS]);
  });

  test('feuille « Aide » : codes et catégories de poids', async () => {
    const { sheets } = readWorkbook(await template());
    const aide = flat(sheets.find((s) => s.name === 'Aide')!.cells);
    expect(aide).toContain('1 = Karaté');
    expect(aide).toContain('2 = Shido-boxing');
    expect(aide).toContain('3 = Shido-mix-martial');
    expect(aide).toMatch(/Cadets.*féminines.*-47 -54 -61 \+61/);
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

test('poids, préférences et téléphone en format texte dans le modèle', async () => {
  const zip = await JSZip.loadAsync(await template());
  const content = await zip.file('content.xml')!.async('string');
  expect(content).toContain('<number:text-style');
  // ligne 6 (téléphone), colonne B : cellule au format texte
  const rows = content.split('<table:table-row>');
  expect(rows[6]).toMatch(/table:style-name="txt"/);
  // 1re ligne de combattant (ligne 12) : colonnes E et H au format texte
  expect((rows[12]!.match(/table:style-name="txt"/g) ?? []).length).toBe(2);
});
