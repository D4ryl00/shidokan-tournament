import { describe, expect, test } from 'vitest';
import { CLUB_FORM_COLUMNS, CLUB_FORM_COLUMNS_ROW, CLUB_FORM_SECOND_COMBAT_COLUMN } from '../../src/domain/club-form.js';
import type { Competition } from '../../src/domain/competition.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { defaultSettings } from '../../src/domain/settings.js';
import { readWorkbook } from '../../src/server/spreadsheet/read.js';
import { writeOds } from '../../src/server/spreadsheet/ods.js';
import { buildClubFormTemplate } from '../../src/server/club-form-template.js';

const competition = (multiple: boolean): Competition => ({
  id: 'c1', name: 'Coupe', date: '2026-11-22', location: null,
  settings: { ...defaultSettings(), multipleCombatDisciplinesPerDay: multiple }, visibility: 'private', createdAt: '2026-10-21T00:00:00Z',
});
const fiche = (multiple: boolean) => buildClubFormTemplate(competition(multiple), ffkDefaultGrid(), new Set())[0]!;

describe('modèle .ods et plusieurs combats', () => {
  test('template with the setting on has the extra column, validated like the first combat', () => {
    const sheet = fiche(true);
    const header = sheet.rows[CLUB_FORM_COLUMNS_ROW - 1]!.map((x) => x.value);
    expect(header).toEqual([...CLUB_FORM_COLUMNS, CLUB_FORM_SECOND_COMBAT_COLUMN]);
    const row = sheet.rows[CLUB_FORM_COLUMNS_ROW]!;
    expect(row).toHaveLength(CLUB_FORM_COLUMNS.length + 1);
    expect(row[CLUB_FORM_COLUMNS.length]!.validation).toBe('combat');
    expect(sheet.columnWidthsCm).toHaveLength(CLUB_FORM_COLUMNS.length + 1);
  });
  test('template with the setting off is unchanged', () => {
    const sheet = fiche(false);
    expect(sheet.rows[CLUB_FORM_COLUMNS_ROW - 1]!.map((x) => x.value)).toEqual([...CLUB_FORM_COLUMNS]);
    expect(sheet.rows[CLUB_FORM_COLUMNS_ROW]).toHaveLength(CLUB_FORM_COLUMNS.length);
  });
  test('le .ods écrit et relu garde la colonne en dernière position', async () => {
    const cells = readWorkbook(await writeOds(buildClubFormTemplate(competition(true), ffkDefaultGrid(), new Set()))).sheets.find((x) => x.name === 'Fiche club')!.cells;
    expect(cells[CLUB_FORM_COLUMNS_ROW - 1]![CLUB_FORM_COLUMNS.length]).toBe(CLUB_FORM_SECOND_COMBAT_COLUMN);
  });
});
