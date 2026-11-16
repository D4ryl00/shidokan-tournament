import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { openDb } from '../../src/server/db/client.js';
import { loadExisting } from '../../src/server/repositories/ffk-import.js';
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

test('fichier illisible → 400', async () => {
  const res = await send(`${base}/ffk-imports`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 0]));
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Fichier illisible');
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

test('réimport de fiche club après une réaffectation H : discipline d’origine reconnue, placement gardé, rien à retirer', async () => {
  const tpl = (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
  await app!.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Tani Dojo' } }); // le club de la fiche existe déjà
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

// --- Import par cartes (étape 51) ---

type Reg = {
  id: string; fighterId: string; discipline: string; ruleset: string | null; weightClassId: string | null; source: string; ffkConfirmed: boolean;
  otherDisciplines: string[]; categoryId: string | null; originalJson: string | null;
  fighter: { lastName: string; firstName: string; licence: string | null; ageBandCode: string; clubId: string | null; sex: string };
  club: { id: string; name: string; ffkEntity: string | null } | null;
};
type Line = Record<string, unknown> & { lastName: string; weightClassId: string | null; ruleset: string | null };
type Card = { key: string; state: string; fighterId: string | null; reason: string | null; changes: string[]; diffs: { field: string }[]; candidates: { fighterId: string; reason: string }[]; exportLine: Line };
type Preview = {
  cards: Card[]; clubs: { clubEntity: string; target: string | null; proposal: { clubId: string; certainty: string } | null }[];
  orphans: { fighterId: string; label: string; action: string }[]; weightClasses: { id: string; accepted: boolean }[];
  summary: Record<string, number>; fingerprint: string;
  fighters: { fighterId: string; label: string; clubName: string; ageLabel: string; disciplines: string; line: Line; clubId: string | null; publicNameHidden: boolean; version: string; licence: string | null; editable: boolean; partlyEditable: boolean; startedDisciplines: string[]; fromFfk: boolean }[];
};
type Upload = Awaited<ReturnType<typeof uploadAll>>;

const regs = async () => (await json('GET', `${base}/registrations`)).json() as Reg[];
const regsOf = async (lastName: string) => (await regs()).filter((r) => r.fighter.lastName === lastName);
const newClub = async (name: string, at = base) => (await json('POST', `${at}/clubs`, { name })).json().id as string;
async function register(clubId: string | null, lastName: string, firstName: string, over: object = {}) {
  const res = await json('POST', `${base}/registrations`, {
    clubId, lastName, firstName, sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-61', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}
async function preview(up: Upload, choices: object = {}, at = base): Promise<Preview> {
  const res = await json('POST', `${at}/ffk-imports/${up.uploadId}/preview`, { sheets: up.sheets, choices });
  expect(res.statusCode).toBe(200);
  return res.json() as Preview;
}
const commit = (up: Upload, choices: object = {}, fingerprint?: string) =>
  json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets, choices, ...(fingerprint ? { fingerprint } : {}) });
const cardOf = (p: Preview, lastName: string) => p.cards.find((c) => c.exportLine.lastName === lastName)!;
/** Lecture directe de la base de test (jamais la base vivante). */
function sqlAll<T>(query: string, ...params: unknown[]): T[] {
  const r = new Database(dbPath, { readonly: true });
  try {
    return r.prepare(query).all(...params) as T[];
  } finally {
    r.close();
  }
}
function sqlRun(query: string, ...params: unknown[]) {
  const r = new Database(dbPath);
  r.prepare(query).run(...params);
  r.close();
}
const counts = () => sqlAll<{ f: number; r: number }>('select (select count(*) from fighters) as f, (select count(*) from registrations) as r')[0]!;
/** Ce qui compte d'une inscription pour dire « rien n'a changé ». */
const snapshot = (rows: Reg[]) => rows.map((r) => ({ id: r.id, discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId, source: r.source, ffkConfirmed: r.ffkConfirmed, fighter: r.fighter }));
const validated = (fighterId: string, line: object, clubId: string, publicNameHidden = false) => ({ kind: 'validated', fighterId, value: { line, clubId, publicNameHidden } });

test('aperçu par cartes : une fiche existante reconnue (sûre, sans écart) est sans problème, avec sa version ; l’import complète la licence', async () => {
  const clubId = await newClub('Tani Dojo');
  const { fighterId } = await register(clubId, 'MARTIN', 'Léa', { source: 'ffk' });
  const up = await uploadAll(buildFfkWorkbook({ Karate: [karate[0]!] }));
  const p = await preview(up);
  expect(p.clubs[0]).toMatchObject({ target: clubId });
  expect(p.cards).toHaveLength(1);
  expect(p.cards[0]).toMatchObject({ state: 'auto', fighterId, changes: ['N° de licence : — → L001'] });
  expect(p.orphans).toEqual([]);
  expect(typeof p.fingerprint).toBe('string');
  // Liste de recherche : tous les champs de la fiche, plus de quoi l'afficher.
  expect(p.fighters).toEqual([
    expect.objectContaining({
      fighterId, label: 'MARTIN Léa', clubName: 'Tani Dojo', ageLabel: 'Cadets', disciplines: 'Karaté', clubId, licence: null, publicNameHidden: false,
      editable: true, partlyEditable: false, startedDisciplines: [], fromFfk: true, version: expect.any(String),
      line: expect.objectContaining({ lastName: 'MARTIN', weightClassId: 'cadet:F:-61' }),
    }),
  ]);
  const res = await commit(up, {}, p.fingerprint);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ created: 0, updated: 1, deleted: 0, weightClassesCreated: 0, leftAside: 0 });
  expect((await regs())[0]).toMatchObject({ ffkConfirmed: true, source: 'ffk', fighter: { licence: 'L001' } });
});

test('import sans aucun choix : seules les cartes auto sont écrites ; les todo ne touchent pas leurs inscriptions', async () => {
  const tani = await newClub('Tani Dojo');
  await register(tani, 'MARTIN', 'Léa');
  const durand = await register(tani, 'DURAND', 'Zoé', { ageBandCode: 'junior', weightClassId: 'junior:F:-59' });
  sqlRun('update registrations set ffk_confirmed = 1 where fighter_id = ?', durand.fighterId);
  const before = snapshot(await regsOf('DURAND'));
  expect(before[0]!.ffkConfirmed).toBe(true);
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [
      karate[0]!,
      ['DURAND ZOE', null, 'L005', TANI, 'Feminine', 'Karate', 'Cadet', -54, null],
      ['NOUVEAU NOE', null, 'L006', TANI, 'Masculin', 'Karate', 'Senior', -75, null],
      ['INCONNU X', null, 'L007', SHIN, 'Masculin', 'Karate', 'Senior', -75, null],
    ],
  }));
  const p = await preview(up);
  expect(p.cards.map((c) => [c.exportLine.lastName, c.state, c.reason])).toEqual([
    ['MARTIN', 'auto', null],
    ['DURAND', 'todo', 'reste à remplir : Catégorie d’âge, Catégorie de poids'],
    ['NOUVEAU', 'auto', null],
    ['INCONNU', 'todo', 'club pas relié'],
  ]);

  const res = await commit(up);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ created: 1, updated: 1, deleted: 0, weightClassesCreated: 0, leftAside: 2 });
  expect(snapshot(await regsOf('DURAND'))).toEqual(before);
  expect((await regsOf('MARTIN'))[0]).toMatchObject({ source: 'manual', ffkConfirmed: true, fighter: { licence: 'L001' } });
  expect(await regsOf('NOUVEAU')).toEqual([expect.objectContaining({ source: 'ffk', ffkConfirmed: true, ruleset: 'jiyu', weightClassId: 'senior:M:-75', fighter: expect.objectContaining({ licence: 'L006', clubId: tani }) })]);
  expect(await regsOf('INCONNU')).toEqual([]);
  expect(counts()).toEqual({ f: 3, r: 3 });
});

test('carte validée : valeurs de la carte écrites (âge, poids, licence, club), inscriptions de l’export ffkConfirmed, source ffk pour les nouvelles', async () => {
  const tani = await newClub('Tani Dojo');
  const autre = await newClub('Autre Club');
  const durand = await register(autre, 'DURAND', 'Zoé', { ageBandCode: 'junior', weightClassId: 'junior:F:-59' });
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [['DURAND ZOE', null, 'L005', TANI, 'Feminine', 'Karate', 'Cadet', -54, null]],
    Kata: [['DURAND ZOE', null, 'L005', TANI, 'Feminine', 'Kata', 'Cadet', null, null]],
  }));
  const card = cardOf(await preview(up), 'DURAND');
  expect(card).toMatchObject({ state: 'todo', reason: 'combattant pas choisi', candidates: [{ fighterId: durand.fighterId, reason: 'même nom, autre club' }] });
  expect(card.exportLine).toMatchObject({ combats: ['karate'], kata: true, weightClassId: 'cadet:F:-54' });
  const choices = { cards: { [card.key]: validated(durand.fighterId, { ...card.exportLine, ruleset: 'jiyu' }, tani) } };
  const p = await preview(up, choices);
  expect(cardOf(p, 'DURAND')).toMatchObject({ state: 'done', fighterId: durand.fighterId });

  const res = await commit(up, choices, p.fingerprint);
  expect(res.json()).toEqual({ created: 0, updated: 1, deleted: 0, weightClassesCreated: 0, leftAside: 0 });
  const rows = await regsOf('DURAND');
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.discipline === 'karate')).toMatchObject({
    id: durand.id, weightClassId: 'cadet:F:-54', ruleset: 'jiyu', source: 'manual', ffkConfirmed: true,
    fighter: { ageBandCode: 'cadet', licence: 'L005', clubId: tani },
  });
  expect(rows.find((r) => r.discipline === 'kata')).toMatchObject({ source: 'ffk', ffkConfirmed: true, fighterId: durand.fighterId });
  expect(counts()).toEqual({ f: 1, r: 2 });
});

test('inscription recasée : la carte validée écrit les valeurs d’origine, le placement validé reste', async () => {
  await newClub('Tani Dojo');
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [['SEUL KARATE', null, 'K1', TANI, 'Masculin', 'Karate', 'Senior', -75, 'Shobu']],
    Boxe: [['AUTRE BOXE', null, 'B1', TANI, 'Masculin', 'Boxe', 'Senior', -75, 'Shobu']],
  }));
  expect((await commit(up)).json()).toMatchObject({ created: 2 });
  const seul = (await regsOf('SEUL'))[0]!;
  // Préférence : boxe, puis recasement H vers la boxe.
  await app.inject({ method: 'PUT', url: `${base}/registrations/${seul.id}`, payload: {
    clubId: seul.club!.id, lastName: 'SEUL', firstName: 'KARATE', sex: 'M', ageBandCode: 'senior', discipline: 'karate', ruleset: 'shobu', weightClassId: 'senior:M:-75', otherDisciplines: ['shido-boxing'], source: 'ffk',
  } });
  const rep = (await json('GET', `${base}/replacement`)).json() as { cases: { id: string; registrationId: string }[]; proposals: Record<string, { id: string; type: string }[]> };
  const h = rep.proposals[rep.cases.find((x) => x.registrationId === seul.id)!.id]!.find((p) => p.type === 'H')!;
  expect((await json('POST', `${base}/replacement/apply`, { proposalId: h.id })).statusCode).toBe(200);
  const placed = (await regsOf('SEUL'))[0]!;
  expect(placed.discipline).toBe('shido-boxing');

  // Réimport : l'export dit -84 ; l'organisateur valide la fiche avec le poids FFK.
  const again = await uploadAll(buildFfkWorkbook({
    Karate: [['SEUL KARATE', null, 'K1', TANI, 'Masculin', 'Karate', 'Senior', -84, 'Shobu']],
    Boxe: [['AUTRE BOXE', null, 'B1', TANI, 'Masculin', 'Boxe', 'Senior', -75, 'Shobu']],
  }));
  const p = await preview(again);
  const card = cardOf(p, 'SEUL');
  expect(card).toMatchObject({ state: 'todo' });
  expect(card.diffs.map((d) => d.field)).toContain('weightClassId');
  expect(cardOf(p, 'AUTRE')).toMatchObject({ state: 'auto', changes: [] });
  const fiche = p.fighters.find((f) => f.fighterId === seul.fighterId)!;
  expect(fiche.line).toMatchObject({ combats: ['karate'], weightClassId: 'senior:M:-75' }); // la fiche montre les valeurs d'origine
  const choices = { cards: { [card.key]: validated(seul.fighterId, { ...fiche.line, weightClassId: 'senior:M:-84' }, fiche.clubId!) } };
  const res = await commit(again, choices, (await preview(again, choices)).fingerprint);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ created: 0, updated: 1 });
  const after = await regs();
  expect(after).toHaveLength(2);
  const s2 = after.find((x) => x.id === seul.id)!;
  expect(s2).toMatchObject({ discipline: 'shido-boxing', ffkConfirmed: true, weightClassId: placed.weightClassId, categoryId: placed.categoryId, fighter: { licence: 'K1' } });
  expect(JSON.parse(s2.originalJson!)).toMatchObject({ discipline: 'karate', weightClassId: 'senior:M:-84' });
});

test('combats commencés : la carte validée garde ce qui a commencé', async () => {
  const tani = await newClub('Tani Dojo');
  const martin = await register(tani, 'MARTIN', 'Léa');
  await register(tani, 'BERNARD', 'Ana');
  const [cat] = (await json('GET', `${base}/categories`)).json() as { id: string; registrationIds: string[] }[];
  expect(cat!.registrationIds).toContain(martin.id);
  expect((await app.inject({ method: 'PATCH', url: `${base}/categories/${cat!.id}`, payload: { status: 'started' } })).statusCode).toBe(200);
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [['MARTIN LEA', null, 'L001', TANI, 'Feminine', 'Karate', 'Cadet', -54, null]],
    Kata: [['MARTIN LEA', null, 'L001', TANI, 'Feminine', 'Kata', 'Cadet', null, null]],
  }));
  const p = await preview(up);
  const card = cardOf(p, 'MARTIN');
  expect(card.state).toBe('todo');
  expect(p.fighters.find((f) => f.fighterId === martin.fighterId)).toMatchObject({ partlyEditable: true, startedDisciplines: ['karate'] });
  const choices = { cards: { [card.key]: validated(martin.fighterId, { ...card.exportLine, ruleset: 'jiyu' }, tani) } };
  const res = await commit(up, choices, (await preview(up, choices)).fingerprint);
  expect(res.statusCode).toBe(200);
  const rows = await regsOf('MARTIN');
  expect(rows.find((r) => r.discipline === 'karate')).toMatchObject({ id: martin.id, weightClassId: 'cadet:F:-61', categoryId: cat!.id, ffkConfirmed: true });
  expect(rows.find((r) => r.discipline === 'kata')).toMatchObject({ source: 'ffk', ffkConfirmed: true, fighter: { licence: 'L001' } });
});

test('catégorie acceptée créée ; non acceptée jamais créée', async () => {
  await newClub('Tani Dojo');
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [
      ['PETIT LOU', null, 'L010', TANI, 'Feminine', 'Karate', 'Poussin', -20, null],
      ['PETIT LEO', null, 'L011', TANI, 'Masculin', 'Karate', 'Poussin', -20, null],
    ],
  }));
  const p = await preview(up);
  expect(p.weightClasses.map((w) => [w.id, w.accepted])).toEqual([['poussin:F:-20', false], ['poussin:M:-20', false]]);
  const choices = { acceptedWeightClasses: ['poussin:F:-20'] };
  const res = await commit(up, choices, (await preview(up, choices)).fingerprint);
  expect(res.json()).toEqual({ created: 1, updated: 0, deleted: 0, weightClassesCreated: 1, leftAside: 1 });
  const grid = (await json('GET', `${base}/grid`)).json() as { weightClasses: { id: string }[] };
  expect(grid.weightClasses.some((w) => w.id === 'poussin:F:-20')).toBe(true);
  expect(grid.weightClasses.some((w) => w.id === 'poussin:M:-20')).toBe(false);
  expect(await regs()).toEqual([expect.objectContaining({ weightClassId: 'poussin:F:-20', fighter: expect.objectContaining({ firstName: 'LOU' }) })]);
});

test('lien choisi mémorisé (ffkEntity + alias) ; « none » ne mémorise rien ; un nouveau choix remplace l’ancien lien', async () => {
  const tani = await newClub('Tani Dojo');
  const shin = await newClub('Shinsengumi');
  const file = buildFfkWorkbook({ Karate: [karate[0]!, ['DURAND HUGO', null, 'L003', SHIN, 'Masculin', 'Karate', 'Senior', -75, null]] });
  const up = await uploadAll(file);
  const p = await preview(up);
  expect(p.clubs.map((c) => [c.clubEntity, c.target, c.proposal?.certainty])).toEqual([[TANI, tani, 'sure'], [SHIN, null, 'doubtful']]);
  const choices = { clubLinks: { [TANI]: 'none', [SHIN]: shin } };
  const res = await commit(up, choices, (await preview(up, choices)).fingerprint);
  expect(res.json()).toEqual({ created: 1, updated: 0, deleted: 0, weightClassesCreated: 0, leftAside: 1 });
  expect(sqlAll('select name, ffk_entity as e from clubs order by name')).toEqual([{ name: 'Shinsengumi', e: SHIN }, { name: 'Tani Dojo', e: null }]);
  expect(sqlAll('select name_key as k, club_entity as e from club_aliases')).toEqual([{ k: 'SHINSENGUMI', e: SHIN }]);
  expect(await regsOf('DURAND')).toEqual([expect.objectContaining({ fighter: expect.objectContaining({ clubId: shin }) })]);
  expect(await regsOf('MARTIN')).toEqual([]);

  // Autre compétition : le lien choisi est reconnu (alias).
  const other = `/api/competitions/${(await json('POST', '/api/competitions', { name: 'Autre', date: '2026-12-01' })).json().id}`;
  const otherShin = await newClub('Shinsengumi', other);
  const up2 = (await send(`${other}/ffk-imports`, file)).json() as Upload;
  expect((await preview(up2, {}, other)).clubs.find((c) => c.clubEntity === SHIN)).toMatchObject({ target: otherShin, proposal: { certainty: 'sure' } });

  // Lien corrigé : relié à un autre club, l'entité quitte l'ancien.
  const vesubie = await newClub('Vésubie');
  const up3 = await uploadAll(file);
  const fix = { clubLinks: { [SHIN]: vesubie } };
  expect((await commit(up3, fix, (await preview(up3, fix)).fingerprint)).statusCode).toBe(200);
  expect(sqlAll('select name, ffk_entity as e from clubs where competition_id = ? order by name', base.split('/').pop())).toEqual([
    { name: 'Shinsengumi', e: null }, { name: 'Tani Dojo', e: TANI }, { name: 'Vésubie', e: SHIN },
  ]);
  expect((await preview(await uploadAll(file))).clubs.find((c) => c.clubEntity === SHIN)).toMatchObject({ target: vesubie });
});

test('orphelin « delete » supprimé (et le combattant sans inscription) ; « keep » gardé, ffkConfirmed false', async () => {
  const tani = await newClub('Tani Dojo');
  const ancien = await register(tani, 'ANCIEN', 'Un');
  await register(tani, 'ANCIEN', 'Un', { discipline: 'kata', ruleset: null, weightClassId: null });
  const garde = await register(tani, 'GARDE', 'Deux');
  sqlRun('update registrations set ffk_confirmed = 1');
  const up = await uploadAll(buildFfkWorkbook({ Karate: [['NOUVEAU NOE', null, 'L006', TANI, 'Masculin', 'Karate', 'Senior', -75, null]] }));
  const p = await preview(up);
  expect(p.orphans.map((o) => [o.label, o.action])).toEqual([['ANCIEN Un', 'keep'], ['GARDE Deux', 'keep']]);
  const choices = { orphans: { [ancien.fighterId]: 'delete' } };
  const p2 = await preview(up, choices);
  expect(p2.summary.deletes).toBe(1);
  const res = await commit(up, choices, p2.fingerprint);
  expect(res.json()).toEqual({ created: 1, updated: 0, deleted: 1, weightClassesCreated: 0, leftAside: 0 });
  expect(await regsOf('ANCIEN')).toEqual([]);
  expect(sqlAll('select id from fighters where id = ?', ancien.fighterId)).toEqual([]);
  expect(await regsOf('GARDE')).toEqual([expect.objectContaining({ id: garde.id, ffkConfirmed: false })]);
  expect(counts()).toEqual({ f: 2, r: 2 });
});

test('réimport du même fichier après import partiel : seules les cartes non tranchées restent todo', async () => {
  const tani = await newClub('Tani Dojo');
  const durand = await register(tani, 'DURAND', 'Zoé', { ageBandCode: 'junior', weightClassId: 'junior:F:-59' });
  await register(tani, 'ZED', 'Ana', { ageBandCode: 'junior', weightClassId: 'junior:F:-59' });
  const file = buildFfkWorkbook({
    Karate: [
      ['DURAND ZOE', null, 'L005', TANI, 'Feminine', 'Karate', 'Cadet', -54, null],
      ['ZED ANA', null, 'L008', TANI, 'Feminine', 'Karate', 'Cadet', -54, null],
      ['NOUVEAU NOE', null, 'L006', TANI, 'Masculin', 'Karate', 'Senior', -75, null],
    ],
  });
  const up = await uploadAll(file);
  const card = cardOf(await preview(up), 'DURAND');
  expect(card.state).toBe('todo');
  // Validée avec les valeurs FFK.
  const choices = { cards: { [card.key]: validated(durand.fighterId, { ...card.exportLine, ruleset: 'jiyu' }, tani) } };
  expect((await commit(up, choices, (await preview(up, choices)).fingerprint)).json()).toEqual({ created: 1, updated: 1, deleted: 0, weightClassesCreated: 0, leftAside: 1 });

  const again = await uploadAll(file);
  const p = await preview(again);
  expect(p.cards.map((c) => [c.exportLine.lastName, c.state, c.changes])).toEqual([
    ['DURAND', 'auto', []],
    ['ZED', 'todo', []],
    ['NOUVEAU', 'auto', []],
  ]);
  expect(p.summary).toMatchObject({ todo: 1, auto: 2, done: 0 });
  expect((await commit(again, {}, p.fingerprint)).json()).toEqual({ created: 0, updated: 0, deleted: 0, weightClassesCreated: 0, leftAside: 1 });
  expect(counts()).toEqual({ f: 3, r: 3 });
});

test('fiche modifiée entre aperçu et import : 409 « Les inscriptions ont changé depuis l’aperçu : relancez l’aperçu avant d’importer. », rien écrit', async () => {
  const tani = await newClub('Tani Dojo');
  const martin = await register(tani, 'MARTIN', 'Léa');
  const up = await uploadAll(buildFfkWorkbook({ Karate: [karate[0]!, ['NOUVEAU NOE', null, 'L006', TANI, 'Masculin', 'Karate', 'Senior', -75, null]] }));
  const p = await preview(up);
  // Autre poste : la fiche change de poids.
  const put = await app.inject({ method: 'PUT', url: `${base}/registrations/${martin.id}`, payload: {
    clubId: tani, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual',
  } });
  expect(put.statusCode).toBe(200);
  const before = { counts: counts(), rows: snapshot(await regs()) };
  const res = await commit(up, {}, p.fingerprint);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Les inscriptions ont changé depuis l’aperçu : relancez l’aperçu avant d’importer.');
  expect({ counts: counts(), rows: snapshot(await regs()) }).toEqual(before);
  expect(before.rows[0]).toMatchObject({ weightClassId: 'cadet:F:-54', fighter: { licence: null } });

  // Un combattant ajouté entre-temps (fiche sans inscription FFK de plus) : refusé aussi.
  const p2 = await preview(up);
  await register(tani, 'AJOUT', 'Entre-temps');
  expect((await commit(up, {}, p2.fingerprint)).statusCode).toBe(409);
  expect(counts()).toEqual({ f: 2, r: 2 });

  // Aperçu relancé : l'import passe.
  const ok = await commit(up, {}, (await preview(up)).fingerprint);
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toMatchObject({ created: 1, leftAside: 1 });
});

test('une ligne refusée à l’écriture annule tout l’import (400), le nom du combattant en tête du message', async () => {
  const tani = await newClub('Tani Dojo');
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [['NOUVEAU NOE', null, 'L006', TANI, 'Masculin', 'Karate', 'Senior', -75, null], ['VALIDE MAL', null, 'L009', TANI, 'Masculin', 'Karate', 'Senior', -75, null]],
  }));
  const card = cardOf(await preview(up), 'VALIDE');
  // Catégorie de poids d'une autre tranche d'âge : la ligne ne s'enregistre pas.
  const choices = { cards: { [card.key]: validated('new', { ...card.exportLine, ruleset: 'jiyu', weightClassId: 'cadet:F:-54' }, tani) } };
  const res = await commit(up, choices, (await preview(up, choices)).fingerprint);
  expect(res.statusCode).toBe(400);
  expect(res.json().issues[0]).toMatch(/^VALIDE MAL : /);
  expect(counts()).toEqual({ f: 0, r: 0 });
});

test('aperçu sans effet, puis import, puis réimport sans doublon', async () => {
  await newClub('Tani Dojo');
  await newClub('Shinsengumi Dojo Vesubie');
  const up = await uploadAll();
  const choices = { acceptedWeightClasses: ['poussin:F:-20'] };
  const p = await preview(up, choices);
  expect(p.summary).toMatchObject({ auto: 4, todo: 1, creates: 4 });
  expect(cardOf(p, 'SANS')).toMatchObject({ state: 'todo' });
  expect(counts()).toEqual({ f: 0, r: 0 });

  const res = await commit(up, choices, p.fingerprint);
  expect(res.json()).toEqual({ created: 4, updated: 0, deleted: 0, weightClassesCreated: 1, leftAside: 1 });
  const rows = await regs();
  expect(rows).toHaveLength(5);
  expect(rows.every((r) => r.source === 'ffk' && r.ffkConfirmed)).toBe(true);
  const durand = rows.filter((r) => r.fighter.lastName === 'DURAND');
  expect(durand).toHaveLength(2);
  expect(new Set(durand.map((r) => r.fighterId)).size).toBe(1);
  expect(rows.find((r) => r.fighter.lastName === 'PETIT')!.ruleset).toBe('jiyu');
  expect(rows.find((r) => r.fighter.lastName === 'MARTIN')!.club!.ffkEntity).toBe(TANI);

  const again = await uploadAll();
  const p2 = await preview(again);
  expect(p2.summary).toMatchObject({ auto: 4, todo: 1, creates: 0, updates: 0 });
  expect((await commit(again, {}, p2.fingerprint)).json()).toEqual({ created: 0, updated: 0, deleted: 0, weightClassesCreated: 0, leftAside: 1 });
  expect(await regs()).toHaveLength(5);
});

test('fiche club importée avant : l’inscription de fiche est confirmée et garde son règlement', async () => {
  const tpl = (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
  const tani = await newClub('Tani Dojo');
  const formJiyu = fillClubForm(tpl, ['Tani Dojo', 'Coach', null, null, 'Non'], [['MARTIN', 'Léa', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '2', null, null]]);
  expect((await send(`${base}/club-forms/import`, formJiyu)).json().imported).toBe(1);
  const [reg] = await regs();

  const up = await uploadAll(buildFfkWorkbook({ 'Coupe Shidokan Karate': [karate[0]!] }));
  const card = cardOf(await preview(up), 'MARTIN');
  expect(card).toMatchObject({ state: 'todo', reason: 'reste à remplir : Catégorie de poids' });
  // Sans choix : la fiche reste telle quelle.
  expect((await commit(up)).json()).toMatchObject({ updated: 0, leftAside: 1 });
  expect((await regs())[0]).toMatchObject({ weightClassId: 'cadet:F:-54', ffkConfirmed: false });

  const up2 = await uploadAll(buildFfkWorkbook({ 'Coupe Shidokan Karate': [karate[0]!] }));
  const p = await preview(up2);
  const fiche = p.fighters.find((f) => f.fighterId === reg!.fighterId)!;
  const choices = { cards: { [cardOf(p, 'MARTIN').key]: validated(reg!.fighterId, { ...fiche.line, weightClassId: 'cadet:F:-61', licence: 'L001' }, tani) } };
  expect((await commit(up2, choices, (await preview(up2, choices)).fingerprint)).json()).toMatchObject({ created: 0, updated: 1 });
  const rows = await regs();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: reg!.id, source: 'club_form', ffkConfirmed: true, ruleset: 'jiyu', weightClassId: 'cadet:F:-61', otherDisciplines: ['shido-boxing'], fighter: { licence: 'L001' } });

  // Réimport de la fiche (le coach renvoie une correction) : le poids FFK n'est pas écrasé.
  await send(`${base}/club-forms/import`, formJiyu);
  expect((await regs())[0]).toMatchObject({ weightClassId: 'cadet:F:-61', ffkConfirmed: true });
});

test('cas douteux : laissé de côté sans choix, écrit une fois tranché', async () => {
  const tani = await newClub('Tani Dojo');
  const lena = await register(null, 'MARTIN', 'Léna', { weightClassId: 'cadet:F:-54' });
  const up = await uploadAll(buildFfkWorkbook({ Karate: [['MARTIN LENA', null, 'L9', null, 'Feminine', 'Karate', 'Cadet', -54, null]] }));
  const p = await preview(up);
  expect(p.cards[0]).toMatchObject({ state: 'todo', candidates: [{ fighterId: lena.fighterId, reason: 'même nom, club non renseigné' }] });
  const before = snapshot(await regs());
  expect((await commit(up, {}, p.fingerprint)).json()).toEqual({ created: 0, updated: 0, deleted: 0, weightClassesCreated: 0, leftAside: 1 });
  expect(snapshot(await regs())).toEqual(before);

  const up2 = await uploadAll(buildFfkWorkbook({ Karate: [['MARTIN LENA', null, 'L9', null, 'Feminine', 'Karate', 'Cadet', -54, null]] }));
  const choices = { cards: { [p.cards[0]!.key]: validated(lena.fighterId, { ...p.cards[0]!.exportLine, ruleset: 'jiyu' }, tani) } };
  expect((await commit(up2, choices, (await preview(up2, choices)).fingerprint)).json()).toMatchObject({ updated: 1, created: 0, leftAside: 0 });
  expect((await regs())[0]).toMatchObject({ id: lena.id, ffkConfirmed: true, fighter: { licence: 'L9', clubId: tani } });
});

test('correspondance de colonnes mémorisée', async () => {
  const up = await uploadAll();
  const sheets = up.sheets.map((s) => ({ ...s, mapping: { ...s.mapping, ruleset: null } }));
  expect((await json('POST', `${base}/ffk-imports/${up.uploadId}/commit`, { sheets })).statusCode).toBe(200);
  const again = await uploadAll();
  expect(again.sheets[0]!.mapping.ruleset).toBeNull();
});

test('fiche club arrivée après l’import FFK : pas de doublon d’inscription', async () => {
  await newClub('Tani Dojo');
  const up = await uploadAll(buildFfkWorkbook({ 'Coupe Shidokan Karate': [karate[0]!] }));
  expect((await commit(up)).json()).toMatchObject({ created: 1 });
  const tpl = (await app.inject({ method: 'GET', url: `${base}/club-form.ods` })).rawPayload;
  const form = fillClubForm(tpl, ['Tani Dojo', 'Coach', null, null, 'Non'], [['MARTIN', 'Lea', 'Féminin', 'Cadets', '-54', 'Karaté', 'Jiyu', '2', null, null]]);
  await send(`${base}/club-forms/import`, form);
  const rows = await regs();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ weightClassId: 'cadet:F:-61', otherDisciplines: ['shido-boxing'] });
});

test('sans licence sur deux onglets : un seul combattant', async () => {
  await newClub('Tani Dojo');
  const up = await uploadAll(buildFfkWorkbook({
    Karate: [['SANS LICENCE', null, null, TANI, 'Masculin', 'Karate', 'Senior', -75, null]],
    Boxe: [['SANS LICENCE', null, null, TANI, 'Masculin', 'Boxe', 'Senior', -75, null]],
  }));
  expect((await commit(up)).json()).toMatchObject({ created: 1 });
  const rows = await regs();
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((r) => r.fighterId)).size).toBe(1);
});

test('lien de club « à vérifier » non confirmé : pas mémorisé, combattants laissés de côté ; fichier purgé après import', async () => {
  const file = buildFfkWorkbook({ Karate: [['NOUVEAU X', null, 'Z1', SHIN, 'Masculin', 'Karate', 'Senior', -75, null]] });
  await newClub('Shinsengumi');
  const up = await uploadAll(file);
  const p = await preview(up);
  expect(p.clubs[0]).toMatchObject({ target: null, proposal: { certainty: 'doubtful' } });
  expect((await commit(up, {}, p.fingerprint)).json()).toEqual({ created: 0, updated: 0, deleted: 0, weightClassesCreated: 0, leftAside: 1 });
  expect(counts()).toEqual({ f: 0, r: 0 });
  expect(sqlAll('select ffk_entity as e from clubs')).toEqual([{ e: null }]);
  expect(sqlAll('select * from club_aliases')).toEqual([]);
  // Fichier purgé après l'import
  expect((await json('POST', `${base}/ffk-imports/${up.uploadId}/preview`, { sheets: up.sheets })).statusCode).toBe(404);
  // Réimport dans la même compétition, et autre compétition : toujours à vérifier.
  expect((await preview(await uploadAll(file))).clubs[0]).toMatchObject({ target: null, proposal: { certainty: 'doubtful' } });
  const other = `/api/competitions/${(await json('POST', '/api/competitions', { name: 'Autre', date: '2026-12-01' })).json().id}`;
  await newClub('Shinsengumi', other);
  const up2 = (await send(`${other}/ffk-imports`, file)).json() as Upload;
  expect((await preview(up2, {}, other)).clubs[0]).toMatchObject({ target: null, proposal: { certainty: 'doubtful' } });
});

test('loadExisting : N° d’affiliation du club, sinon de sa fiche d’annuaire ; « » effacé ne se rabat pas sur l’annuaire', async () => {
  const ids = { own: await newClub('Propre'), cleared: await newClub('Efface'), directory: await newClub('Annuaire'), unlinked: await newClub('Sans Fiche') };
  const entryOf = (id: string) => sqlAll<{ d: string }>('select directory_club_id as d from clubs where id = ?', id)[0]!.d;
  sqlRun('update club_directory set affiliation_number = ? where id = ?', '0000009', entryOf(ids.own));
  sqlRun('update clubs set affiliation_number = ? where id = ?', '0000001', ids.own);
  sqlRun('update club_directory set affiliation_number = ? where id = ?', '0000002', entryOf(ids.cleared));
  sqlRun('update clubs set affiliation_number = ? where id = ?', '', ids.cleared);
  sqlRun('update club_directory set affiliation_number = ? where id = ?', '0000003', entryOf(ids.directory));
  sqlRun('update clubs set directory_club_id = null, affiliation_number = null where id = ?', ids.unlinked);
  const repoDb = openDb(dbPath);
  try {
    const clubs = (await loadExisting(repoDb, base.split('/').pop()!)).clubs;
    expect(Object.fromEntries(clubs.map((c) => [c.id, c.affiliationNumber]))).toEqual({ [ids.own]: '0000001', [ids.cleared]: null, [ids.directory]: '0000003', [ids.unlinked]: null });
  } finally {
    repoDb.$client.close();
  }
});
