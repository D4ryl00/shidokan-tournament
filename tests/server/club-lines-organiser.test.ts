import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { buildApp } from '../../src/server/app.js';
import { openDb } from '../../src/server/db/client.js';
import { importClubForm } from '../../src/server/repositories/registrations.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let base: string;
let compId: string;
let clubId: string;
let token: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ clubServices: true, dbPath });
  compId = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22', location: 'Nice' } })).json().id;
  base = `/api/competitions/${compId}`;
  clubId = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Tani Dojo' } })).json().id;
});
afterEach(async () => app.close());

const LINE: ClubFormLine = {
  lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', weightClassId: 'senior:F:-55', weightKg: 53.5, combats: ['karate'], kata: true, grade: '1er kyu',
  ruleset: 'jiyu', prefs: {}, shobuKeep: null,
};
type Line = { fighterId: string; clubId: string; version: string; publicNameHidden: boolean; line: ClubFormLine; editable: boolean; reason: string | null; notices: string[] };
const post = (line: ClubFormLine = LINE, publicNameHidden = false, club = clubId) => app.inject({ method: 'POST', url: `${base}/clubs/${club}/lines`, payload: { line, publicNameHidden } });
const put = (l: { fighterId: string; version: string }, line: ClubFormLine, publicNameHidden = false, club = clubId) =>
  app.inject({ method: 'PUT', url: `${base}/clubs/${club}/lines/${l.fighterId}`, payload: { line, version: l.version, publicNameHidden } });
const current = async (fighterId: string) => (await app.inject({ method: 'GET', url: `${base}/fighters/${fighterId}/line` })).json() as Line;
type Reg = { id: string; discipline: string; source: string; weightClassId: string | null; categoryId: string | null; fighter: { id: string; clubId: string | null } };
const registrations = async () => (await app.inject({ method: 'GET', url: `${base}/registrations` })).json() as Reg[];
const raw = <T = unknown>(sql: string, ...params: unknown[]) => {
  const db = new Database(dbPath);
  const stmt = db.prepare(sql);
  const out = (stmt.reader ? stmt.all(...params) : (stmt.run(...params), [])) as T[];
  db.close();
  return out;
};
const setMultiple = (on: boolean) => app.inject({ method: 'PATCH', url: base, payload: { settings: { multipleCombatDisciplinesPerDay: on } } });
const manual = (discipline: string, extra: object = {}) =>
  app.inject({ method: 'POST', url: `${base}/registrations`, payload: { clubId, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId: discipline === 'kata' ? null : 'senior:F:-55', source: 'manual', ...extra } });
const closeCells = (cells: object[]) => app.inject({ method: 'PUT', url: `${base}/closed-categories`, payload: { cells, closed: true } });

test('organiser adds a fighter: registrations are onsite', async () => {
  const res = await post();
  expect(res.statusCode, res.body).toBe(201);
  expect(res.json()).toMatchObject({ clubId, editable: true });
  expect((await registrations()).map((r) => [r.discipline, r.source]).sort()).toEqual([['karate', 'onsite'], ['kata', 'onsite']]);
});

test('editing keeps the existing source, a new discipline is onsite', async () => {
  const first = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  raw("update registrations set source = 'ffk'");
  const l = await current(first.fighterId);
  expect((await put(l, LINE)).statusCode).toBe(200);
  expect((await registrations()).map((r) => [r.discipline, r.source]).sort()).toEqual([['karate', 'ffk'], ['kata', 'onsite']]);
});

test('organiser may choose a closed category, with a notice', async () => {
  const cell = { ageBandCode: 'senior', sex: 'F', discipline: 'karate', ruleset: 'jiyu' };
  await closeCells([cell]);
  const res = await post({ ...LINE, kata: false, grade: null });
  expect(res.statusCode, res.body).toBe(201);
  expect((res.json() as Line).notices.join(' ')).toContain('Catégorie non ouverte à cette compétition');
});

test('sex and age of an FFK-confirmed fighter can change (organiser)', async () => {
  const first = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  raw('update registrations set ffk_confirmed = 1');
  const l = await current(first.fighterId);
  const res = await put(l, { ...LINE, kata: false, grade: null, sex: 'M', weightClassId: 'senior:M:-84', weightKg: 80 });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().line).toMatchObject({ sex: 'M', weightClassId: 'senior:M:-84' });
  expect((await registrations())[0]!.weightClassId).toBe('senior:M:-84');
});

test('organiser changes the weight class of an FFK-confirmed fighter (same sex and age): the choice wins', async () => {
  const first = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  raw('update registrations set ffk_confirmed = 1');
  const l = await current(first.fighterId);
  const res = await put(l, { ...l.line, weightClassId: 'senior:F:-61' });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().line).toMatchObject({ weightClassId: 'senior:F:-61' });
  expect((await registrations())[0]!.weightClassId).toBe('senior:F:-61');
});

test('organiser weight class change on a reassigned FFK-confirmed registration: declared value updated, placement unchanged', async () => {
  const l = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  const [reg] = await registrations();
  raw("update registrations set ffk_confirmed = 1, discipline = 'shido-mix', weight_class_id = 'senior:F:-68', original_json = ? where id = ?", JSON.stringify({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:F:-55' }), reg!.id);
  const cur = await current(l.fighterId);
  expect((await put(cur, { ...cur.line, weightClassId: 'senior:F:-61' })).statusCode).toBe(200);
  const [row] = raw<{ weight_class_id: string; original_json: string }>('select weight_class_id, original_json from registrations');
  expect(row!.weight_class_id).toBe('senior:F:-68');
  expect(JSON.parse(row!.original_json)).toMatchObject({ weightClassId: 'senior:F:-61' });
});

test('age band of an FFK-confirmed fighter can change: the line weight class wins (organiser)', async () => {
  const first = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  raw('update registrations set ffk_confirmed = 1');
  const l = await current(first.fighterId);
  const res = await put(l, { ...LINE, kata: false, grade: null, ageBandCode: 'junior', weightClassId: 'junior:F:-53' });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().line).toMatchObject({ ageBandCode: 'junior', weightClassId: 'junior:F:-53' });
  expect((await registrations())[0]!.weightClassId).toBe('junior:F:-53');
});

const MULTIPLE_OFF = 'Plusieurs disciplines de combat, alors que le réglage de la compétition n’en prévoit qu’une par jour.';

test('setting off: the organiser still enters two combats, with a notice; the coach is refused', async () => {
  await setMultiple(false);
  const two: ClubFormLine = { ...LINE, kata: false, grade: null, combats: ['karate', 'shido-boxing'] };
  const res = await post(two);
  expect(res.statusCode, res.body).toBe(201);
  expect(res.json().notices).toContain(MULTIPLE_OFF);
  expect((await registrations()).map((r) => r.discipline).sort()).toEqual(['karate', 'shido-boxing']);
  // Un seul combat : plus d'avis.
  const l = await current(res.json().fighterId);
  expect((await put(l, { ...two, combats: ['karate'] })).json().notices).not.toContain(MULTIPLE_OFF);
  // Le coach : refusé.
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entryId = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Coach Dojo' } })).json().id;
  await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } });
  const [row] = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json();
  const t = (await app.inject({ method: 'POST', url: `${base}/invitations/${row.clubId}/links` })).json().token;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
  const coach = await app.inject({ method: 'POST', url: `/api/inscription/${t}/lines`, payload: { line: { ...two, lastName: 'COACH' } } });
  expect(coach.statusCode).toBe(400);
  expect(coach.json().issues).toContain('Une seule discipline de combat par combattant à cette compétition.');
});

test('two combats accepted when the setting is on (organiser and coach)', async () => {
  await setMultiple(true);
  const two: ClubFormLine = { ...LINE, kata: false, grade: null, combats: ['karate', 'shido-boxing'] };
  expect((await post(two)).statusCode).toBe(201);
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entryId = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Autre Dojo' } })).json().id;
  await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } });
  const [row] = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json();
  token = (await app.inject({ method: 'POST', url: `${base}/invitations/${row.clubId}/links` })).json().token;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
  const res = await app.inject({ method: 'POST', url: `/api/inscription/${token}/lines`, payload: { line: { ...two, lastName: 'DURAND' } } });
  expect(res.statusCode, res.body).toBe(201);
});

const startKarate = async () => raw("update categories set status = 'started' where id = ?", (await registrations()).find((r) => r.discipline === 'karate')!.categoryId);
const KARATE_STARTED = 'Karaté : commencé, ne se change plus ici (catégorie : Réaffectation ou Tableaux). Le nom, le prénom, le grade, l’affichage du nom et les autres disciplines se corrigent encore.';

test('started category: names, grade and public name are corrected; the started combat and the identity stay', async () => {
  const l = (await post()).json() as Line;
  const regsBefore = await registrations();
  await startKarate();
  const cur = await current(l.fighterId);
  expect(cur).toMatchObject({ editable: false, partlyEditable: true, startedDisciplines: ['karate'], reason: KARATE_STARTED });
  // Sexe, âge, poids, règlement : ignorés (un combat a commencé).
  const res = await put(cur, { ...LINE, lastName: ' MARTINEZ ', firstName: 'Léna', grade: '1er dan', weightClassId: 'senior:F:-61', sex: 'M', ruleset: 'shobu' }, true);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json()).toMatchObject({ editable: false, partlyEditable: true, publicNameHidden: true, line: { lastName: 'MARTINEZ', firstName: 'Léna', grade: '1er dan', sex: 'F', weightClassId: 'senior:F:-55', ruleset: 'jiyu', combats: ['karate'], kata: true } });
  const [f] = raw<{ last_name: string; first_name: string; grade: string; name_key: string }>('select last_name, first_name, grade, name_key from fighters');
  expect(f).toMatchObject({ last_name: 'MARTINEZ', first_name: 'Léna', grade: '1er dan', name_key: 'MARTINEZ LENA' });
  expect((await registrations()).map((r) => [r.id, r.categoryId, r.weightClassId])).toEqual(regsBefore.map((r) => [r.id, r.categoryId, r.weightClassId]));
});

test('started category: another discipline is added or removed; the started one is untouched and cannot be removed', async () => {
  await setMultiple(false);
  const l = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  const [karate] = await registrations();
  await startKarate();
  // Ajout d'un 2e combat et du kata (réglage désactivé : l'organisateur le peut, avec l'avis).
  const cur = await current(l.fighterId);
  const added = await put(cur, { ...cur.line, combats: ['karate', 'shido-boxing'], kata: true, grade: '2e kyu' });
  expect(added.statusCode, added.body).toBe(200);
  expect(added.json().notices).toContain(MULTIPLE_OFF);
  const regs = await registrations();
  expect(regs.map((r) => r.discipline).sort()).toEqual(['karate', 'kata', 'shido-boxing']);
  expect(regs.find((r) => r.discipline === 'shido-boxing')).toMatchObject({ weightClassId: 'senior:F:-55', source: 'onsite' });
  expect(regs.find((r) => r.id === karate!.id)).toMatchObject({ categoryId: karate!.categoryId, weightClassId: karate!.weightClassId });
  // Le boxing retiré (pas commencé) : retiré. Le karaté retiré (commencé) : refusé.
  const again = await current(l.fighterId);
  expect((await put(again, { ...again.line, combats: ['karate'] })).statusCode).toBe(200);
  expect((await registrations()).map((r) => r.discipline).sort()).toEqual(['karate', 'kata']);
  const last = await current(l.fighterId);
  const refused = await put(last, { ...last.line, combats: [] });
  expect(refused.statusCode).toBe(409);
  expect(refused.json().error).toBe('Karaté : commencé, ne se retire pas.');
});

test('only the kata has started: weight class and ruleset of a new combat are chosen; sex and age stay', async () => {
  const l = (await post({ ...LINE, combats: [], ruleset: null, weightClassId: null })).json() as Line;
  raw("update categories set status = 'started' where id = ?", (await registrations())[0]!.categoryId);
  const cur = await current(l.fighterId);
  expect(cur).toMatchObject({ partlyEditable: true, startedDisciplines: ['kata'] });
  const res = await put(cur, { ...cur.line, combats: ['karate'], ruleset: 'shobu', weightClassId: 'senior:F:-61', ageBandCode: 'junior' });
  expect(res.statusCode, res.body).toBe(200);
  expect((await registrations()).find((r) => r.discipline === 'karate')).toMatchObject({ weightClassId: 'senior:F:-61' });
  expect(res.json().line).toMatchObject({ ageBandCode: 'senior', ruleset: 'shobu' });
});

test('started category: no club change, no delete, no empty name, stale version refused', async () => {
  const other = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Autre club' } })).json().id as string;
  const l = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  await startKarate();
  const cur = await current(l.fighterId);
  const moved = await put(cur, cur.line, false, other);
  expect(moved.statusCode).toBe(409);
  expect(moved.json().error).toBe(KARATE_STARTED);
  const del = await app.inject({ method: 'DELETE', url: `${base}/clubs/${clubId}/lines/${cur.fighterId}?version=${encodeURIComponent(cur.version)}` });
  expect(del.statusCode).toBe(409);
  expect((await put(cur, { ...cur.line, lastName: '  ' })).statusCode).toBe(400);
  expect((await put({ fighterId: cur.fighterId, version: 'perimee' }, { ...cur.line, lastName: 'X' })).statusCode).toBe(409);
  // Un homonyme du club est refusé comme d'habitude.
  await post({ ...LINE, lastName: 'DUPONT', kata: false, grade: null });
  const dup = await put(cur, { ...cur.line, lastName: 'DUPONT' });
  expect(dup.statusCode).toBe(400);
  expect(dup.json().issues).toEqual(['DUPONT Léa est déjà dans la liste.']);
});

test('started category: the coach still cannot correct anything', async () => {
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entryId = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Coach Dojo' } })).json().id;
  await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } });
  const [row] = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json();
  const t = (await app.inject({ method: 'POST', url: `${base}/invitations/${row.clubId}/links` })).json().token;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
  const url = `/api/inscription/${t}/lines`;
  const a = (await app.inject({ method: 'POST', url, payload: { line: { ...LINE, kata: false, grade: null } } })).json() as Line;
  raw("update categories set status = 'started' where id = ?", (await registrations())[0]!.categoryId);
  const view = (await app.inject({ method: 'GET', url: `/api/inscription/${t}` })).json() as { lines: Line[] };
  expect(view.lines[0]).toMatchObject({ editable: false, partlyEditable: false, reason: 'Ses combats ont commencé : contactez l’organisateur.' });
  const res = await app.inject({ method: 'PUT', url: `${url}/${a.fighterId}`, payload: { line: { ...LINE, lastName: 'AUTRE' }, version: view.lines[0]!.version } });
  expect(res.statusCode).toBe(409);
});

test('reassigned registration: only the declared values change', async () => {
  const l = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  const [reg] = await registrations();
  raw("update registrations set discipline = 'shido-mix', weight_class_id = 'senior:F:-68', original_json = ? where id = ?", JSON.stringify({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'senior:F:-55' }), reg!.id);
  const cur = await current(l.fighterId);
  expect(cur.line).toMatchObject({ combats: ['karate'], weightClassId: 'senior:F:-55' });
  expect((await put(cur, { ...cur.line, weightClassId: 'senior:F:-61' })).statusCode).toBe(200);
  const [row] = raw<{ discipline: string; weight_class_id: string; original_json: string }>('select discipline, weight_class_id, original_json from registrations');
  expect(row!.discipline).toBe('shido-mix');
  expect(row!.weight_class_id).toBe('senior:F:-68');
  expect(JSON.parse(row!.original_json)).toMatchObject({ discipline: 'karate', weightClassId: 'senior:F:-61' });
});

test('stale version is refused', async () => {
  const l = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  const res = await put({ fighterId: l.fighterId, version: 'perimee' }, LINE);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Ce combattant a été modifié entre-temps : la liste a été rechargée.');
});

test('changing club moves the fighter; a duplicate name in the new club is refused', async () => {
  const other = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Autre club' } })).json().id as string;
  const l = await current(((await post()).json() as Line).fighterId);
  const res = await put(l, LINE, false, other);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().clubId).toBe(other);
  expect(raw<{ club_id: string }>('select club_id from fighters')[0]!.club_id).toBe(other);
  // Un homonyme dans le club d'arrivée.
  const twin = await current(((await post(LINE, false, clubId)).json() as Line).fighterId);
  const dup = await put(twin, LINE, false, other);
  expect(dup.statusCode).toBe(400);
  expect(dup.json().issues).toEqual(['MARTIN Léa est déjà dans la liste.']);
});

test('publicNameHidden is saved with the line (organiser and coach)', async () => {
  const l = await current(((await post(LINE, true)).json() as Line).fighterId);
  expect(l.publicNameHidden).toBe(true);
  expect(raw<{ public_name_hidden: number }>('select public_name_hidden from fighters')[0]!.public_name_hidden).toBe(1);
  expect((await put(l, LINE, false)).json().publicNameHidden).toBe(false);
  // Coach : absent = inchangé, true = masqué.
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entryId = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Coach Dojo' } })).json().id;
  await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } });
  const [row] = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json();
  const t = (await app.inject({ method: 'POST', url: `${base}/invitations/${row.clubId}/links` })).json().token;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
  const url = `/api/inscription/${t}/lines`;
  const a0 = (await app.inject({ method: 'POST', url, payload: { line: { ...LINE, lastName: 'COACH' }, publicNameHidden: true } })).json() as Line;
  expect(a0.publicNameHidden).toBe(true);
  const a = await current(a0.fighterId);
  const b = await app.inject({ method: 'PUT', url: `${url}/${a.fighterId}`, payload: { line: { ...LINE, lastName: 'COACH' }, version: a.version } });
  expect(b.json().publicNameHidden).toBe(true);
});

test('delete removes the fighter; GET of an unknown fighter is 404; a fighter without club is not editable', async () => {
  const l = await current(((await post()).json() as Line).fighterId);
  expect((await app.inject({ method: 'DELETE', url: `${base}/clubs/${clubId}/lines/${l.fighterId}?version=${encodeURIComponent(l.version)}` })).statusCode).toBe(204);
  expect(await registrations()).toEqual([]);
  expect((await app.inject({ method: 'GET', url: `${base}/fighters/inconnu/line` })).statusCode).toBe(404);
  await manual('kata', { clubId: null, lastName: 'SOLO' });
  const solo = (await registrations())[0]!.fighter.id;
  expect(await current(solo)).toMatchObject({ clubId: '', editable: false, reason: null });
});

test('a fighter without club whose category has started keeps the locked reason', async () => {
  await manual('kata', { clubId: null, lastName: 'SOLO' });
  const reg = (await registrations())[0]!;
  raw("update categories set status = 'started' where id = ?", reg.categoryId);
  const solo = await current(reg.fighter.id);
  expect(solo).toMatchObject({ clubId: '', editable: false });
  expect(solo.reason).toBeTruthy();
});

test('the « main ailleurs » guard refuses the organiser routes', async () => {
  const l = await current(((await post()).json() as Line).fighterId);
  raw("update competitions set owner_instance_id = 'autre-pc' where id = ?", compId);
  expect((await post({ ...LINE, lastName: 'AUTRE' })).statusCode).toBe(409);
  expect((await put(l, LINE)).statusCode).toBe(409);
  expect((await app.inject({ method: 'DELETE', url: `${base}/clubs/${clubId}/lines/${l.fighterId}?version=x` })).statusCode).toBe(409);
});

test('delete with the fighter’s own club works for the organiser after a club change in the window', async () => {
  const other = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Autre club' } })).json().id as string;
  const l = await current(((await post()).json() as Line).fighterId);
  // La fenêtre a choisi un autre club que celui du combattant : la suppression vise quand même le combattant.
  expect((await app.inject({ method: 'DELETE', url: `${base}/clubs/${other}/lines/${l.fighterId}?version=${encodeURIComponent(l.version)}` })).statusCode).toBe(204);
  expect(await registrations()).toEqual([]);
});

test('.ods import adds the file’s e-mails to the club’s, without duplicates', async () => {
  raw('update clubs set coach_emails = ? where id = ?', JSON.stringify(['Coach@Tani.example', 'a@tani.example']), clubId);
  const db = openDb(dbPath);
  await importClubForm(db, compId, { header: { club: 'Tani Dojo', coachName: null, coachPhone: null, coachEmails: ['coach@tani.example', 'b@tani.example'], preApproval: false }, rows: [] }, { replace: true, clubId });
  db.$client.close();
  expect(JSON.parse(raw<{ coach_emails: string }>('select coach_emails from clubs where id = ?', clubId)[0]!.coach_emails)).toEqual(['Coach@Tani.example', 'a@tani.example', 'b@tani.example']);
});

test('the version returned by a save is the one after the categories are rebuilt: a second save on it works (organiser and coach)', async () => {
  const created = (await post({ ...LINE, kata: false, grade: null })).json() as Line;
  const first = await put(created, { ...LINE, kata: false, grade: null, weightClassId: 'senior:F:-61' });
  expect(first.statusCode, first.body).toBe(200);
  const second = await put(first.json() as Line, { ...LINE, kata: false, grade: null, weightClassId: 'senior:F:-68' });
  expect(second.statusCode, second.body).toBe(200);
  // Coach
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmails: [], notes: null };
  const entryId = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Coach Dojo' } })).json().id;
  await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } });
  const [row] = (await app.inject({ method: 'GET', url: `${base}/invitations` })).json();
  const t = (await app.inject({ method: 'POST', url: `${base}/invitations/${row.clubId}/links` })).json().token;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
  const url = `/api/inscription/${t}/lines`;
  const c0 = (await app.inject({ method: 'POST', url, payload: { line: { ...LINE, lastName: 'COACH', kata: false, grade: null } } })).json() as Line;
  const c1 = await app.inject({ method: 'PUT', url: `${url}/${c0.fighterId}`, payload: { line: { ...LINE, lastName: 'COACH', kata: false, grade: null, weightClassId: 'senior:F:-61' }, version: c0.version } });
  expect(c1.statusCode, c1.body).toBe(200);
  const c2 = await app.inject({ method: 'PUT', url: `${url}/${c0.fighterId}`, payload: { line: { ...LINE, lastName: 'COACH', kata: false, grade: null, weightClassId: 'senior:F:-68' }, version: (c1.json() as Line).version } });
  expect(c2.statusCode, c2.body).toBe(200);
});
