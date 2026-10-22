import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { fillClubForm } from '../helpers/club-form-fill.js';
import { BLANK, buildFfkWorkbook, type FfkLine } from '../helpers/ffk-fixture.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const TANI = '0060893 TANI DOJO';
const SHIN = '0060789 SHINSENGUMI DOJO VESUBIE';
const karate: FfkLine[] = [
  ['MARTIN LEA', null, 'L001', TANI, 'Feminine', 'Karate', 'Cadet', -61, null],
  BLANK, BLANK,
  ['MOREAU LINA', null, 'L002', TANI, 'Feminine', 'Karate', 'Poussin', -20, null],
  ['DURAND HUGO', null, 'L003', SHIN, 'Masculin', 'Karate', 'Senior', '+84', 'Shobu'],
  ['SANS AGE', null, null, SHIN, 'Masculin', 'Karate', null, -75, null],
];
const boxe: FfkLine[] = [['DURAND HUGO', null, 'L003', SHIN, 'Masculin', 'Boxe', 'Senior', -84, 'Ji Yu'], BLANK];
const mix: FfkLine[] = [['PETIT NOE', null, 'L004', SHIN, 'Masculin', 'Kmix', 'Junior', -61, null]];
const ffkFile = () => buildFfkWorkbook({ 'Coupe Shidokan Karate': karate, Boxe: boxe, 'Mix Martial': mix });

const send = (url: string, file: Buffer, name = 'export.xlsx') =>
  app.inject({ method: 'POST', url, payload: file, headers: { 'content-type': 'application/octet-stream', 'x-file-name': name } });
const json = (method: 'POST' | 'GET', url: string, payload?: object) => app.inject({ method, url, payload });

async function uploadAll(file = ffkFile()) {
  const res = await send(`${base}/ffk-imports`, file);
  expect(res.statusCode).toBe(200);
  return res.json() as { uploadId: string; sheets: { name: string; headerRow: number; headers: string[]; mapping: Record<string, number | null>; include: boolean }[] };
}

test('upload : onglets reconnus, correspondance devinée', async () => {
  const up = await uploadAll();
  expect(up.sheets.map((s) => [s.name, s.include])).toEqual([['Coupe Shidokan Karate', true], ['Boxe', true], ['Mix Martial', true]]);
  expect(up.sheets[0]!.mapping).toMatchObject({ lastName: 0, licence: 2, discipline: 5, ruleset: 8 });
});

test('aperçu sans effet, puis import, puis réimport sans doublon', async () => {
  const up = await uploadAll();
  const body = { sheets: up.sheets };
  const preview = (await json('POST', `${base}/ffk-imports/${up.uploadId}/preview`, body)).json();
  expect(preview.summary).toEqual({ create: 5, update: 0, doubtful: 0, errors: 1, removals: 0, newWeightClasses: 1 });
  expect((await json('GET', `${base}/registrations`)).json()).toEqual([]);

  const commit = await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, body);
  expect(commit.statusCode).toBe(200);
  expect(commit.json()).toEqual({ created: 5, updated: 0, removed: 0, weightClassesCreated: 1 });

  const rows = (await json('GET', `${base}/registrations`)).json() as { fighterId: string; source: string; ffkConfirmed: boolean; ruleset: string; fighter: { lastName: string; licence: string } ; club: { ffkEntity: string } }[];
  expect(rows).toHaveLength(5);
  expect(rows.every((r) => r.source === 'ffk' && r.ffkConfirmed)).toBe(true);
  const durand = rows.filter((r) => r.fighter.lastName === 'DURAND');
  expect(durand).toHaveLength(2);
  expect(new Set(durand.map((r) => r.fighterId)).size).toBe(1);
  expect(rows.find((r) => r.fighter.lastName === 'PETIT')!.ruleset).toBe('jiyu');
  expect(rows.find((r) => r.fighter.lastName === 'MARTIN')!.club.ffkEntity).toBe(TANI);
  const grid = (await json('GET', `${base}/grid`)).json() as { weightClasses: { id: string }[] };
  expect(grid.weightClasses.some((w) => w.id === 'poussin:F:-20')).toBe(true);

  const again = await uploadAll();
  const second = await json('POST', `${base}/ffk-imports/${again.uploadId}/commit`, { sheets: again.sheets });
  expect(second.json()).toEqual({ created: 0, updated: 5, removed: 0, weightClassesCreated: 0 });
  expect((await json('GET', `${base}/registrations`)).json()).toHaveLength(5);
});

test('fiche club importée avant : l’inscription de fiche est confirmée et garde son règlement', async () => {
  const tpl = (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
  const form = fillClubForm(tpl, ['Tani Dojo', 'Coach', null, null, 'Non'], [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Shobu', '2', null, null],
  ]);
  // Shobu cadette refusé : on passe par jiyu
  const formJiyu = fillClubForm(tpl, ['Tani Dojo', 'Coach', null, null, 'Non'], [
    ['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '2', null, null],
  ]);
  expect((await send(`${base}/club-forms/import`, form)).json().imported).toBe(0);
  expect((await send(`${base}/club-forms/import`, formJiyu)).json().imported).toBe(1);

  const up = await uploadAll(buildFfkWorkbook({ 'Coupe Shidokan Karate': [karate[0]!] }));
  const commit = await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  expect(commit.json()).toMatchObject({ created: 0, updated: 1 });
  const rows = (await json('GET', `${base}/registrations`)).json() as { source: string; ffkConfirmed: boolean; weightClassId: string; otherDisciplines: string[]; fighter: { licence: string } }[];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ source: 'club_form', ffkConfirmed: true, weightClassId: 'cadet:F:-61', otherDisciplines: ['shido-boxing'] });
  expect(rows[0]!.fighter.licence).toBe('L001');

  // Réimport de la fiche (le coach renvoie une correction) : le poids FFK n'est pas écrasé.
  await send(`${base}/club-forms/import`, formJiyu);
  const after = (await json('GET', `${base}/registrations`)).json() as { weightClassId: string; ffkConfirmed: boolean }[];
  expect(after[0]).toMatchObject({ weightClassId: 'cadet:F:-61', ffkConfirmed: true });
});

test('cas douteux : refus tant qu’il n’est pas tranché', async () => {
  await json('POST', `${base}/registrations`, {
    clubId: null, lastName: 'MARTIN', firstName: 'Léna', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'manual',
  });
  const up = await uploadAll(buildFfkWorkbook({ Karate: [['MARTIN LENA', null, 'L9', null, 'Feminine', 'Karate', 'Cadet', -54, null]] }));
  // Pas de club côté FFK : même nom → douteux (« autre club »)
  const preview = (await json('POST', `${base}/ffk-imports/${up.uploadId}/preview`, { sheets: up.sheets })).json();
  expect(preview.summary.doubtful).toBe(1);
  const refused = await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  expect(refused.statusCode).toBe(400);
  const key = preview.items[0].row.key;
  const ok = await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets, choices: { decisions: { [key]: preview.items[0].candidates[0].fighterId } } });
  expect(ok.json()).toMatchObject({ updated: 1, created: 0 });
});

test('correspondance de colonnes mémorisée', async () => {
  const up = await uploadAll();
  const sheets = up.sheets.map((s) => ({ ...s, mapping: { ...s.mapping, ruleset: null } }));
  await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets });
  const again = await uploadAll();
  expect(again.sheets[0]!.mapping.ruleset).toBeNull();
});

test('fichier illisible → 400', async () => {
  const res = await send(`${base}/ffk-imports`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 0]));
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Fichier illisible');
});

test('fiche club arrivée après l’import FFK : pas de doublon d’inscription', async () => {
  const up = await uploadAll(buildFfkWorkbook({ 'Coupe Shidokan Karate': [karate[0]!] }));
  await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  const tpl = (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
  const form = fillClubForm(tpl, ['TANI DOJO', 'Coach', null, null, 'Non'], [['MARTIN', 'Lea', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '2', null, null]]);
  await send(`${base}/club-forms/import`, form);
  const rows = (await json('GET', `${base}/registrations`)).json() as { weightClassId: string; otherDisciplines: string[] }[];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ weightClassId: 'cadet:F:-61', otherDisciplines: ['shido-boxing'] });
});

test('sans licence sur deux onglets : un seul combattant', async () => {
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [['SANS LICENCE', null, null, TANI, 'Masculin', 'Karate', 'Senior', -75, null]],
    Boxe: [['SANS LICENCE', null, null, TANI, 'Masculin', 'Boxe', 'Senior', -75, null]],
  }));
  await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  const rows = (await json('GET', `${base}/registrations`)).json() as { fighterId: string }[];
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((r) => r.fighterId)).size).toBe(1);
});

test('aperçu périmé : la validation est refusée (409)', async () => {
  const up = await uploadAll();
  const preview = (await json('POST', `${base}/ffk-imports/${up.uploadId}/preview`, { sheets: up.sheets })).json();
  await json('POST', `${base}/registrations`, {
    clubId: null, lastName: 'AJOUT', firstName: 'Entre-temps', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'ffk',
  });
  const res = await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets, fingerprint: preview.fingerprint });
  expect(res.statusCode).toBe(409);
  const ok = await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets, fingerprint: (await json('POST', `${base}/ffk-imports/${up.uploadId}/preview`, { sheets: up.sheets })).json().fingerprint });
  expect(ok.statusCode).toBe(200);
});

test('réimport FFK après un recasement H : pas de doublon, la discipline d’origine est reconnue', async () => {
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [['SEUL KARATE', null, 'K1', TANI, 'Masculin', 'Karate', 'Senior', -75, 'Shobu']],
    Boxe: [['AUTRE BOXE', null, 'B1', TANI, 'Masculin', 'Boxe', 'Senior', -75, 'Shobu']],
  }));
  await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  const rows = (await json('GET', `${base}/registrations`)).json() as { id: string; fighter: { lastName: string; licence: string }; club: { id: string } }[];
  const seul = rows.find((x) => x.fighter.lastName === 'SEUL')!;
  // préférences : boxe, puis recasement H
  await app.inject({ method: 'PUT', url: `${base}/registrations/${seul.id}`, payload: {
    clubId: seul.club.id, lastName: 'SEUL', firstName: 'KARATE', sex: 'M', ageBandCode: 'senior', discipline: 'karate', ruleset: 'shobu', weightClassId: 'senior:M:-75', otherDisciplines: ['shido-boxing'], source: 'ffk',
  } });
  const rep = (await json('GET', `${base}/replacement`)).json() as { cases: { id: string; registrationId: string }[]; proposals: Record<string, { id: string; type: string }[]> };
  const h = rep.proposals[rep.cases.find((x) => x.registrationId === seul.id)!.id]!.find((p) => p.type === 'H')!;
  await json('POST', `${base}/replacement/apply`, { proposalId: h.id });
  const again = await uploadAll(buildFfkWorkbook({
    Karate: [['SEUL KARATE', null, 'K1', TANI, 'Masculin', 'Karate', 'Senior', -84, 'Shobu']],
    Boxe: [['AUTRE BOXE', null, 'B1', TANI, 'Masculin', 'Boxe', 'Senior', -75, 'Shobu']],
  }));
  const commit = await json('POST', `${base}/ffk-imports/${again.uploadId}/commit`, { sheets: again.sheets });
  expect(commit.json()).toMatchObject({ created: 0, updated: 2 });
  const after = (await json('GET', `${base}/registrations`)).json() as { id: string; discipline: string; weightClassId: string; ffkConfirmed: boolean; fighter: { licence: string } }[];
  expect(after.find((x) => x.id === seul.id)!.fighter.licence).toBe('K1'); // la modification n'a pas effacé la licence
  const s2 = after.find((x) => x.id === seul.id)!;
  expect(after).toHaveLength(2);
  expect(s2).toMatchObject({ discipline: 'shido-boxing', ffkConfirmed: true, weightClassId: 'senior:M:-75' });
});

test('lien de club « à vérifier » non confirmé : pas mémorisé ; fichier purgé après import', async () => {
  const file = buildFfkWorkbook({ Karate: [['NOUVEAU X', null, 'Z1', SHIN, 'Masculin', 'Karate', 'Senior', -75, null]] });
  await json('POST', `${base}/clubs`, { name: 'Shinsengumi' });
  const up = await uploadAll(file);
  const preview = (await json('POST', `${base}/ffk-imports/${up.uploadId}/preview`, { sheets: up.sheets })).json();
  expect(preview.clubs[0].certainty).toBe('doubtful');
  await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  // Fichier purgé après l'import
  expect((await json('POST', `${base}/ffk-imports/${up.uploadId}/preview`, { sheets: up.sheets })).statusCode).toBe(404);
  // Autre compétition : le lien n'a pas été mémorisé comme sûr
  const other = `/api/competitions/${(await json('POST', '/api/competitions', { name: 'Autre', date: '2026-12-01' })).json().id}`;
  await json('POST', `${other}/clubs`, { name: 'Shinsengumi' });
  const up2 = (await send(`${other}/ffk-imports`, file)).json();
  const p2 = (await json('POST', `${other}/ffk-imports/${up2.uploadId}/preview`, { sheets: up2.sheets })).json();
  expect(p2.clubs[0].certainty).toBe('doubtful');
});

test('lien de club « à vérifier » non confirmé : reste à vérifier au réimport dans la même compétition', async () => {
  const file = buildFfkWorkbook({ Karate: [['NOUVEAU X', null, 'Z1', SHIN, 'Masculin', 'Karate', 'Senior', -75, null]] });
  await json('POST', `${base}/clubs`, { name: 'Shinsengumi' });
  const up = await uploadAll(file);
  await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  const up2 = await uploadAll(file);
  const p2 = (await json('POST', `${base}/ffk-imports/${up2.uploadId}/preview`, { sheets: up2.sheets })).json();
  expect(p2.clubs[0].certainty).toBe('doubtful');
});

test('purge des fichiers envoyés : un aperçu ouvert survit à d’autres envois ; seuls les anciens fichiers en trop partent', async () => {
  const first = await uploadAll();
  for (let i = 0; i < 6; i++) await uploadAll();
  // Envoyé il y a quelques instants : toujours là malgré 6 envois plus récents.
  expect((await json('POST', `${base}/ffk-imports/${first.uploadId}/preview`, { sheets: first.sheets })).statusCode).toBe(200);
  // Vieux d'un jour : purgé au prochain envoi (au-delà des 5 derniers).
  const raw = new Database(dbPath);
  raw.prepare(`UPDATE uploads SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')`).run();
  raw.close();
  const last = await uploadAll();
  expect((await json('POST', `${base}/ffk-imports/${first.uploadId}/preview`, { sheets: first.sheets })).statusCode).toBe(404);
  expect((await json('POST', `${base}/ffk-imports/${last.uploadId}/preview`, { sheets: last.sheets })).statusCode).toBe(200);
  const check = new Database(dbPath);
  expect((check.prepare('SELECT count(*) AS n FROM uploads').get() as { n: number }).n).toBe(5);
  check.close();
});

test('réimport de fiche club après un recasement H : discipline d’origine reconnue, placement gardé, rien à retirer', async () => {
  const tpl = (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
  const fiche = (poids: string) => fillClubForm(tpl, ['Tani Dojo', 'Coach', null, null, 'Non'], [
    ['SEUL', 'Karate', 'Masculin', 'Seniors', poids, 'Karaté', 'Shobu', '2', null, null],
    ['AUTRE', 'Boxe', 'Masculin', 'Seniors', '-75', 'Shido-boxing', 'Shobu', null, null, null],
  ]);
  expect((await send(`${base}/club-forms/import`, fiche('-75'))).json().imported).toBe(2);
  const rows = (await json('GET', `${base}/registrations`)).json() as { id: string; fighter: { lastName: string } }[];
  const seul = rows.find((x) => x.fighter.lastName === 'SEUL')!;
  const rep = (await json('GET', `${base}/replacement`)).json() as { cases: { id: string; registrationId: string }[]; proposals: Record<string, { id: string; type: string }[]> };
  const h = rep.proposals[rep.cases.find((x) => x.registrationId === seul.id)!.id]!.find((p) => p.type === 'H')!;
  expect((await json('POST', `${base}/replacement/apply`, { proposalId: h.id })).statusCode).toBe(200);
  const placed = (await json('GET', `${base}/registrations`)).json() as { id: string; discipline: string; weightClassId: string; categoryId: string }[];
  const before = placed.find((x) => x.id === seul.id)!;
  expect(before.discipline).toBe('shido-boxing');

  const preview = (await send(`${base}/club-forms/preview`, fiche('-84'))).json();
  expect(preview.removals).toEqual([]);
  await send(`${base}/club-forms/import`, fiche('-84'));
  const after = (await json('GET', `${base}/registrations`)).json() as { id: string; discipline: string; weightClassId: string; categoryId: string }[];
  expect(after).toHaveLength(2);
  expect(after.find((x) => x.id === seul.id)).toMatchObject({ discipline: 'shido-boxing', weightClassId: before.weightClassId, categoryId: before.categoryId });
  // La correction du coach va dans les valeurs d'origine (utilisées par un retour).
  const original = JSON.parse((after.find((x) => x.id === seul.id) as unknown as { originalJson: string }).originalJson);
  expect(original).toMatchObject({ discipline: 'karate', weightClassId: 'senior:M:-84' });
});
