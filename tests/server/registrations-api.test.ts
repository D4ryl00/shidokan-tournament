import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { readWorkbook } from '../../src/server/spreadsheet/read.js';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  const res = await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } });
  base = `/api/competitions/${res.json().id}`;
});
afterEach(async () => app.close());

const upload = (url: string, body: Buffer) =>
  app.inject({ method: 'POST', url, payload: body, headers: { 'content-type': 'application/octet-stream' } });

async function template(): Promise<Buffer> {
  const res = await app.inject({ method: 'GET', url: `${base}/club-form.ods` });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('application/vnd.oasis.opendocument.spreadsheet');
  expect(res.headers['content-disposition']).toContain('fiche-club-2026-11-22.ods');
  return res.rawPayload;
}

test('modèle, aperçu, import, liste', async () => {
  const tpl = await template();
  expect(readWorkbook(tpl).sheets.map((s) => s.name)).toEqual(['Fiche club', 'Aide']);
  const filled = fillClubForm(tpl, ['Tani Dojo', 'Jean', null, null, 'Oui'], [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '32', null, null],
    ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Karaté', 'Shobu', null, 'Oui', null],
  ]);
  const preview = await upload(`${base}/club-forms/preview`, filled);
  expect(preview.statusCode).toBe(200);
  expect(preview.json().rows).toHaveLength(2);
  expect((await app.inject({ method: 'GET', url: `${base}/registrations` })).json()).toEqual([]);

  const imported = await upload(`${base}/club-forms/import`, filled);
  expect(imported.json()).toMatchObject({ imported: 2, replaced: 0, skipped: 0 });
  const rows = (await app.inject({ method: 'GET', url: `${base}/registrations` })).json();
  expect(rows.map((r: { fighter: { lastName: string } }) => r.fighter.lastName).sort()).toEqual(['DURAND', 'MARTIN']);
  expect(rows[0].club.name).toBe('Tani Dojo');
});

test('un export FFK n’est pas une fiche club', async () => {
  const csv = Buffer.from('Nom;Prenom;Numero;Entite rattachement;Genre;Type;Age;Categorie;Discipline\nX;;1;C;Masculin;Karate;Senior;-75;\n');
  const res = await upload(`${base}/club-forms/preview`, csv);
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe("Ce fichier n'est pas une fiche club");
});

test('une image est refusée', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const res = await upload(`${base}/club-forms/import`, png);
  expect(res.statusCode).toBe(400);
});

test('saisie manuelle invalide → 400 en français', async () => {
  const res = await app.inject({
    method: 'POST', url: `${base}/registrations`,
    payload: { clubId: null, lastName: 'X', firstName: 'y', sex: 'M', ageBandCode: 'minime', discipline: 'karate', ruleset: 'shobu', weightClassId: 'minime:M:-45', source: 'manual' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().issues.join(' ')).toContain('réservé aux adultes');
});

test('saisie manuelle, modification, suppression ; clubs', async () => {
  const club = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Tani Dojo' } })).json();
  const payload = { clubId: club.id, lastName: 'X', firstName: 'y', sex: 'M', ageBandCode: 'senior', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:M:-75', source: 'onsite' };
  const created = await app.inject({ method: 'POST', url: `${base}/registrations`, payload });
  expect(created.statusCode).toBe(201);
  const rid = created.json().row.id;
  const updated = await app.inject({ method: 'PUT', url: `${base}/registrations/${rid}`, payload: { ...payload, weightClassId: 'senior:M:-84' } });
  expect(updated.json().weightClassId).toBe('senior:M:-84');
  const patched = await app.inject({ method: 'PATCH', url: `${base}/clubs/${club.id}`, payload: { preApproval: true } });
  expect(patched.json().preApproval).toBe(true);
  expect((await app.inject({ method: 'DELETE', url: `${base}/registrations/${rid}` })).statusCode).toBe(204);
});

test('aperçu d’un réimport : inscriptions qui seront retirées ; premier onglet « fiche club » lu', async () => {
  const XLSX = await import('xlsx');
  const tpl = await template();
  const two = fillClubForm(tpl, ['Tani Dojo', 'Jean', null, null, 'Non'], [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null],
    ['DURAND', 'Hugo', 'Masculin', 'Seniors', '-75', 'Karaté', 'Jiyu', null, null, null],
  ]);
  await upload(`${base}/club-forms/import`, two);
  const one = fillClubForm(tpl, ['Tani Dojo', 'Jean', null, null, 'Non'], [['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null]]);
  // un onglet parasite placé en premier
  const wb = XLSX.read(one, { type: 'buffer' });
  const extra = XLSX.utils.aoa_to_sheet([['Notes du coach']]);
  wb.SheetNames.unshift('Notes');
  wb.Sheets['Notes'] = extra;
  const file = XLSX.write(wb, { type: 'buffer', bookType: 'ods' }) as Buffer;
  const preview = (await upload(`${base}/club-forms/preview`, file)).json();
  expect(preview.rows).toHaveLength(1);
  expect(preview.removals.map((r: { label: string }) => r.label)).toEqual(['DURAND Hugo — Karaté']);
});

test('premier onglet « fiche club » cassé : son erreur est signalée (pas de lecture d’un onglet suivant)', async () => {
  const XLSX = await import('xlsx');
  const { CLUB_FORM_TITLE } = await import('../../src/domain/club-form.js');
  const tpl = await template();
  const good = fillClubForm(tpl, ['Tani Dojo', 'Jean', null, null, 'Non'], [['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', null, null, null]]);
  const wb = XLSX.read(good, { type: 'buffer' });
  // Fiche reconnue (titre) mais en-tête du tableau effacé, placée en premier
  wb.SheetNames.unshift('Fiche modifiée');
  wb.Sheets['Fiche modifiée'] = XLSX.utils.aoa_to_sheet([[CLUB_FORM_TITLE], ['Club', 'Tani Dojo']]);
  const file = XLSX.write(wb, { type: 'buffer', bookType: 'ods' }) as Buffer;
  const res = await upload(`${base}/club-forms/preview`, file);
  expect(res.statusCode).toBe(400);
  expect(res.json().issues.join(' ')).toMatch(/En-tête du tableau/);
});

test('grade : enregistré sur le combattant, conservé si absent', async () => {
  const body = { clubId: null, lastName: 'KATA', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' };
  const created = await app.inject({ method: 'POST', url: `${base}/registrations`, payload: { ...body, grade: '2e kyu' } });
  expect(created.statusCode).toBe(201);
  const row = created.json().row as { id: string; fighter: { grade: string | null } };
  expect(row.fighter.grade).toBe('2e kyu');
  const kept = await app.inject({ method: 'PUT', url: `${base}/registrations/${row.id}`, payload: body });
  expect(kept.json().fighter.grade).toBe('2e kyu');
  const cleared = await app.inject({ method: 'PUT', url: `${base}/registrations/${row.id}`, payload: { ...body, grade: null } });
  expect(cleared.json().fighter.grade).toBeNull();
});

const ENTRY_HEADER = { club: 'Tani Dojo', coachName: 'Jean', coachPhone: null, coachEmail: null, preApproval: false };
const ENTRY_LINE = {
  lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', weightKg: 53.5, combat: 'karate', kata: true, grade: '1er kyu',
  ruleset: 'jiyu', prefs: { 'shido-mix': 1 }, shobuKeep: null,
};

test('saisie papier : kata + karaté sur une ligne, catégorie déduite du poids', async () => {
  const send = () => app.inject({ method: 'POST', url: `${base}/club-forms/entry/import`, payload: { header: ENTRY_HEADER, lines: [ENTRY_LINE] } });
  const res = await send();
  expect(res.statusCode).toBe(200);
  const rows = (await app.inject({ method: 'GET', url: `${base}/registrations` })).json() as { discipline: string; weightClassId: string | null; otherDisciplines: string[]; fighter: { grade: string | null }; club: { name: string } }[];
  expect(rows.map((r) => r.discipline).sort()).toEqual(['karate', 'kata']);
  expect(rows.find((r) => r.discipline === 'karate')).toMatchObject({ weightClassId: 'cadet:F:-54', otherDisciplines: ['shido-mix'] });
  expect(rows.every((r) => r.fighter.grade === '1er kyu' && r.club.name === 'Tani Dojo')).toBe(true);
  await send();
  expect((await app.inject({ method: 'GET', url: `${base}/registrations` })).json()).toHaveLength(2);
});

test('saisie papier : ligne invalide → erreur dans l’aperçu, rien d’écrit', async () => {
  const res = await app.inject({ method: 'POST', url: `${base}/club-forms/entry/preview`, payload: { header: ENTRY_HEADER, lines: [{ ...ENTRY_LINE, sex: null }] } });
  expect(res.statusCode).toBe(200);
  expect(res.json().rows[0].errors).toEqual(['Sexe manquant.']);
  expect((await app.inject({ method: 'GET', url: `${base}/registrations` })).json()).toEqual([]);
});

test('relecture : grade gardé quand kata et combat sont sur deux lignes', async () => {
  const kataLine = { ...ENTRY_LINE, weightKg: null, combat: null, ruleset: null, prefs: {} };
  const combatLine = { ...ENTRY_LINE, kata: false, grade: null };
  for (const lines of [[kataLine, combatLine], [combatLine, kataLine]]) {
    await app.inject({ method: 'POST', url: `${base}/club-forms/entry/import`, payload: { header: ENTRY_HEADER, lines } });
    const rows = (await app.inject({ method: 'GET', url: `${base}/registrations` })).json() as { fighter: { grade: string | null } }[];
    expect(rows.map((r) => r.fighter.grade)).toEqual(['1er kyu', '1er kyu']);
  }
});

test('relecture : une fiche papier saisie page par page s’ajoute (rien n’est retiré)', async () => {
  const page2 = { ...ENTRY_LINE, lastName: 'DURAND', kata: false };
  await app.inject({ method: 'POST', url: `${base}/club-forms/entry/import`, payload: { header: ENTRY_HEADER, lines: [ENTRY_LINE] } });
  const preview = await app.inject({ method: 'POST', url: `${base}/club-forms/entry/preview`, payload: { header: ENTRY_HEADER, lines: [page2] } });
  expect(preview.json().removals).toEqual([]);
  await app.inject({ method: 'POST', url: `${base}/club-forms/entry/import`, payload: { header: ENTRY_HEADER, lines: [page2] } });
  expect((await app.inject({ method: 'GET', url: `${base}/registrations` })).json()).toHaveLength(3);
  // Ressaisir la page 1 met à jour sans doublon
  await app.inject({ method: 'POST', url: `${base}/club-forms/entry/import`, payload: { header: ENTRY_HEADER, lines: [ENTRY_LINE] } });
  expect((await app.inject({ method: 'GET', url: `${base}/registrations` })).json()).toHaveLength(3);
});
