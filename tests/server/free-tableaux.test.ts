import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
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
type Cat = {
  id: string; label: string; registrationIds: string[]; waveId: string | null; status: string; arranged: boolean;
  key: { discipline: string; ruleset: string | null; free?: string };
  bracket: { kind: 'combat' | 'kata'; entrants: { registrationId: string }[]; matches?: { id: string }[] } | null;
};
type Reg = { id: string; discipline: string; ruleset: string | null; weightClassId: string | null; placementLocked: boolean; recasementType: string | null };
const categories = async () => (await call('GET', '/categories')).json() as Cat[];
const registrations = async () => (await call('GET', '/registrations')).json() as Reg[];
const regOf = async (id: string) => (await registrations()).find((r) => r.id === id)!;
const catOf = async (registrationId: string) => (await categories()).find((c) => c.registrationIds.includes(registrationId));
const create = async (body: object) => call('POST', '/free-tableaux', body);
async function freeTableau(name = 'Gala 1', discipline = 'karate', ruleset: string | null = 'jiyu') {
  const res = await create({ name, discipline, ruleset });
  expect(res.statusCode).toBe(201);
  return res.json() as Cat;
}
const move = async (registrationId: string, categoryId: string) => {
  const res = await call('POST', '/replacement/move', { registrationId, categoryId });
  expect(res.statusCode).toBe(200);
};
type Replacement = {
  cases: { id: string; kind: string; registrationId: string; alert?: true }[];
  summary: Record<string, number>;
  recasements: { id: string; registrationId: string; type: string; status: string }[];
  reset: { undo: number; manual: number };
};
const replacement = async () => (await call('GET', '/replacement')).json() as Replacement;
const applyPlan = async () => {
  const p = (await call('POST', '/replacement/plan', { choices: [], forApply: true })).json() as { fingerprint: string; plan: { hash: string } };
  const res = await call('POST', '/replacement/plan/apply', { choices: [], fingerprint: p.fingerprint, hash: p.plan.hash });
  expect(res.statusCode).toBe(200);
};
/** A (-54) et B (-61) chacun dans une catégorie de trois : personne n'est seul quand ils partent. */
async function twoGroups() {
  const a = await reg({ lastName: 'ALPHA' });
  await reg();
  await reg();
  const b = await reg({ lastName: 'BETA', weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  return { a, b, fromA: (await catOf(a.id))!, fromB: (await catOf(b.id))! };
}

test('créer, lister, sans tableau', async () => {
  const res = await create({ name: 'Gala 1', discipline: 'karate', ruleset: 'jiyu' });
  expect(res.statusCode).toBe(201);
  const id = (res.json() as Cat).id;
  for (let i = 0; i < 2; i++) {
    const found = (await categories()).find((c) => c.id === id);
    expect(found).toMatchObject({ label: 'Gala 1', registrationIds: [], bracket: null, waveId: null });
  }
});

test('nom refusé : vide, doublon (sans tenir compte de la casse)', async () => {
  const empty = await create({ name: ' ', discipline: 'karate', ruleset: 'jiyu' });
  expect(empty.statusCode).toBe(400);
  expect(empty.json().issues).toEqual(['Donnez un nom au tableau libre.']);
  await freeTableau('Gala 1');
  const dup = await create({ name: 'gala 1', discipline: 'kata', ruleset: null });
  expect(dup.statusCode).toBe(400);
  expect(dup.json().issues).toEqual(['Un tableau libre porte déjà ce nom.']);
});

test('deux combattants de catégories différentes : un combat, discipline et règlement du tableau', async () => {
  const { a, b } = await twoGroups();
  const free = await freeTableau('Gala boxe', 'shido-boxing', 'jiyu');
  await move(a.id, free.id);
  await move(b.id, free.id);
  const cat = (await categories()).find((c) => c.id === free.id)!;
  expect(cat.registrationIds).toEqual([a.id, b.id].sort());
  expect(cat.bracket!.kind).toBe('combat');
  expect(cat.bracket!.matches).toHaveLength(1);
  for (const id of [a.id, b.id]) expect(await regOf(id)).toMatchObject({ discipline: 'shido-boxing', ruleset: 'jiyu' });
});

test('jamais par la catégorie naturelle', async () => {
  const free = await freeTableau('Gala kata', 'kata', null);
  const k = await reg({ sex: 'M', ageBandCode: 'senior', discipline: 'kata', ruleset: null, weightClassId: null });
  const cat = (await catOf(k.id))!;
  expect(cat.id).not.toBe(free.id);
  expect(cat.label).not.toBe('Gala kata');
  expect(cat.label).toMatch(/kata/i);
  expect((await categories()).find((c) => c.id === free.id)!.registrationIds).toEqual([]);
});

test('réaffectation : rien ne bouge dans un tableau libre, alerte si seul', async () => {
  const { a, b } = await twoGroups();
  const free = await freeTableau();
  await move(a.id, free.id);
  await move(b.id, free.id);
  await applyPlan();
  expect((await categories()).find((c) => c.id === free.id)!.registrationIds).toEqual([a.id, b.id].sort());
  const res = await call('POST', '/replacement/undo-manual', { registrationId: b.id });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
  const r = await replacement();
  const card = r.cases.find((c) => c.registrationId === a.id)!;
  expect(card).toMatchObject({ kind: 'alone', alert: true });
  expect(r.cases).toHaveLength(1);
  expect(r.summary).toMatchObject({ cases: 1, alone: 1, withoutProposal: 1 });
});

test('alerte d’un tableau libre en attente : visible et comptée dans chaque session', async () => {
  const [matin, aprem] = (await call('PUT', '/waves', [
    { name: 'Matin', rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet', 'junior', 'senior'], disciplines: [] } },
  ])).json() as { id: string }[];
  const { a, b } = await twoGroups();
  const free = await freeTableau();
  await move(a.id, free.id);
  await move(b.id, free.id);
  expect((await call('POST', '/replacement/undo-manual', { registrationId: b.id })).statusCode).toBe(200);
  expect((await categories()).find((c) => c.id === free.id)!.waveId).toBeNull();
  for (const wave of [matin!.id, aprem!.id]) {
    const r = (await call('GET', `/replacement?vague=${wave}`)).json() as Replacement & { fighters: Record<string, unknown>; moveTargets: Record<string, unknown> };
    const card = r.cases.find((c) => c.registrationId === a.id);
    expect(card).toMatchObject({ kind: 'alone', alert: true });
    expect(r.summary).toMatchObject({ cases: 1, alone: 1 });
    expect(r.fighters[a.id]).toBeDefined();
    expect(r.moveTargets[card!.id]).toBeDefined();
  }
});

test('tableau libre vidé : plus arrangé, le suivant est tiré à neuf', async () => {
  const { a, b } = await twoGroups();
  const free = await freeTableau();
  await move(a.id, free.id);
  await move(b.id, free.id);
  const swap = await call('POST', `/categories/${free.id}/swap`, { a: a.id, b: b.id });
  expect(swap.statusCode).toBe(200);
  expect((swap.json() as Cat).arranged).toBe(true);
  for (const id of [a.id, b.id]) expect((await call('POST', '/replacement/undo-manual', { registrationId: id })).statusCode).toBe(200);
  expect((await categories()).find((c) => c.id === free.id)).toMatchObject({ registrationIds: [], bracket: null, arranged: false });
  await move(a.id, free.id);
  await move(b.id, free.id);
  expect((await categories()).find((c) => c.id === free.id)).toMatchObject({ registrationIds: [a.id, b.id].sort(), arranged: false });
});

test('modifier : nom, discipline (combattants en kata), refusé une fois lancé', async () => {
  const { a, b } = await twoGroups();
  const free = await freeTableau();
  const renamed = await call('PATCH', `/free-tableaux/${free.id}`, { name: 'Gala A' });
  expect(renamed.statusCode).toBe(200);
  expect((renamed.json() as Cat).label).toBe('Gala A');
  expect((await categories()).find((c) => c.id === free.id)!.label).toBe('Gala A');
  await move(a.id, free.id);
  await move(b.id, free.id);
  const kata = await call('PATCH', `/free-tableaux/${free.id}`, { discipline: 'kata', ruleset: null });
  expect(kata.statusCode).toBe(200);
  for (const id of [a.id, b.id]) expect(await regOf(id)).toMatchObject({ discipline: 'kata', ruleset: null, weightClassId: null });
  const cat = (await categories()).find((c) => c.id === free.id)!;
  expect(cat.key).toMatchObject({ discipline: 'kata', ruleset: null, free: 'Gala A' });
  expect(cat.bracket!.kind).toBe('kata');
  expect(cat.registrationIds).toEqual([a.id, b.id].sort());

  // Lancé (un résultat saisi) : discipline et nom refusés.
  await call('PATCH', `/free-tableaux/${free.id}`, { discipline: 'karate', ruleset: 'jiyu' });
  const combat = (await categories()).find((c) => c.id === free.id)!;
  expect(combat.bracket!.kind).toBe('combat');
  expect((await call('PUT', `/categories/${free.id}/results/${combat.bracket!.matches![0]!.id}`, { winner: 'a', method: 'points' })).statusCode).toBe(200);
  expect((await categories()).find((c) => c.id === free.id)!.status).toMatch(/^(started|finished)$/);
  expect((await call('PATCH', `/free-tableaux/${free.id}`, { discipline: 'kata', ruleset: null })).statusCode).toBe(409);
  expect((await call('PATCH', `/free-tableaux/${free.id}`, { name: 'Gala B' })).statusCode).toBe(409);
  expect((await call('DELETE', `/free-tableaux/${free.id}`)).statusCode).toBe(409);
});

test('modifier : une catégorie ordinaire n’est pas un tableau libre', async () => {
  const a = await reg();
  const res = await call('PATCH', `/free-tableaux/${(await catOf(a.id))!.id}`, { name: 'X' });
  expect(res.statusCode).toBe(400);
  expect(res.json().issues).toEqual(["Ce n'est pas un tableau libre."]);
});

test('session choisie : jamais déduite, réglée à la main', async () => {
  const [matin] = (await call('PUT', '/waves', [{ name: 'Matin', rules: { ageBandCodes: [], disciplines: ['kata'] } }])).json() as { id: string }[];
  const free = await freeTableau('Gala kata', 'kata', null);
  expect((await categories()).find((c) => c.id === free.id)!.waveId).toBeNull();
  expect((await call('PATCH', `/categories/${free.id}`, { waveOverride: matin!.id })).statusCode).toBe(200);
  expect((await categories()).find((c) => c.id === free.id)!.waveId).toBe(matin!.id);
});

test('supprimer renvoie les combattants dans leur catégorie d’avant', async () => {
  const { a, b, fromA, fromB } = await twoGroups();
  const free = await freeTableau('Démo', 'kata', null);
  await move(a.id, free.id);
  await move(b.id, free.id);
  expect(await regOf(a.id)).toMatchObject({ discipline: 'kata', ruleset: null, weightClassId: null });
  const res = await call('DELETE', `/free-tableaux/${free.id}`);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ returned: 2 });
  expect((await catOf(a.id))!.id).toBe(fromA.id);
  expect((await catOf(b.id))!.id).toBe(fromB.id);
  expect(await regOf(a.id)).toMatchObject({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54' });
  expect(await regOf(b.id)).toMatchObject({ discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-61' });
  expect((await categories()).some((c) => c.id === free.id)).toBe(false);
});

test('supprimer : refusé en entier si un combattant ne peut pas revenir', async () => {
  const { a, b } = await twoGroups();
  const free = await freeTableau();
  await move(a.id, free.id);
  await move(b.id, free.id);
  // Catégorie d'avant de B lancée : son retour est impossible, A reste aussi.
  const fromB = (await categories()).find((c) => c.label.includes('-61'))!;
  await call('PATCH', `/categories/${fromB.id}`, { status: 'started' });
  expect((await call('DELETE', `/free-tableaux/${free.id}`)).statusCode).toBe(409);
  expect((await categories()).find((c) => c.id === free.id)!.registrationIds).toEqual([a.id, b.id].sort());
});

test('undo-manual : retour dans la catégorie du plan, plus un placement manuel ; second refusé', async () => {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  await applyPlan();
  const planned = (await replacement()).recasements.find((r) => r.status === 'validated')!;
  const x = planned.registrationId;
  const planCat = (await catOf(x))!;
  expect(planCat.registrationIds).toHaveLength(2);
  const free = await freeTableau();
  await move(x, free.id);
  expect(await regOf(x)).toMatchObject({ placementLocked: true, recasementType: 'M' });
  expect((await call('POST', '/replacement/undo-manual', { registrationId: x })).statusCode).toBe(200);
  expect((await catOf(x))!.id).toBe(planCat.id);
  expect((await regOf(x)).recasementType).toBe(planned.type);
  const again = await call('POST', '/replacement/undo-manual', { registrationId: x });
  expect(again.statusCode).toBe(400);
  expect(again.json().issues).toEqual(["Le dernier déplacement de ce combattant n'est pas manuel."]);
});

test('Repartir de zéro : défait les déplacements manuels, le tableau libre reste, vide', async () => {
  const { a, b, fromA, fromB } = await twoGroups();
  const free = await freeTableau();
  await move(a.id, free.id);
  await move(b.id, free.id);
  const r = await replacement();
  expect(r.reset).toMatchObject({ undo: 2, manual: 2 });
  expect((await call('POST', '/replacement/reset', {})).statusCode).toBe(200);
  expect((await catOf(a.id))!.id).toBe(fromA.id);
  expect((await catOf(b.id))!.id).toBe(fromB.id);
  expect((await categories()).find((c) => c.id === free.id)).toMatchObject({ label: 'Gala 1', registrationIds: [], bracket: null });
});

test('move-targets : le tableau libre, sans avertissement', async () => {
  const { a, fromA } = await twoGroups();
  const free = await freeTableau();
  const res = await call('GET', `/replacement/move-targets/${a.id}`);
  expect(res.statusCode).toBe(200);
  const { targets } = res.json() as { targets: { categoryId: string; label: string; free: boolean; warnings: string[] }[] };
  expect(targets).toContainEqual({ categoryId: free.id, label: 'Gala 1', free: true, warnings: [] });
  expect(targets.find((t) => !t.free)!.label).toContain('-61');
  expect(targets.some((t) => t.categoryId === fromA.id)).toBe(false);
  expect((await call('GET', '/replacement/move-targets/inconnu')).statusCode).toBe(404);
});
