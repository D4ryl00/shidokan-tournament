import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
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

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(over: object = {}) {
  n++;
  const res = await call('POST', '/registrations', {
    clubId: null, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}
type Replacement = {
  cases: { id: string; kind: string; registrationId: string }[];
  proposals: Record<string, { id: string; type: string; manual: boolean; reason: string; refused?: boolean }[]>;
  summary: Record<string, number>;
  fingerprint: string;
  recasements: { id: string; registrationId: string; type: string; status: string; reason: string }[];
};
const replacement = async () => (await call('GET', '/replacement')).json() as Replacement;
type Cat = { id: string; label: string; registrationIds: string[]; bracket: { entrants: { registrationId: string }[] } | null };
const categories = async () => (await call('GET', '/categories')).json() as Cat[];

test('pesée : hors catégorie, clôture, absent sorti du tableau', async () => {
  const a = await reg();
  const b = await reg();
  const c = await reg({ weightClassId: 'cadet:F:-61' });
  await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 58 });
  const w = (await call('GET', '/weigh-in')).json() as { fighters: { fighterId: string; presence: string; registrations: { outOfClass: boolean; weighInClassLabel: string | null }[] }[] };
  const fa = w.fighters.find((f) => f.fighterId === a.fighterId)!;
  expect(fa.presence).toBe('present');
  expect(fa.registrations[0]).toMatchObject({ outOfClass: true, weighInClassLabel: '-61' });
  expect((await replacement()).cases.map((x) => x.kind)).toContain('weight_out');

  await call('PUT', `/weigh-in/${c.fighterId}`, { presence: 'present', weighInKg: 60 });
  const closed = await call('POST', '/weigh-in/close');
  expect(closed.json()).toEqual({ markedAbsent: 1 }); // b
  const cat54 = (await categories()).find((x) => x.registrationIds.includes(b.id))!;
  expect(cat54.bracket!.entrants.map((e) => e.registrationId)).not.toContain(b.id);
});

test('fusion de deux seules, journal, plus de cas ; retour quand un adversaire arrive ; annulation', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  let r = await replacement();
  const caseA = r.cases.find((x) => x.registrationId === a.id)!;
  const prop = r.proposals[caseA.id]![0]!;
  expect(prop.type).toBe('A');
  expect((await call('POST', '/replacement/apply', { proposalId: prop.id })).statusCode).toBe(200);

  let cats = await categories();
  expect(cats).toHaveLength(1);
  expect(cats[0]!.label).toContain('-47 / -54');
  expect(cats[0]!.bracket!.entrants).toHaveLength(2);
  r = await replacement();
  expect(r.cases).toEqual([]);
  expect(r.recasements).toHaveLength(1);

  // Une nouvelle -47 s'inscrit sur place → retour proposé.
  await reg({ weightClassId: 'cadet:F:-47', source: 'onsite' });
  r = await replacement();
  const ret = r.cases.find((x) => x.kind === 'return')!;
  expect(ret.registrationId).toBe(a.id);
  await call('POST', '/replacement/apply', { proposalId: r.proposals[ret.id]![0]!.id });
  cats = await categories();
  expect(cats.map((c) => c.registrationIds.length).sort()).toEqual([1, 2]);
  expect(cats.find((c) => c.registrationIds.includes(b.id))!.label).not.toContain('-47');

  // Annulation du premier recasement : refusée si la catégorie est lancée.
  r = await replacement();
  const first = r.recasements.find((x) => x.type === 'A')!;
  const cat47 = cats.find((c) => c.registrationIds.includes(a.id))!;
  await call('PATCH', `/categories/${cat47.id}`, { status: 'started' });
  expect((await call('POST', '/replacement/undo', { recasementId: first.id })).statusCode).toBe(409);
});

test('annulation : remet l’inscription en place', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  let r = await replacement();
  await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id });
  r = await replacement();
  expect((await call('POST', '/replacement/undo', { recasementId: r.recasements[0]!.id })).statusCode).toBe(200);
  expect((await categories()).map((c) => c.registrationIds.length)).toEqual([1, 1]);
  r = await replacement();
  expect(r.recasements[0]!.status).toBe('undone');
});

test('masse : simple avec empreinte ; empreinte périmée → 409', async () => {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  const r = await replacement();
  expect((await call('POST', '/replacement/bulk', { mode: 'simple', fingerprint: 'périmée' })).statusCode).toBe(409);
  const res = await call('POST', '/replacement/bulk', { mode: 'simple', fingerprint: r.fingerprint });
  expect(res.json()).toEqual({ applied: 1 });
  const after = await replacement();
  expect(after.cases).toHaveLength(1); // la minime reste (cas manuel)
  const all = await call('POST', '/replacement/bulk', { mode: 'all', fingerprint: after.fingerprint });
  expect(all.json().applied).toBe(1);
  expect((await replacement()).cases).toEqual([]);
});

test('aperçu : avant / après sans modifier la base', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  const pid = r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id;
  const prev = (await call('POST', '/replacement/preview', { proposalId: pid })).json() as { categories: { label: string; before: string[][]; after: string[][] }[] };
  expect(prev.categories.some((c) => c.after.flat().length === 2)).toBe(true);
  // Avant : chacune seule dans sa catégorie (et non une liste vide).
  expect(prev.categories.flatMap((c) => c.before).filter((x) => x.length === 1)).toHaveLength(2);
  expect((await categories()).map((c) => c.registrationIds.length)).toEqual([1, 1]);
  const bulk = (await call('POST', '/replacement/preview', { bulk: 'all' })).json() as { steps: { manual: boolean }[] };
  expect(bulk.steps.length).toBeGreaterThan(0);
});

test('refus : la proposition n’est plus applicable', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  const caseId = r.cases.find((x) => x.registrationId === a.id)!.id;
  const pid = r.proposals[caseId]![0]!.id;
  await call('POST', '/replacement/refuse', { proposalId: pid });
  expect(((await replacement()).proposals[caseId] ?? []).filter((p) => !p.refused).some((p) => p.id === pid)).toBe(false);
  expect((await call('POST', '/replacement/apply', { proposalId: pid })).statusCode).toBe(409);
});

test('déplacement manuel hors règles : effectué avec avertissement', async () => {
  const a = await reg();
  await reg({ sex: 'M', weightClassId: 'cadet:M:-52' });
  const target = (await categories()).find((c) => !c.registrationIds.includes(a.id))!;
  const res = await call('POST', '/replacement/move', { registrationId: a.id, categoryId: target.id });
  expect(res.statusCode).toBe(200);
  expect(res.json().warnings.join(' ')).toMatch(/sexe|mixité/i);
  expect((await categories())[0]!.registrationIds).toHaveLength(2);
});

test('catégorie lancée : jamais cible ni modifiée par le recasement en masse', async () => {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const cat54 = (await categories()).find((c) => c.registrationIds.includes(b.id))!;
  await call('PATCH', `/categories/${cat54.id}`, { status: 'started' });
  const r = await replacement();
  expect(Object.values(r.proposals).flat().some((p) => p.id.includes(cat54.id))).toBe(false);
  await call('POST', '/replacement/bulk', { mode: 'all', fingerprint: r.fingerprint });
  expect((await categories()).find((c) => c.id === cat54.id)!.registrationIds).toHaveLength(2);
});

test('annulation : clé de catégorie recalculée ; seulement le recasement le plus récent d’une inscription', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 50 });
  const b = await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  const c = await reg({ weightClassId: 'cadet:F:-61', approxWeightKg: 54 });
  let r = await replacement();
  await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]!.find((p) => p.id.includes('>'))!.id });
  r = await replacement();
  const cCase = r.cases.find((x) => x.registrationId === c.id);
  if (cCase && r.proposals[cCase.id]?.length) await call('POST', '/replacement/apply', { proposalId: r.proposals[cCase.id]![0]!.id });
  r = await replacement();
  const first = r.recasements.find((x) => x.registrationId === a.id)!;
  await call('POST', '/replacement/undo', { recasementId: first.id });
  const host = (await categories()).find((x) => x.registrationIds.includes(b.id))!;
  const grid = (await call('GET', '/grid')).json() as { weightClasses: { id: string; label: string }[] };
  void grid;
  // la catégorie de b ne mentionne plus -47 (a est reparti) mais garde -61 si c y est
  expect(host.label.includes('-47')).toBe(false);
  if (host.registrationIds.includes(c.id)) expect(host.label).toContain('-61');
});

test('annulation d’un ancien recasement refusée si un plus récent existe pour la même inscription', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  let r = await replacement();
  await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id });
  const target = (await categories()).find((x) => !x.registrationIds.includes(a.id));
  await reg({ ageBandCode: 'senior', weightClassId: 'senior:F:-50' });
  const other = (await categories()).find((x) => x.label.includes('Seniors'))!;
  void target;
  await call('POST', '/replacement/move', { registrationId: a.id, categoryId: other.id });
  r = await replacement();
  const older = r.recasements.filter((x) => x.registrationId === a.id).sort((x, y) => x.id.localeCompare(y.id));
  const firstApplied = r.recasements.filter((x) => x.registrationId === a.id).at(-1)!;
  expect((await call('POST', '/replacement/undo', { recasementId: firstApplied.id })).statusCode).toBe(409);
  void older;
});

test('déplacement manuel depuis une catégorie lancée : refusé', async () => {
  const a = await reg();
  await reg();
  await reg({ weightClassId: 'cadet:F:-61' });
  const src = (await categories()).find((x) => x.registrationIds.includes(a.id))!;
  const dst = (await categories()).find((x) => x.id !== src.id)!;
  await call('PATCH', `/categories/${src.id}`, { status: 'started' });
  expect((await call('POST', '/replacement/move', { registrationId: a.id, categoryId: dst.id })).statusCode).toBe(409);
});

test('aperçu d’un déplacement manuel : avertissements, rien n’est modifié', async () => {
  const a = await reg();
  await reg({ sex: 'M', weightClassId: 'cadet:M:-52' });
  const target = (await categories()).find((c) => !c.registrationIds.includes(a.id))!;
  const res = (await call('POST', '/replacement/preview', { move: { registrationId: a.id, categoryId: target.id } })).json() as { warnings: string[]; categories: unknown[] };
  expect(res.warnings.join(' ')).toMatch(/mixité/);
  expect(res.categories.length).toBeGreaterThan(0);
  expect((await categories()).map((c) => c.registrationIds.length)).toEqual([1, 1]);
});

test('pesée : plus léger que sa catégorie → pas hors catégorie', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-61' });
  await call('PUT', `/weigh-in/${(a as unknown as { fighterId: string }).fighterId}`, { weighInKg: 50 });
  const w = (await call('GET', '/weigh-in')).json() as { fighters: { registrations: { outOfClass: boolean }[] }[] };
  expect(w.fighters[0]!.registrations[0]!.outOfClass).toBe(false);
});

test('validation unitaire avec empreinte périmée → 409', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  const pid = r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id;
  await reg({ weightClassId: 'cadet:F:-61' });
  expect((await call('POST', '/replacement/apply', { proposalId: pid, fingerprint: r.fingerprint })).statusCode).toBe(409);
});

test('proposition refusée : listée comme refusée, puis rétablie', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  let r = await replacement();
  const caseId = r.cases.find((x) => x.registrationId === a.id)!.id;
  const pid = r.proposals[caseId]![0]!.id;
  await call('POST', '/replacement/refuse', { proposalId: pid });
  r = await replacement();
  expect(r.proposals[caseId]!.find((p) => p.id === pid)!.refused).toBe(true);
  await call('POST', '/replacement/unrefuse', { proposalId: pid });
  r = await replacement();
  expect(r.proposals[caseId]!.find((p) => p.id === pid)!.refused).toBeFalsy();
});

test('pesée : un recasé n’est pas « hors catégorie », il est signalé « recasé »', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 }) as unknown as { id: string; fighterId: string };
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id });
  await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 52 });
  const w = (await call('GET', '/weigh-in')).json() as { fighters: { fighterId: string; registrations: { outOfClass: boolean; recased: boolean }[] }[] };
  expect(w.fighters.find((f) => f.fighterId === a.fighterId)!.registrations[0]).toMatchObject({ outOfClass: false, recased: true });
});

test('déplacement manuel vers un kata : règlement et poids retirés', async () => {
  const a = await reg();
  await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  const kata = (await categories()).find((c) => c.label.startsWith('Kata'))!;
  const res = await call('POST', '/replacement/move', { registrationId: a.id, categoryId: kata.id });
  expect(res.json().warnings.join(' ')).toContain('kata');
  const rows = (await call('GET', '/registrations')).json() as { id: string; discipline: string; ruleset: string | null; weightClassId: string | null }[];
  expect(rows.find((x) => x.id === a.id)).toMatchObject({ discipline: 'kata', ruleset: null, weightClassId: null });
});

test('absence d’un membre d’une catégorie fusionnée : clé recalculée sur les présents', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id });
  expect((await categories()).find((c) => c.registrationIds.includes(a.id))!.label).toContain('-47 / -54');
  await call('PUT', `/weigh-in/${b.fighterId}`, { presence: 'absent' });
  const host = (await categories()).find((c) => c.registrationIds.includes(a.id))!;
  expect(host.label).not.toContain('-54');
  expect(host.registrationIds).toContain(b.id);
});

test('journal : motif du recasement ; pesée : catégorie de chaque inscription', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  const p = r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!;
  await call('POST', '/replacement/apply', { proposalId: p.id });
  expect((await replacement()).recasements[0]!.reason).toBe(p.reason);
  const w = (await call('GET', '/weigh-in')).json() as { fighters: { fighterId: string; registrations: { categoryLabel: string | null }[] }[] };
  expect(w.fighters.find((f) => f.fighterId === a.fighterId)!.registrations[0]!.categoryLabel).toBe('Karaté · Jiyu · Cadets F · -47 / -54 kg');
});

test('annulation : ordre fiable même si deux recasements ont la même heure (à la milliseconde)', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id });
  await reg({ ageBandCode: 'senior', weightClassId: 'senior:F:-50' });
  const other = (await categories()).find((x) => x.label.includes('Seniors'))!;
  await call('POST', '/replacement/move', { registrationId: a.id, categoryId: other.id });
  const raw = new Database(dbPath);
  raw.prepare("UPDATE recasements SET created_at = '2026-11-22T09:00:00.000Z'").run();
  raw.close();
  const [newest, oldest] = (await replacement()).recasements;
  expect(newest!.type).toBe('M');
  expect((await call('POST', '/replacement/undo', { recasementId: oldest!.id })).statusCode).toBe(409);
  expect((await call('POST', '/replacement/undo', { recasementId: newest!.id })).statusCode).toBe(200);
});

test('absence : la clé recalculée ne rejoint jamais celle d’une autre catégorie (pas de déplacement silencieux)', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id });
  const c = await reg({ weightClassId: 'cadet:F:-47' });
  const cCat = (await categories()).find((x) => x.registrationIds.includes(c.id))!;
  expect(cCat.registrationIds).not.toContain(a.id);
  await call('PUT', `/weigh-in/${b.fighterId}`, { presence: 'absent' });
  const after = await categories();
  expect(after.find((x) => x.registrationIds.includes(c.id))!.id).toBe(cCat.id);
  expect(after.find((x) => x.registrationIds.includes(c.id))!.registrationIds).not.toContain(a.id);
  expect(new Set(after.map((x) => x.label)).size).toBe(after.length);
});

test('pesée : rang de catégorie dans l’ordre de la grille (feuilles par catégorie)', async () => {
  const cadet = await reg({ weightClassId: 'cadet:F:-61' });
  const minime = await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
  const w = (await call('GET', '/weigh-in')).json() as { fighters: { fighterId: string; registrations: { categoryOrder: number | null }[] }[] };
  const order = (fid: string) => w.fighters.find((f) => f.fighterId === fid)!.registrations[0]!.categoryOrder!;
  expect(typeof order(minime.fighterId)).toBe('number');
  expect(order(minime.fighterId)).toBeLessThan(order(cadet.fighterId));
});

test('catégorie mixte (F/M) : le libellé suit les présents, et revient à F/M quand l’absent revient', async () => {
  await call('PATCH', '', { settings: { mixSexes: { enabled: true, ageBandCodes: ['cadet'] } } });
  const f = await reg({ lastName: 'FILLE' });
  await reg({ lastName: 'GARCON', sex: 'M', weightClassId: 'cadet:M:-52' });
  await reg({ lastName: 'GARCON2', sex: 'M', weightClassId: 'cadet:M:-52' });
  const rep = await replacement();
  const p = rep.proposals[rep.cases.find((x) => x.registrationId === f.id)!.id]!.find((x) => x.type === 'F')!;
  expect((await call('POST', '/replacement/apply', { proposalId: p.id })).statusCode).toBe(200);
  const labels = async () => (await categories()).map((c) => `${c.label} [${c.registrationIds.length}]`);
  expect(await labels()).toEqual(['Karaté · Jiyu · Cadets F/M · -52 / -54 kg [3]']);
  await call('PUT', `/weigh-in/${f.fighterId}`, { presence: 'absent' });
  expect(await labels()).toEqual(['Karaté · Jiyu · Cadets M · -52 kg [3]']);
  await call('PUT', `/weigh-in/${f.fighterId}`, { presence: 'present' });
  expect(await labels()).toEqual(['Karaté · Jiyu · Cadets F/M · -52 / -54 kg [3]']);
});

describe('pesée par vague', () => {
  type W = { fighters: { fighterId: string; presence: string; registrations: { discipline: string }[] }[]; closed: boolean };
  async function twoWaves() {
    const both = await reg({ lastName: 'DEUX' });
    await call('POST', '/registrations', { clubId: null, lastName: 'DEUX', firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' });
    await reg({ lastName: 'COMBAT' });
    const bands = ['poussin', 'pupille', 'benjamin', 'minime', 'cadet', 'junior', 'senior'];
    const [kata, combat] = (await call('PUT', '/waves', [
      { name: 'Kata', rules: { ageBandCodes: [], disciplines: ['kata'] } },
      { name: 'Combats', rules: { ageBandCodes: bands, disciplines: [] } },
    ])).json() as { id: string }[];
    return { both, kata: kata!.id, combat: combat!.id };
  }
  const list = async (wave: string) => (await call('GET', `/weigh-in?vague=${wave}`)).json() as W;
  const presences = async () =>
    ((await call('GET', '/registrations')).json() as { discipline: string; presence: string; fighter: { lastName: string } }[])
      .map((r) => `${r.fighter.lastName}:${r.discipline}:${r.presence}`).sort();

  test('liste limitée aux combattants de la vague', async () => {
    const { kata, combat } = await twoWaves();
    expect((await list(kata)).fighters.map((f) => f.registrations.map((r) => r.discipline))).toEqual([['kata']]);
    expect((await list(combat)).fighters).toHaveLength(2);
  });

  test('combattant dans deux vagues : présence indépendante', async () => {
    const { both, kata, combat } = await twoWaves();
    await call('PUT', `/weigh-in/${both.fighterId}`, { presence: 'absent', waveId: combat });
    expect(await presences()).toEqual(['COMBAT:karate:unknown', 'DEUX:karate:absent', 'DEUX:kata:unknown']);
    await call('PUT', `/weigh-in/${both.fighterId}`, { weighInKg: 50, waveId: kata });
    expect(await presences()).toEqual(['COMBAT:karate:unknown', 'DEUX:karate:absent', 'DEUX:kata:present']);
    expect((await list(kata)).fighters[0]!.presence).toBe('present');
    expect((await list(combat)).fighters.find((f) => f.fighterId === both.fighterId)!.presence).toBe('absent');
  });

  test('clôture de la vague du matin : les autres vagues ne bougent pas', async () => {
    const { kata, combat } = await twoWaves();
    const closed = (await call('POST', '/weigh-in/close', { waveId: kata })).json() as { markedAbsent: number };
    expect(closed.markedAbsent).toBe(1);
    expect(await presences()).toEqual(['COMBAT:karate:unknown', 'DEUX:karate:unknown', 'DEUX:kata:absent']);
    expect((await list(kata)).closed).toBe(true);
    expect((await list(combat)).closed).toBe(false);
    const waves = (await call('GET', '/waves')).json() as { id: string; weighInClosed: boolean }[];
    expect(waves.map((w) => w.weighInClosed)).toEqual([true, false]);
  });
});
