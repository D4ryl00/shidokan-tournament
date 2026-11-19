import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { AuthorizationClub, AuthorizationSituation } from '../../src/domain/authorizations.js';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { grantAnswer, listAnswers, removeAnswer } from '../../src/server/repositories/authorizations.js';
import { resetAsShown } from '../helpers/history-undo.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

describe('réponses enregistrées (dépôt)', () => {
  let db: AppDb;
  beforeEach(() => {
    db = openDb(tmpDbPath());
    db.$client.exec(`
      INSERT INTO competitions (id, name, date, settings_json) VALUES ('c1', 'Coupe', '2026-11-22', '{}'), ('c2', 'Autre', '2026-11-22', '{}');
      INSERT INTO fighters (id, competition_id, last_name, first_name, name_key, sex, age_band_code) VALUES ('f1', 'c1', 'A', 'a', 'a a', 'M', 'cadet');
      INSERT INTO registrations (id, competition_id, fighter_id, discipline, source) VALUES ('r1', 'c1', 'f1', 'karate', 'manual');
    `);
  });
  afterEach(() => closeDb(db));

  const weight = (gapKg: number): AuthorizationSituation => ({ kind: 'weight', ownClassId: 'a', heaviestClassId: 'b', gapKg });

  test('grantAnswer enregistre, listAnswers rend la réponse de la compétition', () => {
    grantAnswer(db, 'c1', 'r1', 'weight', weight(7));
    const answers = listAnswers(db, 'c1');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ registrationId: 'r1', kind: 'weight', situation: weight(7) });
    expect(Number.isNaN(Date.parse(answers[0]!.answeredAt))).toBe(false);
    expect(listAnswers(db, 'c2')).toEqual([]);
  });

  test('grantAnswer remplace la situation et la date (upsert)', () => {
    grantAnswer(db, 'c1', 'r1', 'weight', weight(7));
    grantAnswer(db, 'c1', 'r1', 'weight', weight(9));
    const answers = listAnswers(db, 'c1');
    expect(answers).toHaveLength(1);
    expect(answers[0]!.situation).toEqual(weight(9));
  });

  test('removeAnswer retire seulement le type demandé', () => {
    grantAnswer(db, 'c1', 'r1', 'weight', weight(7));
    grantAnswer(db, 'c1', 'r1', 'mixite', { kind: 'mixite' });
    removeAnswer(db, 'c1', 'r1', 'weight');
    expect(listAnswers(db, 'c1').map((a) => a.kind)).toEqual(['mixite']);
  });
});

describe('routes des autorisations', () => {
  let app: FastifyInstance;
  let base: string;
  let id: string;
  let dbPath: string;
  beforeEach(async () => {
    dbPath = tmpDbPath();
    app = await buildApp({ dbPath });
    id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
    base = `/api/competitions/${id}`;
  });
  afterEach(async () => app.close());

  type Row = AuthorizationClub['requests'][number];
  type List = { clubs: AuthorizationClub[]; pending: number };
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
  let n = 0;
  async function reg(over: object = {}) {
    n++;
    const res = await call('POST', '/registrations', {
      clubId: null, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
      weightClassId: 'cadet:F:-54', source: 'manual', ...over,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().row as { id: string; fighterId: string };
  }
  const catOf = async (registrationId: string) =>
    ((await call('GET', '/categories')).json() as { id: string; registrationIds: string[] }[]).find((c) => c.registrationIds.includes(registrationId))!;
  const move = async (registrationId: string, to: string) => {
    const res = await call('POST', '/replacement/move', { registrationId, categoryId: (await catOf(to)).id });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { historyId: string }).historyId;
  };
  const list = async (vague?: string) => {
    const res = await call('GET', `/authorizations${vague ? `?vague=${vague}` : ''}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as List;
  };
  const rows = async (vague?: string): Promise<Row[]> => (await list(vague)).clubs.flatMap((c) => c.requests);
  const grant = (registrationId: string, kind: string) => call('POST', '/authorizations/grant', { registrationId, kind });
  const ungrant = (registrationId: string, kind: string) => call('POST', '/authorizations/ungrant', { registrationId, kind });
  const read = <T>(sql: string, ...params: unknown[]): T[] => {
    const ro = new Database(dbPath, { readonly: true });
    try {
      return ro.prepare(sql).all(...params) as T[];
    } finally {
      ro.close();
    }
  };
  const answers = () => read<{ registration_id: string; kind: string }>('select registration_id, kind from authorization_answers where competition_id = ? order by registration_id, kind', id);
  const journal = () =>
    read<{ type: string; action: string; data_json: string }>('select type, action, data_json from journal_entries where competition_id = ? order by seq', id)
      .map((e) => ({ type: e.type, action: e.action, data: JSON.parse(e.data_json) as Record<string, unknown> }));

  /** LÉGÈRE (−47, 44 kg) déplacée chez LOURDE (−54, 50 kg : écart 6 kg) et MOYENNE (−54, 47 kg : écart 3 kg). */
  async function weightCase() {
    const light = await reg({ lastName: 'LEGERE', weightClassId: 'cadet:F:-47', approxWeightKg: 44 });
    const heavy = await reg({ lastName: 'LOURDE', approxWeightKg: 50 });
    const mid = await reg({ lastName: 'MOYENNE', approxWeightKg: 47 });
    const moveId = await move(light.id, heavy.id);
    return { light, heavy, mid, moveId };
  }

  test('déplacement à la main : la demande de poids, son déplacement en cause, en attente', async () => {
    const { light, moveId } = await weightCase();
    const all = await list();
    expect(all.pending).toBe(1);
    expect(all.clubs).toHaveLength(1);
    expect(all.clubs[0]).toMatchObject({ clubId: null, name: 'Sans club', preApproval: false });
    expect(all.clubs[0]!.requests).toEqual([
      expect.objectContaining({
        id: `weight:${light.id}`, registrationId: light.id, status: 'pending', answeredAt: null, label: 'LEGERE x', blame: [moveId], blocked: null,
        situation: { kind: 'weight', ownClassId: 'cadet:F:-47', heaviestClassId: 'cadet:F:-54', gapKg: 6 },
      }),
    ]);
  });

  test('« Accordée » : accordée ; une pesée qui creuse l’écart la remet en attente ; l’adversaire absent la fait disparaître', async () => {
    const { light, heavy } = await weightCase();
    const res = await grant(light.id, 'weight');
    expect(res.statusCode, res.body).toBe(200);
    const [granted] = await rows();
    expect(granted).toMatchObject({ status: 'granted', answeredAt: expect.any(String) });
    expect((await list()).pending).toBe(0);
    // Pesée de LOURDE à 52 kg : écart 8 kg, au-delà des 6 kg acceptés.
    expect((await call('PUT', `/weigh-in/${heavy.fighterId}`, { weighInKg: 52 })).statusCode).toBe(204);
    expect(await rows()).toEqual([expect.objectContaining({ id: `weight:${light.id}`, status: 'pending', situation: expect.objectContaining({ gapKg: 8 }) })]);
    // LOURDE absente : plus d'adversaire à plus de 5 kg (MOYENNE reste, écart 3 kg).
    expect((await call('PUT', `/weigh-in/${heavy.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);
    expect(await rows()).toEqual([]);
    expect((await list()).pending).toBe(0);
  });

  test('« Accordée » enregistre la situation recalculée par le serveur, et le journal le note', async () => {
    const { light } = await weightCase();
    const before = journal().length;
    // Une situation envoyée par le client est refusée (corps strict) : seule la demande actuelle compte.
    expect((await call('POST', '/authorizations/grant', { registrationId: light.id, kind: 'weight', situation: { kind: 'weight', gapKg: 99 } })).statusCode).toBe(400);
    expect((await grant(light.id, 'weight')).statusCode).toBe(200);
    const stored = read<{ situation_json: string }>('select situation_json from authorization_answers where registration_id = ?', light.id);
    expect(JSON.parse(stored[0]!.situation_json)).toEqual({ kind: 'weight', ownClassId: 'cadet:F:-47', heaviestClassId: 'cadet:F:-54', gapKg: 6 });
    const added = journal().slice(before);
    expect(added).toEqual([
      { type: 'autorisation', action: 'accordee', data: { subject: 'LEGERE x', detail: 'Poids · Écart de poids estimé avec ses adversaires : 6 kg maximum.' } },
    ]);
  });

  test('« annuler » : la réponse est retirée, la demande revient en attente ; journal « retiree » ; rien à retirer : rien de noté', async () => {
    const { light } = await weightCase();
    await grant(light.id, 'weight');
    const before = journal().length;
    expect((await ungrant(light.id, 'weight')).statusCode).toBe(200);
    expect(await rows()).toEqual([expect.objectContaining({ status: 'pending' })]);
    expect(answers()).toEqual([]);
    expect(journal().slice(before)).toEqual([
      { type: 'autorisation', action: 'retiree', data: { subject: 'LEGERE x', detail: 'Poids · Écart de poids estimé avec ses adversaires : 6 kg maximum.' } },
    ]);
    // Déjà retirée (autre poste) : rien ne change, pas même une entrée brute.
    expect((await ungrant(light.id, 'weight')).statusCode).toBe(200);
    expect(journal().slice(before)).toHaveLength(1);
  });

  test('« Accordée » sur une demande qui n’existe pas (ou plus) : 409, rien d’enregistré ; poids manquant : 400', async () => {
    const { mid, heavy, light } = await weightCase();
    const res = await grant(mid.id, 'weight');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Cette demande n’existe plus : la liste est mise à jour.' });
    expect((await call('PUT', `/weigh-in/${heavy.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);
    expect((await grant(light.id, 'weight')).statusCode).toBe(409);
    expect(answers()).toEqual([]);
    expect((await grant(light.id, 'missingWeight')).statusCode).toBe(400);
    expect(journal().filter((e) => e.type === 'autorisation' || String(e.data.route ?? '').includes('/authorizations'))).toEqual([]);
  });

  test('clubs par ordre alphabétique (français), sans club en dernier ; pré-accord du club', async () => {
    const zebre = (await call('POST', '/clubs', { name: 'Zèbre Dojo' })).json().id as string;
    const etoile = (await call('POST', '/clubs', { name: 'Étoile Karaté', preApproval: true })).json().id as string;
    const a = await reg({ lastName: 'ALPHA', clubId: zebre, approxWeightKg: 50 });
    await reg({ lastName: 'BETA', approxWeightKg: 50 });
    const boy = await reg({ lastName: 'GAMMA', clubId: etoile, sex: 'M', weightClassId: 'cadet:M:-57', approxWeightKg: 52 });
    await move(boy.id, a.id);
    const all = await list();
    expect(all.clubs.map((c) => [c.name, c.preApproval, c.requests.map((r) => `${r.situation.kind}:${r.label}`)])).toEqual([
      ['Étoile Karaté', true, ['mixite:GAMMA x']],
      ['Zèbre Dojo', false, ['mixite:ALPHA x']],
      ['Sans club', false, ['mixite:BETA x']],
    ]);
    expect(all.pending).toBe(3);
  });

  /** Matin : minimes et un minime (groupe mixte) ; après-midi : cadettes et un cadet (groupe mixte). */
  async function twoSessions() {
    const [matin, aprem] = (await call('PUT', '/waves', [
      { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
      { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
    ])).json() as { id: string }[];
    const cadette = await reg({ lastName: 'CADETTE', approxWeightKg: 50 });
    await reg({ lastName: 'CADETTE2', approxWeightKg: 50 });
    const cadet = await reg({ lastName: 'CADET', sex: 'M', weightClassId: 'cadet:M:-57', approxWeightKg: 52 });
    const minime = await reg({ lastName: 'MINIME', ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 45 });
    await reg({ lastName: 'MINIME2', ageBandCode: 'minime', weightClassId: 'minime:F:-50', approxWeightKg: 45 });
    const garcon = await reg({ lastName: 'GARCON', ageBandCode: 'minime', sex: 'M', weightClassId: 'minime:M:-50', approxWeightKg: 46 });
    await move(cadet.id, cadette.id);
    await move(garcon.id, minime.id);
    return { matin: matin!.id, aprem: aprem!.id, cadette, minime };
  }

  test('?vague= : les demandes des combattants de la session seulement ; session inconnue : 404', async () => {
    const { matin, aprem } = await twoSessions();
    expect((await rows(aprem)).map((r) => r.label).sort()).toEqual(['CADET x', 'CADETTE x', 'CADETTE2 x']);
    expect((await list(aprem)).pending).toBe(3);
    expect((await rows(matin)).map((r) => r.label).sort()).toEqual(['GARCON x', 'MINIME x', 'MINIME2 x']);
    expect(await rows()).toHaveLength(6);
    expect((await call('GET', '/authorizations?vague=inconnue')).statusCode).toBe(404);
  });

  test('« Repartir de zéro » d’une session : les réponses de ses combattants sont effacées, celles des autres sessions restent', async () => {
    const { aprem, cadette, minime } = await twoSessions();
    expect((await grant(cadette.id, 'mixite')).statusCode).toBe(200);
    expect((await grant(minime.id, 'mixite')).statusCode).toBe(200);
    expect((await resetAsShown(call as never, aprem)).statusCode).toBe(200);
    expect(answers()).toEqual([{ registration_id: minime.id, kind: 'mixite' }]);
  });

  test('« Repartir de zéro » de toutes les sessions : une session lancée garde ses réponses', async () => {
    const { matin, cadette, minime } = await twoSessions();
    await grant(cadette.id, 'mixite');
    await grant(minime.id, 'mixite');
    const zone = ((await call('GET', '/zones')).json() as { id: string }[])[0]!.id;
    for (const c of (await call('GET', '/categories')).json() as { id: string; waveId: string | null }[]) {
      if (c.waveId === matin) expect((await call('PATCH', `/categories/${c.id}`, { status: 'ready', zoneId: zone })).statusCode).toBe(200);
    }
    const launch = await call('POST', '/launch', { waveId: matin });
    expect(launch.statusCode, launch.body).toBe(204);
    expect((await resetAsShown(call as never)).statusCode).toBe(200);
    expect(answers()).toEqual([{ registration_id: minime.id, kind: 'mixite' }]);
  });
});
