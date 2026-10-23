import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ClubFormLine } from '../../src/domain/club-form.js';
import { TWO_COMBATS_REASON } from '../../src/domain/club-line.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let dbPath: string;
let base: string;
let token: string;
let clubId: string;
let entryId: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22', location: 'Nice' } })).json().id}`;
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmail: null, notes: null };
  entryId = (await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Tani Dojo', coachPhone: '0600000000' } })).json().id;
  const [link] = (await app.inject({ method: 'POST', url: `${base}/invitations`, payload: { directoryIds: [entryId] } })).json();
  token = link.token;
  clubId = link.clubId;
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open', deadline: '2026-11-15' } });
});
afterEach(async () => app.close());

const LINE: ClubFormLine = {
  lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', weightKg: 53.5, combat: 'karate', kata: true, grade: '1er kyu',
  ruleset: 'jiyu', prefs: { 'shido-mix': 1 }, shobuKeep: null,
};
const url = (path = '') => `/api/inscription/${token}${path}`;
type View = {
  competition: { name: string; status: string; deadline: string | null }; editable: boolean;
  club: { name: string; coachPhone: string | null; affiliationNumber: string | null };
  ageBands: { code: string }[];
  lines: { fighterId: string; version: string; line: ClubFormLine; editable: boolean; reason: string | null }[];
};
const view = async () => (await app.inject({ method: 'GET', url: url() })).json() as View;
const add = (line: ClubFormLine = LINE) => app.inject({ method: 'POST', url: url('/lines'), payload: { line } });
const put = (fighterId: string, line: ClubFormLine, version: string) => app.inject({ method: 'PUT', url: url(`/lines/${fighterId}`), payload: { line, version } });
type Reg = { id: string; discipline: string; source: string; weightClassId: string | null; categoryId: string | null; fighter: { id: string; lastName: string } };
const registrations = async () => (await app.inject({ method: 'GET', url: `${base}/registrations` })).json() as Reg[];
const raw = (sql: string, ...params: unknown[]) => {
  const db = new Database(dbPath);
  db.prepare(sql).run(...params);
  db.close();
};

test('GET : compétition, en-tête, tranches proposées, lignes de tous les combattants du club, d’aucun autre club', async () => {
  // Combattant saisi par l'organisateur dans le club, et un autre club.
  await app.inject({ method: 'POST', url: `${base}/registrations`, payload: { clubId, lastName: 'DURAND', firstName: 'Hugo', sex: 'M', ageBandCode: 'senior', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' } });
  const other = (await app.inject({ method: 'POST', url: `${base}/clubs`, payload: { name: 'Autre club' } })).json().id;
  await app.inject({ method: 'POST', url: `${base}/registrations`, payload: { clubId: other, lastName: 'PETIT', firstName: 'Noé', sex: 'M', ageBandCode: 'senior', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' } });
  expect((await add()).statusCode).toBe(201);
  const v = await view();
  expect(v.competition).toMatchObject({ name: 'Coupe', status: 'open', deadline: '2026-11-15' });
  expect(v.editable).toBe(true);
  expect(v.club).toMatchObject({ name: 'Tani Dojo', coachPhone: '0600000000' });
  expect(v.ageBands.map((b) => b.code)).toContain('senior');
  expect(v.lines.map((l) => l.line.lastName)).toEqual(['DURAND', 'MARTIN']);
});

test('lien inconnu → 404 « Lien inconnu ou expiré. » ; révoqué → 410', async () => {
  const unknown = await app.inject({ method: 'GET', url: '/api/inscription/inconnu' });
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json().error).toBe('Lien inconnu ou expiré.');
  await app.inject({ method: 'DELETE', url: `${base}/invitations/${clubId}` });
  expect((await app.inject({ method: 'GET', url: url() })).statusCode).toBe(410); // lien révoqué : « remplacé »
});

test('ajouter une ligne combat + kata → deux inscriptions « online », catégorie de poids déduite ; GET la renvoie identique', async () => {
  const res = await add();
  expect(res.statusCode).toBe(201);
  const regs = await registrations();
  expect(regs.map((r) => [r.discipline, r.source]).sort()).toEqual([['karate', 'online'], ['kata', 'online']]);
  expect(regs.find((r) => r.discipline === 'karate')!.weightClassId).toMatch(/^senior:F:/);
  expect(regs.every((r) => r.categoryId)).toBe(true);
  expect((await view()).lines[0]!.line).toEqual(LINE);
});

test('ligne invalide → 400 avec les messages ; doublon de nom → 400', async () => {
  const bad = await add({ ...LINE, sex: null, ruleset: null });
  expect(bad.statusCode).toBe(400);
  expect(bad.json().issues).toContain('Sexe manquant.');
  await add();
  const dup = await add();
  expect(dup.statusCode).toBe(400);
  expect(dup.json().issues).toEqual(['MARTIN Léa est déjà dans la liste.']);
});

test('changer karaté → boxing : l’inscription karaté disparaît, une seule inscription de combat', async () => {
  await add();
  const [line] = (await view()).lines;
  const res = await put(line!.fighterId, { ...LINE, combat: 'shido-boxing' }, line!.version);
  expect(res.statusCode).toBe(200);
  const regs = await registrations();
  expect(regs.map((r) => r.discipline).sort()).toEqual(['kata', 'shido-boxing']);
  expect(regs.every((r) => r.categoryId)).toBe(true);
});

test('retirer le kata → l’inscription kata est supprimée, le combattant reste', async () => {
  await add();
  const [line] = (await view()).lines;
  expect((await put(line!.fighterId, { ...LINE, kata: false, grade: null }, line!.version)).statusCode).toBe(200);
  expect((await registrations()).map((r) => r.discipline)).toEqual(['karate']);
});

test('combattant FFK corrigé → origine « ffk » et catégorie de poids FFK gardées', async () => {
  await add({ ...LINE, kata: false, grade: null });
  const [reg] = await registrations();
  const grid = (await app.inject({ method: 'GET', url: `${base}/grid` })).json() as { weightClasses: { id: string; ageBandCode: string; sex: string }[] };
  const ffkClass = grid.weightClasses.filter((w) => w.ageBandCode === 'senior' && w.sex === 'F').at(-1)!.id;
  raw("update registrations set source = 'ffk', ffk_confirmed = 1, weight_class_id = ? where id = ?", ffkClass, reg!.id);
  const [line] = (await view()).lines;
  expect((await put(line!.fighterId, { ...LINE, kata: false, grade: null, ruleset: 'shobu', shobuKeep: 'discipline' }, line!.version)).statusCode).toBe(200);
  const [after] = await registrations();
  expect(after).toMatchObject({ id: reg!.id, source: 'ffk', weightClassId: ffkClass });
});

test('version périmée (l’organisateur a modifié entre-temps) → 409, rien n’est écrit', async () => {
  await add({ ...LINE, kata: false, grade: null });
  const [line] = (await view()).lines;
  const [reg] = await registrations();
  const organizer = await app.inject({ method: 'PUT', url: `${base}/registrations/${reg!.id}`, payload: { clubId, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', discipline: 'karate', ruleset: 'shobu', weightClassId: reg!.weightClassId, source: 'online' } });
  expect(organizer.statusCode, organizer.body).toBe(200);
  const res = await put(line!.fighterId, { ...LINE, kata: false, grade: null, firstName: 'Lea' }, line!.version);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Ce combattant a été modifié entre-temps : la liste a été rechargée.');
  expect((await registrations())[0]!.fighter.lastName).toBe('MARTIN');
  expect((await view()).lines[0]!.line).toMatchObject({ firstName: 'Léa', ruleset: 'shobu' });
});

test('supprimer une ligne → inscriptions et combattant supprimés ; version périmée → 409', async () => {
  await add();
  const [line] = (await view()).lines;
  expect((await app.inject({ method: 'DELETE', url: url(`/lines/${line!.fighterId}?version=perimee`) })).statusCode).toBe(409);
  expect((await app.inject({ method: 'DELETE', url: url(`/lines/${line!.fighterId}?version=${encodeURIComponent(line!.version)}`) })).statusCode).toBe(204);
  expect(await registrations()).toEqual([]);
  expect((await view()).lines).toEqual([]);
});

test('catégorie commencée → modifier et supprimer refusés (409) ; la ligne est verrouillée', async () => {
  await add();
  const [reg] = await registrations();
  raw("update categories set status = 'started' where id = ?", reg!.categoryId);
  const [line] = (await view()).lines;
  expect(line).toMatchObject({ editable: false, reason: 'Ses combats ont commencé : contactez l’organisateur.' });
  expect((await put(line!.fighterId, { ...LINE, firstName: 'Lea' }, line!.version)).statusCode).toBe(409);
  expect((await app.inject({ method: 'DELETE', url: url(`/lines/${line!.fighterId}?version=${encodeURIComponent(line!.version)}`) })).statusCode).toBe(409);
});

test('deux disciplines de combat → ligne en lecture seule', async () => {
  await add({ ...LINE, kata: false, grade: null });
  const [reg] = await registrations();
  await app.inject({ method: 'POST', url: `${base}/registrations`, payload: { clubId, lastName: 'MARTIN', firstName: 'Léa', sex: 'F', ageBandCode: 'senior', discipline: 'shido-boxing', ruleset: 'jiyu', weightClassId: reg!.weightClassId!.replace('senior:F', 'senior:F'), source: 'manual' } });
  const [line] = (await view()).lines;
  expect(line).toMatchObject({ editable: false, reason: TWO_COMBATS_REASON });
  expect((await put(line!.fighterId, LINE, line!.version)).statusCode).toBe(409);
});

test('inscriptions figées, fermées ou gérées ailleurs → lecture seule ; toute écriture → 403', async () => {
  await add();
  const [line] = (await view()).lines;
  const closed = async () => {
    const v = await view();
    expect(v.editable).toBe(false);
    for (const res of [
      await add({ ...LINE, lastName: 'NOUVEAU' }),
      await put(line!.fighterId, LINE, line!.version),
      await app.inject({ method: 'DELETE', url: url(`/lines/${line!.fighterId}?version=${encodeURIComponent(line!.version)}`) }),
      await app.inject({ method: 'PATCH', url: url('/club'), payload: { coachName: 'X', coachPhone: null, coachEmail: null, preApproval: false, affiliationNumber: null } }),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Les inscriptions sont closes : contactez l’organisateur.');
    }
  };
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'frozen' } });
  await closed();
  await app.inject({ method: 'PATCH', url: `${base}/club-entry`, payload: { status: 'open' } });
  raw("update competitions set owner_instance_id = 'autre-pc'");
  await closed();
});

test('en-tête : club et annuaire mis à jour ; n° d’affiliation libre, ou en conflit avec le numéro déjà connu', async () => {
  const header = { coachName: 'Jean', coachPhone: '0611111111', coachEmail: 'jean@tani.example', preApproval: true, affiliationNumber: '0060893' };
  const res = await app.inject({ method: 'PATCH', url: url('/club'), payload: header });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ ...header, name: 'Tani Dojo' });
  const clubs = (await app.inject({ method: 'GET', url: `${base}/clubs` })).json() as { coachName: string; preApproval: boolean }[];
  expect(clubs[0]).toMatchObject({ coachName: 'Jean', preApproval: true });
  const dir = (await app.inject({ method: 'GET', url: '/api/club-directory' })).json() as { id: string; coachPhone: string; affiliationNumber: string }[];
  expect(dir.find((e) => e.id === entryId)).toMatchObject({ coachPhone: '0611111111', affiliationNumber: '0060893' });
  const conflict = await app.inject({ method: 'PATCH', url: url('/club'), payload: { ...header, affiliationNumber: '0130002' } }); // numéro libre, mais le club en a déjà un
  expect(conflict.statusCode).toBe(400);
  expect(conflict.json().error).toBe('Ce club a déjà le numéro d’affiliation 0060893 : contactez l’organisateur.');
});

test('inscription supprimée par l’organisateur pendant que le coach a le formulaire ouvert → 409, rien n’est recréé', async () => {
  await add();
  const [line] = (await view()).lines;
  const karate = (await registrations()).find((r) => r.discipline === 'karate')!;
  expect((await app.inject({ method: 'DELETE', url: `${base}/registrations/${karate.id}` })).statusCode).toBe(204);
  const res = await put(line!.fighterId, LINE, line!.version);
  expect(res.statusCode).toBe(409);
  expect((await registrations()).map((r) => r.discipline)).toEqual(['kata']);
});

test('combattant confirmé par l’export FFK : sexe et catégorie d’âge non modifiables par le coach (400)', async () => {
  await add({ ...LINE, kata: false, grade: null });
  const [reg] = await registrations();
  raw('update registrations set ffk_confirmed = 1 where id = ?', reg!.id);
  const [line] = (await view()).lines;
  const res = await put(line!.fighterId, { ...LINE, kata: false, grade: null, sex: 'M', weightKg: 80 }, line!.version);
  expect(res.statusCode).toBe(400);
  expect(res.json().issues).toEqual(['Le sexe et la catégorie d’âge viennent de l’export FFK : contactez l’organisateur pour les changer.']);
  const again = await put(line!.fighterId, { ...LINE, kata: false, grade: null, ageBandCode: 'junior' }, line!.version);
  expect(again.statusCode).toBe(400);
});

test('en-tête : n° d’affiliation d’une autre fiche de l’annuaire → 400, rien n’est relié ni écrasé', async () => {
  const EMPTY = { affiliationNumber: null, coachName: null, coachPhone: null, coachEmail: null, notes: null };
  await app.inject({ method: 'POST', url: '/api/club-directory', payload: { ...EMPTY, name: 'Autre Club', affiliationNumber: '0069999', coachEmail: 'autre@club.example' } });
  const res = await app.inject({ method: 'PATCH', url: url('/club'), payload: { coachName: 'Jean', coachPhone: null, coachEmail: 'jean@tani.example', preApproval: false, affiliationNumber: '0069999' } });
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('Ce numéro d’affiliation est celui d’un autre club de l’annuaire : contactez l’organisateur.');
  const dir = (await app.inject({ method: 'GET', url: '/api/club-directory' })).json() as { name: string; coachEmail: string | null }[];
  expect(dir.find((e) => e.name === 'Autre Club')!.coachEmail).toBe('autre@club.example');
  expect(((await app.inject({ method: 'GET', url: `${base}/invitations` })).json() as { directoryClubId: string }[])[0]!.directoryClubId).toBe(entryId);
});

test('en-tête : n° d’affiliation de 7 chiffres exactement', async () => {
  const header = { coachName: null, coachPhone: null, coachEmail: null, preApproval: false };
  expect((await app.inject({ method: 'PATCH', url: url('/club'), payload: { ...header, affiliationNumber: '123' } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'PATCH', url: url('/club'), payload: { ...header, affiliationNumber: '0060893' } })).statusCode).toBe(200);
});

test('suppression sans version → 400 ; poids et nom bornés', async () => {
  await add();
  const [line] = (await view()).lines;
  expect((await app.inject({ method: 'DELETE', url: url(`/lines/${line!.fighterId}`) })).statusCode).toBe(400);
  expect((await add({ ...LINE, lastName: 'AUTRE', weightKg: 5000 })).statusCode).toBe(400);
  expect((await add({ ...LINE, lastName: 'X'.repeat(81) })).statusCode).toBe(400);
});

test('la vue contient la mention sur les données ; sans adresse de contact, pas de phrase de contact', async () => {
  const without = (await app.inject({ method: 'GET', url: url() })).json().privacyNotice as string;
  expect(without).toContain('traitées par Shidokan France');
  expect(without).not.toContain('{contact}');
  expect(without).not.toContain('exercer vos droits');
  await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { privacyContact: 'rgpd@shidokanfrance.com' } });
  const withContact = (await app.inject({ method: 'GET', url: url() })).json().privacyNotice as string;
  expect(withContact.endsWith('exercer vos droits sur ces données : rgpd@shidokanfrance.com.')).toBe(true);
});
