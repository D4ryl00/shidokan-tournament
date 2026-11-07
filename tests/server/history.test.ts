import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { CHANGED_REASON, lockedReason } from '../../src/domain/history/cascade.js';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { historyEntries, registrations as registrationsTable } from '../../src/server/db/schema.js';
import { recorded } from '../../src/server/repositories/history.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
let competitionId: string;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  competitionId = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id;
  base = `/api/competitions/${competitionId}`;
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
type Slot = { kind: 'entrant'; registrationId: string } | { kind: 'bye' } | { kind: string };
type Match = { id: string; round: number; phase: string; a: Slot; b: Slot };
type Cat = {
  id: string; rev?: string; label: string; registrationIds: string[]; status: string; arranged: boolean; format: string | null; seed: number;
  bracket: { kind: 'combat' | 'kata'; entrants: { registrationId: string }[]; matches?: Match[] } | null;
};
type Entry = {
  id: string; seq: number; kind: string; groupId: string | null; status: 'active' | 'undone'; undoneAt: string | null; waveId: string | null; names: string[];
  summary: { registrationIds: string[]; fromLabel?: string; toLabel?: string; reason?: string }; categoryIds: string[]; blocked: string | null; cascade: string[];
};
const categories = async () => (await call('GET', '/categories')).json() as Cat[];
const catOf = async (registrationId: string) => (await categories()).find((c) => c.registrationIds.includes(registrationId));
/** Catégories sans leur version (`rev` change à chaque écriture, même quand le contenu revient). */
const contents = async () => (await categories()).map(({ rev: _rev, ...c }) => c).sort((a, b) => (a.id < b.id ? -1 : 1));
const move = async (registrationId: string, categoryId: string) => {
  const res = await call('POST', '/replacement/move', { registrationId, categoryId });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { warnings: string[]; historyId: string | null };
  expect(body.historyId).toEqual(expect.any(String));
  return body.historyId!;
};
const history = async (waveId?: string) => {
  const res = await call('GET', `/history${waveId ? `?waveId=${waveId}` : ''}`);
  expect(res.statusCode).toBe(200);
  return (res.json() as { entries: Entry[] }).entries;
};
const entry = async (id: string) => (await history()).find((e) => e.id === id)!;
const undo = (ids: string[], expectIds: string[]) => call('POST', '/history/undo', { ids, expect: expectIds });
type PlanMove = { id: string; registrationId: string; reason: string; anchor: string | null };
type PlanOut = { plan: { moves: PlanMove[]; hash: string }; fingerprint: string };
type Choice = { kind: 'validate'; proposalId: string; caseId: string };
/** Plan à appliquer (sans validation, plus les choix), appliqué avec son empreinte et son hash ; rend le plan affiché. */
const applyPlan = async (choices: Choice[] = []) => {
  const p = (await call('POST', '/replacement/plan', { choices, forApply: true })).json() as PlanOut;
  const res = await call('POST', '/replacement/plan/apply', { choices, fingerprint: p.fingerprint, hash: p.plan.hash });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ applied: p.plan.moves.length });
  return p.plan;
};
type Replacement = {
  cases: { id: string; kind: string; registrationId: string }[];
  proposals: Record<string, { id: string; target: object }[]>;
  recasements: { id: string; registrationId: string; type: string; status: string; reason: string }[];
  fingerprint: string;
};
const replacement = async () => (await call('GET', '/replacement')).json() as Replacement;
/** Chaque inscrit présent d'une catégorie figure dans son tableau. */
async function everyoneInBracket() {
  const regs = (await call('GET', '/registrations')).json() as { id: string; presence?: string }[];
  const absent = new Set(regs.filter((r) => r.presence === 'absent').map((r) => r.id));
  for (const c of await categories()) {
    const entrants = (c.bracket?.entrants ?? []).map((e) => e.registrationId);
    expect(entrants).toEqual(expect.arrayContaining(c.registrationIds.filter((id) => !absent.has(id))));
  }
}
/** Paires du 1er tour (combats complets) d'un tableau à élimination. */
const firstRoundPairs = (c: Cat) =>
  (c.bracket!.matches ?? [])
    .filter((m) => m.phase === 'main' && m.round === 1 && m.a.kind === 'entrant' && m.b.kind === 'entrant')
    .map((m) => [(m.a as { registrationId: string }).registrationId, (m.b as { registrationId: string }).registrationId].sort().join('+'))
    .sort();

/** A (-54) et B (-47) chacun dans une catégorie de trois ; X (-61) : trois combattants. */
async function threeGroups() {
  const a = await reg({ lastName: 'ALPHA' });
  await reg();
  await reg();
  const b = await reg({ lastName: 'BETA', weightClassId: 'cadet:F:-47' });
  await reg({ weightClassId: 'cadet:F:-47' });
  await reg({ weightClassId: 'cadet:F:-47' });
  const x = await reg({ weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  return { a, b, fromA: (await catOf(a.id))!, fromB: (await catOf(b.id))!, x: (await catOf(x.id))! };
}

test('déplacement manuel journalisé', async () => {
  const { a, fromA, x } = await threeGroups();
  const h = await move(a.id, x.id);
  const [e] = await history();
  // Libellés au moment de l'action : l'arrivée porte sa clé élargie (« -54 / -61 kg »).
  const toLabel = (await categories()).find((c) => c.id === x.id)!.label;
  expect(toLabel).not.toBe(x.label);
  expect(e).toMatchObject({
    id: h, kind: 'manual', status: 'active', undoneAt: null, names: ['ALPHA x'], blocked: null, cascade: [],
    summary: { registrationIds: [a.id], fromLabel: fromA.label, toLabel, reason: 'Placé à la main' },
  });
  expect(e!.categoryIds).toEqual(expect.arrayContaining([fromA.id, x.id]));
});

test('places gardées : les combats d’avant ne bougent pas, les deux tableaux sont arrangés', async () => {
  const a = await reg({ lastName: 'ALPHA' });
  for (let i = 0; i < 3; i++) await reg();
  // X : élimination de six (deux combats complets, deux exemptions).
  const first = await reg({ weightClassId: 'cadet:F:-61' });
  for (let i = 0; i < 5; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const x = (await catOf(first.id))!;
  const fromA = (await catOf(a.id))!;
  expect(x.bracket!.kind).toBe('combat');
  const before = firstRoundPairs(x);
  expect(before).toHaveLength(2);
  await move(a.id, x.id);
  const after = (await categories()).find((c) => c.id === x.id)!;
  expect(after.registrationIds).toContain(a.id);
  // Les deux combats d'avant gardent leurs deux combattants ; l'arrivant prend une exemption.
  expect(firstRoundPairs(after)).toEqual(expect.arrayContaining(before));
  expect(firstRoundPairs(after)).toHaveLength(3);
  expect(after.arranged).toBe(true);
  expect((await categories()).find((c) => c.id === fromA.id)!.arranged).toBe(true);
});

test('annuler remet exactement les catégories d’avant', async () => {
  const { a, x } = await threeGroups();
  const before = await contents();
  const h = await move(a.id, x.id);
  expect(await contents()).not.toEqual(before);
  const res = await undo([h], [h]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ undone: [h] });
  expect(await contents()).toEqual(before);
  const e = await entry(h);
  expect(e.status).toBe('undone');
  expect(e.undoneAt).toEqual(expect.any(String));
  expect(e.blocked).toBeNull();
});

test('cascade : annuler un déplacement emporte le plus récent qui touche la même catégorie', async () => {
  const { a, b, fromA, fromB, x } = await threeGroups();
  const h1 = await move(a.id, x.id);
  const h2 = await move(b.id, x.id);
  const list = await history();
  expect(list.map((e) => e.id)).toEqual([h2, h1]);
  expect(list.find((e) => e.id === h1)!.cascade).toEqual([h2]);
  expect(list.find((e) => e.id === h2)!.cascade).toEqual([]);
  const res = await undo([h1], [h2, h1]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ undone: [h2, h1] });
  for (const id of [h1, h2]) expect((await entry(id)).status).toBe('undone');
  expect((await catOf(a.id))!.id).toBe(fromA.id);
  expect((await catOf(b.id))!.id).toBe(fromB.id);
});

test('expect périmé : un autre poste a ajouté une action liée, rien n’est annulé', async () => {
  const { a, b, x } = await threeGroups();
  const h1 = await move(a.id, x.id);
  await move(b.id, x.id);
  const res = await undo([h1], [h1]);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Un autre poste a modifié ces tableaux : la liste est mise à jour.');
  expect((await history()).every((e) => e.status === 'active')).toBe(true);
  expect((await catOf(a.id))!.id).toBe(x.id);
  expect((await catOf(b.id))!.id).toBe(x.id);
});

test('catégorie supprimée puis restaurée : même id, même tableau', async () => {
  const { x } = await threeGroups();
  const lone = await reg({ lastName: 'SEULE', weightClassId: 'cadet:F:+61' });
  const loneCat = (await catOf(lone.id))!;
  const before = await contents();
  const h = await move(lone.id, x.id);
  expect((await categories()).some((c) => c.id === loneCat.id)).toBe(false);
  expect((await undo([h], [h])).statusCode).toBe(200);
  expect((await catOf(lone.id))!.id).toBe(loneCat.id);
  expect(await contents()).toEqual(before);
});

test('catégorie lancée : l’annulation est bloquée, avec la raison', async () => {
  const { a, x } = await threeGroups();
  const h = await move(a.id, x.id);
  const arrival = (await categories()).find((c) => c.id === x.id)!;
  const match = arrival.bracket!.matches!.find((m) => m.a.kind === 'entrant' && m.b.kind === 'entrant')!;
  expect((await call('PUT', `/categories/${x.id}/results/${match.id}`, { winner: 'a', method: 'points' })).statusCode).toBe(200);
  expect(arrival.label).toMatch(/^Karaté · Jiyu · /);
  expect((await entry(h)).blocked).toBe(lockedReason(arrival.label));
  expect(lockedReason(arrival.label)).toBe(`${arrival.label} est lancée : déverrouillez-la pour annuler.`);
  const res = await undo([h], [h]);
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe(lockedReason(arrival.label));
  expect((await entry(h)).status).toBe('active');
  expect(CHANGED_REASON).not.toBe(lockedReason(arrival.label));
});

test('session lancée : bloquée même pour une catégorie sans combat (aucun passage figé)', async () => {
  const a = await reg({ lastName: 'ALPHA', weightClassId: 'cadet:F:-47' });
  const b = await reg({ weightClassId: 'cadet:F:-47' });
  const from = (await catOf(a.id))!;
  const free = (await call('POST', '/free-tableaux', { name: 'Gala 1', discipline: 'karate', ruleset: 'jiyu' })).json() as Cat;
  // Après le déplacement : un combattant seul de chaque côté, donc aucun combat ni passage.
  const h = await move(a.id, free.id);
  const [zone] = (await call('GET', '/zones')).json() as { id: string }[];
  for (const c of await categories()) await call('PATCH', `/categories/${c.id}`, { status: 'ready', zoneId: zone!.id });
  expect((await call('POST', '/launch', { waveId: null })).statusCode).toBe(204);
  const cats = (await categories()) as (Cat & { launchLocked: boolean })[];
  const touched = cats.filter((c) => c.id === from.id || c.id === free.id);
  expect(touched).toHaveLength(2);
  // Aucun passage figé : seule la session lancée les ferme (comme `state.frozen` aujourd'hui).
  expect(touched.every((c) => !c.launchLocked)).toBe(true);
  const reasons = touched.map((c) => lockedReason(c.label));
  expect(reasons).toContain((await entry(h)).blocked);
  const res = await undo([h], [h]);
  expect(res.statusCode).toBe(409);
  expect(reasons).toContain(res.json().error);
  expect((await entry(h)).status).toBe('active');
  expect((await catOf(a.id))!.id).toBe(free.id);
  expect((await catOf(b.id))!.id).toBe(from.id);
});

test('session : la liste ne rend que les actions de la session demandée', async () => {
  const [matin, aprem] = (
    await call('PUT', '/waves', [
      { name: 'Matin', rules: { ageBandCodes: [], disciplines: ['kata'] } },
      { name: 'Après-midi', rules: { ageBandCodes: [], disciplines: ['karate'] } },
    ])
  ).json() as { id: string }[];
  const kataF = await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  await reg({ discipline: 'kata', ruleset: null, weightClassId: null });
  const kataM = await reg({ discipline: 'kata', ruleset: null, weightClassId: null, sex: 'M' });
  await reg({ discipline: 'kata', ruleset: null, weightClassId: null, sex: 'M' });
  const { a, x } = await threeGroups();
  const hKata = await move(kataF.id, (await catOf(kataM.id))!.id);
  const hKarate = await move(a.id, x.id);
  expect((await history(matin!.id)).map((e) => e.id)).toEqual([hKata]);
  expect((await history(aprem!.id)).map((e) => e.id)).toEqual([hKarate]);
  expect((await history()).map((e) => e.id)).toEqual([hKarate, hKata]);
  expect((await call('GET', '/history?waveId=inconnue')).statusCode).toBe(404);
});

test('recorded sans synchronisation : un changement de membres seul touche les deux catégories', async () => {
  const { a, fromA, x } = await threeGroups();
  const db = openDb(dbPath);
  try {
    const { historyId } = await recorded(
      db,
      competitionId,
      { kind: 'manual', waveId: null, summary: { registrationIds: [a.id] } },
      async () => {
        db.update(registrationsTable).set({ categoryId: x.id, placementLocked: true }).where(eq(registrationsTable.id, a.id)).run();
      },
      { sync: false },
    );
    expect(historyId).toEqual(expect.any(String));
    const row = db.select().from(historyEntries).where(eq(historyEntries.id, historyId!)).get()!;
    expect(JSON.parse(row.categoryIds).sort()).toEqual([fromA.id, x.id].sort());
    // Aucune ligne de catégorie n'a changé (pas de synchronisation) : rien à réécrire.
    expect(JSON.parse(row.beforeJson)).toEqual({ categories: [], created: [], registrations: [] });
    const after = JSON.parse(row.afterMembersJson) as Record<string, string[]>;
    expect(after[x.id]).toContain(a.id);
    expect(after[fromA.id]).not.toContain(a.id);
    // Rien de changé, aucun recasement : rien n'est écrit.
    const none = await recorded(db, competitionId, { kind: 'manual', waveId: null, summary: { registrationIds: [] } }, async () => 1, { sync: false });
    expect(none).toEqual({ result: 1, historyId: null });
  } finally {
    closeDb(db);
  }
});

test('plan groupé : une entrée « plan » par déplacement, même groupe, raisons reprises', async () => {
  // Deux seules en cadettes (-47, -54) et deux seules en minimes (-40, -45) : deux réunions.
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 39 });
  await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 41 });
  const shown = await applyPlan();
  expect(shown.moves).toHaveLength(2);
  const list = await history();
  expect(list.map((e) => e.kind)).toEqual(['plan', 'plan']);
  const [second, first] = list;
  expect(first!.groupId).toEqual(expect.any(String));
  expect(second!.groupId).toBe(first!.groupId);
  expect([first, second].map((e) => e!.summary.registrationIds)).toEqual(shown.moves.map((m) => [m.registrationId]));
  expect([first, second].map((e) => e!.summary.reason)).toEqual(shown.moves.map((m) => m.reason));
  const journal = (await replacement()).recasements;
  for (const e of list) {
    expect(e.summary.fromLabel).toEqual(expect.any(String));
    expect(e.summary.toLabel).toEqual(expect.any(String));
    expect(e.categoryIds.length).toBeGreaterThan(0);
    expect(journal.find((r) => r.registrationId === e.summary.registrationIds[0])!.reason).toBe(e.summary.reason);
  }
  // Une autre application : un autre groupe.
  await reg({ ageBandCode: 'junior', weightClassId: 'junior:F:-53', approxWeightKg: 50 });
  await reg({ ageBandCode: 'junior', weightClassId: 'junior:F:-59', approxWeightKg: 55 });
  await applyPlan();
  const [next] = await history();
  expect(next!.kind).toBe('plan');
  expect(next!.groupId).not.toBe(first!.groupId);
});

test('plan avec catégorie créée : annuler un seul déplacement, puis l’autre ; la catégorie créée disparaît, la vidée revient, chacun dans son tableau', async () => {
  // X pèse 58 kg (inscrite -54) : sa correction vers une -61 vide (nouvelle) est validée ; Y, seule en +61, la rejoint.
  const x = await reg({ lastName: 'X', weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  const y = await reg({ lastName: 'Y', weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
  const fromX = (await catOf(x.id))!;
  const fromY = (await catOf(y.id))!;
  expect((await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 })).statusCode).toBe(204);
  const r = await replacement();
  const c = r.cases.find((k) => k.kind === 'weight_out' && k.registrationId === x.id)!;
  const toNew = r.proposals[c.id]!.find((p) => 'newKey' in p.target)!;
  const shown = await applyPlan([{ kind: 'validate', proposalId: toNew.id, caseId: c.id }]);
  expect(shown.moves.map((m) => [m.registrationId, m.anchor])).toEqual([[x.id, null], [y.id, x.id]]);
  const created = (await catOf(x.id))!;
  expect([fromX.id, fromY.id]).not.toContain(created.id);
  expect(created.registrationIds).toEqual([x.id, y.id].sort());
  const [hY, hX] = await history();
  expect(hX!.summary.registrationIds).toEqual([x.id]);
  expect(hY!.summary.registrationIds).toEqual([y.id]);
  expect(hX!.categoryIds).toContain(created.id);
  expect(hY!.categoryIds).toContain(created.id);
  // Le déplacement qui crée la catégorie emporte celui qui la rejoint.
  expect(hX!.cascade).toEqual([hY!.id]);
  expect(hY!.cascade).toEqual([]);
  // Le plus récent seul : Y retrouve une catégorie +61, X reste seule dans la catégorie créée.
  let res = await undo([hY!.id], [hY!.id]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ undone: [hY!.id] });
  expect((await catOf(y.id))!.id).toBe(fromY.id);
  expect((await catOf(x.id))!.id).toBe(created.id);
  await everyoneInBracket();
  // Puis celui qui l'a créée : elle disparaît, X revient dans sa catégorie d'avant.
  expect((await entry(hX!.id)).cascade).toEqual([]);
  res = await undo([hX!.id], [hX!.id]);
  expect(res.statusCode).toBe(200);
  expect((await catOf(x.id))!.id).toBe(fromX.id);
  expect((await categories()).some((k) => k.id === created.id)).toBe(false);
  await everyoneInBracket();
  expect((await history()).every((e) => e.status === 'undone')).toBe(true);
});

test('plan avec catégorie créée : annuler le déplacement qui la crée emporte celui qui la rejoint', async () => {
  const x = await reg({ lastName: 'X', weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  const y = await reg({ lastName: 'Y', weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
  const fromX = (await catOf(x.id))!;
  const fromY = (await catOf(y.id))!;
  await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 });
  const r = await replacement();
  const c = r.cases.find((k) => k.kind === 'weight_out' && k.registrationId === x.id)!;
  const toNew = r.proposals[c.id]!.find((p) => 'newKey' in p.target)!;
  await applyPlan([{ kind: 'validate', proposalId: toNew.id, caseId: c.id }]);
  const created = (await catOf(x.id))!;
  const [hY, hX] = await history();
  const res = await undo([hX!.id], [hY!.id, hX!.id]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ undone: [hY!.id, hX!.id] });
  expect((await catOf(x.id))!.id).toBe(fromX.id);
  expect((await catOf(y.id))!.id).toBe(fromY.id);
  expect((await categories()).some((k) => k.id === created.id)).toBe(false);
  await everyoneInBracket();
});

test('plan : annuler un seul déplacement qui a vidé une catégorie la rend avec le même id, le combattant dans son tableau', async () => {
  // Deux seules en cadettes (-47, -54) et deux seules en minimes (-40, -45) : chaque réunion vide une catégorie.
  const c47 = await reg({ lastName: 'C47', weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const c54 = await reg({ lastName: 'C54', weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  const m40 = await reg({ lastName: 'M40', ageBandCode: 'minime', weightClassId: 'minime:F:-40', approxWeightKg: 39 });
  const m45 = await reg({ lastName: 'M45', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 41 });
  const before = new Map<string, Cat>();
  for (const r of [c47, c54, m40, m45]) before.set(r.id, (await catOf(r.id))!);
  const ids = new Set([...before.values()].map((c) => c.id));
  expect(ids.size).toBe(4);
  await applyPlan();
  expect((await categories()).length).toBe(2);
  // Le plus ancien des deux déplacements : sans cascade (l'autre ne touche pas les mêmes catégories).
  const [, older] = await history();
  expect(older!.cascade).toEqual([]);
  const moved = older!.summary.registrationIds[0]!;
  const emptied = before.get(moved)!;
  expect((await categories()).some((c) => c.id === emptied.id)).toBe(false);
  const res = await undo([older!.id], [older!.id]);
  expect(res.statusCode).toBe(200);
  const back = (await catOf(moved))!;
  expect(back.id).toBe(emptied.id);
  expect(back.bracket?.entrants.map((e) => e.registrationId) ?? []).toEqual(expect.arrayContaining([moved]));
  await everyoneInBracket();
});

test('réaffectation à l’unité journalisée ; annuler une réaffectation ancienne emporte la plus récente', async () => {
  const a = await reg({ lastName: 'ALPHA', weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const before = await contents();
  const fromA = (await catOf(a.id))!;
  const fromB = (await catOf(b.id))!;
  let r = await replacement();
  const prop = r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]! as unknown as { id: string; reason: string };
  expect((await call('POST', '/replacement/apply', { proposalId: prop.id })).statusCode).toBe(200);
  const [hApply] = await history();
  expect(hApply).toMatchObject({ kind: 'reaffectation', groupId: null, names: ['ALPHA x'], summary: { registrationIds: [a.id], reason: prop.reason } });
  const senior = await reg({ ageBandCode: 'senior', weightClassId: 'senior:F:-50' });
  const other = (await catOf(senior.id))!;
  const hMove = await move(a.id, other.id);
  r = await replacement();
  const first = r.recasements.find((x) => x.registrationId === a.id && x.type !== 'M')!;
  expect((await entry(hApply!.id)).cascade).toEqual([hMove]);
  const res = await call('POST', '/replacement/undo', { recasementId: first.id });
  expect(res.statusCode).toBe(200);
  for (const id of [hApply!.id, hMove]) expect((await entry(id)).status).toBe('undone');
  expect((await replacement()).recasements.filter((x) => x.registrationId === a.id).map((x) => x.status)).toEqual(['undone', 'undone']);
  expect((await catOf(a.id))!.id).toBe(fromA.id);
  expect((await catOf(b.id))!.id).toBe(fromB.id);
  const now = (await contents()).filter((c) => !c.registrationIds.includes(senior.id));
  expect(now).toEqual(before);
  // Déjà annulée : introuvable (comme avant).
  expect((await call('POST', '/replacement/undo', { recasementId: first.id })).statusCode).toBe(404);
});

test('« Ne combat pas » journalisé et annulable depuis l’historique', async () => {
  const a = await reg({ lastName: 'ALPHA' });
  await reg();
  await reg();
  const from = (await catOf(a.id))!;
  const cell = { ageBandCode: 'cadet', sex: 'F', discipline: 'karate', ruleset: 'jiyu' };
  expect((await call('PUT', '/closed-categories', { cells: [cell], closed: true })).statusCode).toBeLessThan(300);
  const before = await contents();
  const res = await call('POST', '/replacement/withdraw', { registrationId: a.id, fingerprint: (await replacement()).fingerprint });
  expect(res.statusCode).toBe(200);
  const [e] = await history();
  expect(e).toMatchObject({
    kind: 'withdraw', groupId: null, names: ['ALPHA x'], blocked: null, cascade: [],
    summary: { registrationIds: [a.id], fromLabel: from.label, toLabel: 'Ne combat pas', reason: 'Catégorie non ouverte à cette compétition' },
  });
  expect(e!.categoryIds).toContain(from.id);
  expect((await undo([e!.id], [e!.id])).statusCode).toBe(200);
  expect((await catOf(a.id))!.id).toBe(from.id);
  expect(await contents()).toEqual(before);
  expect((await replacement()).recasements[0]!.status).toBe('undone');
});
