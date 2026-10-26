import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { rulesView } from '../../src/domain/replacement/rules.js';
import { defaultSettings } from '../../src/domain/settings.js';
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
type Choice = { kind: 'validate'; proposalId: string; caseId: string } | { kind: 'manual'; registrationId: string; categoryId: string };
type PlanBody = { waveId?: string; choices?: Choice[]; forApply?: boolean };
type PlanOut = {
  view: { order: string[]; cutAfter: string };
  rows: { rule: string | null; on: boolean; alone: number | null; moves: number; toValidate: number; proven: boolean }[];
  plan: { moves: { id: string; registrationId: string; type: string; manual: boolean; anchor: string | null; validated: boolean }[]; aloneBefore: number; alone: string[]; onCards: string[]; dropped: unknown[]; proven: boolean; hash: string; refused: { proposalId: string; registrationId: string; reason: string }[] };
  categories?: { label: string; before: string[][]; after: string[][] }[];
  fingerprint: string;
};
const plan = async (body: PlanBody = {}) => (await call('POST', '/replacement/plan', { choices: [], ...body })).json() as PlanOut;
/** Plan à appliquer (sans validation), puis application avec son empreinte et son hash. */
const applyPlan = async (body: PlanBody = {}) => {
  const p = await plan({ ...body, forApply: true });
  return call('POST', '/replacement/plan/apply', { waveId: body.waveId, choices: body.choices ?? [], fingerprint: p.fingerprint, hash: p.plan.hash });
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

test('plan : diagramme, plan et empreinte', async () => {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  const p = await plan();
  expect(p.rows[0]).toMatchObject({ rule: null, on: true, alone: 2, moves: 0 });
  expect(p.rows.length).toBe(p.view.order.length + 1);
  expect(p.plan.moves.length).toBeGreaterThan(0);
  expect(p.plan).toMatchObject({ aloneBefore: 2, alone: [], refused: [], dropped: [] });
  expect(typeof p.plan.hash).toBe('string');
  expect(p.categories).toBeUndefined();
  expect(p.fingerprint).toBe((await replacement()).fingerprint);
  // Sans effet sur la base.
  expect((await categories()).map((c) => c.registrationIds.length)).toEqual([1, 1]);
});

test('plan à appliquer : pas de diagramme, aperçu avant / après', async () => {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  const p = await plan({ forApply: true });
  expect(p.rows).toEqual([]);
  expect(p.categories!.some((c) => c.after.flat().length === 2)).toBe(true);
});

test('plan : les propositions refusées des cas ouverts sont listées', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  const r = await replacement();
  const pid = r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!.id;
  await call('POST', '/replacement/refuse', { proposalId: pid });
  const p = await plan();
  expect(p.plan.refused).toEqual([{ proposalId: pid, registrationId: a.id, reason: expect.any(String) }]);
});

test('plan : 501 choix refusés', async () => {
  const choices = Array.from({ length: 501 }, () => ({ kind: 'manual', registrationId: 'x', categoryId: 'y' }));
  expect((await call('POST', '/replacement/plan', { choices })).statusCode).toBe(400);
});

test('appliquer : sans validation et validés seulement, journal « en masse »', async () => {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  const mini = await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
  const res = await applyPlan();
  expect(res.json()).toEqual({ applied: 1 });
  let r = await replacement();
  expect(r.recasements.map((x) => x.type)).toEqual(['A']);
  expect(r.recasements[0]!.registrationId).not.toBe(mini.id);
  expect(r.cases.map((c) => c.registrationId)).toEqual([mini.id]); // la minime reste (cas à valider)
  const c = r.cases[0]!;
  const proposalId = r.proposals[c.id]![0]!.id;
  expect(r.proposals[c.id]![0]!.type).toBe('C');
  const choices: Choice[] = [{ kind: 'validate', proposalId, caseId: c.id }];
  expect((await applyPlan({ choices })).json()).toEqual({ applied: 1 });
  r = await replacement();
  expect(r.cases).toEqual([]);
  const entry = (await call('GET', '/replacement')).json().recasements.find((x: { registrationId: string }) => x.registrationId === mini.id);
  expect(entry).toMatchObject({ type: 'C', manual: true, bulk: true });
});

test('plan : un choix « manuel » est appliqué, et un choix aux champs inconnus est refusé (400)', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ approxWeightKg: 50 });
  await reg({ approxWeightKg: 51 });
  const target = (await categories()).find((c) => c.label.includes('-54'))!;
  const choices: Choice[] = [{ kind: 'manual', registrationId: a.id, categoryId: target.id }];
  expect((await applyPlan({ choices })).json()).toEqual({ applied: 1 });
  expect((await categories()).find((c) => c.id === target.id)!.registrationIds).toContain(a.id);
  const entry = (await replacement()).recasements.find((r) => r.registrationId === a.id)!;
  expect(entry).toMatchObject({ type: 'M', status: 'validated' });
  const extra = [{ kind: 'manual', registrationId: a.id, categoryId: target.id, surplus: 1 }];
  expect((await call('POST', '/replacement/plan', { choices: extra })).statusCode).toBe(400);
});

test('plan en flux : en-têtes contre la mise en tampon (Caddy encode gzip), comme le flux d’événements', async () => {
  await reg();
  const res = await app.inject({ method: 'POST', url: `${base}/replacement/plan`, headers: { accept: 'application/x-ndjson' }, payload: { choices: [] } });
  expect(res.statusCode).toBe(200);
  expect(res.headers).toMatchObject({ 'content-type': expect.stringContaining('application/x-ndjson'), 'content-encoding': 'identity', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
});

test('valider un déplacement qui n’existe qu’après une correction de poids : gardé, appliqué après elle', async () => {
  // W (pesée 58 kg) quitte les -54 pour les -61 : Y y reste seule, et sa seule issue est la tranche au-dessus.
  const w = await reg({ lastName: 'W', approxWeightKg: 52 });
  const y = await reg({ lastName: 'Y', approxWeightKg: 53 });
  for (const kg of [58, 58.5]) await reg({ weightClassId: 'cadet:F:-61', approxWeightKg: kg });
  for (const kg of [52, 52.5]) await reg({ ageBandCode: 'junior', weightClassId: 'junior:F:-53', approxWeightKg: kg });
  await call('PUT', `/weigh-in/${w.fighterId}`, { weighInKg: 58 });
  const def = rulesView(defaultSettings());
  expect((await call('PUT', '/replacement/rules', { ...def, on: { ...def.on, weightGap: false } })).statusCode).toBe(200);
  const shown = await plan();
  expect(shown.plan.moves.map((m) => [m.registrationId, m.manual])).toEqual([[w.id, false], [y.id, true]]);
  const yMove = shown.plan.moves[1] as unknown as { id: string; caseId: string };
  const choices: Choice[] = [{ kind: 'validate', proposalId: yMove.id, caseId: yMove.caseId }];
  const pinned = await plan({ choices });
  expect(pinned.plan.dropped).toEqual([]);
  expect(pinned.plan.moves.map((m) => [m.registrationId, m.validated])).toEqual([[w.id, false], [y.id, true]]);
  const toApply = await plan({ choices, forApply: true });
  expect(toApply.plan.moves.map((m) => m.registrationId)).toEqual([w.id, y.id]);
  expect((await applyPlan({ choices })).json()).toEqual({ applied: 2 });
  const r = await replacement();
  expect(r.cases).toEqual([]);
  expect(r.recasements.find((e) => e.registrationId === y.id)).toMatchObject({ type: 'C', status: 'validated' });
});

test('appliquer : jamais une règle sans validation placée sous la ligne', async () => {
  // A et B seules, voisines de poids : la règle 2 les réunit, sauf si la ligne passe juste après le retour.
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:-61', approxWeightKg: 55 });
  const def = rulesView(defaultSettings());
  expect((await call('PUT', '/replacement/rules', { ...def, cutAfter: 'return' })).statusCode).toBe(200);
  expect((await plan()).plan.moves).toEqual([]);
  expect((await plan({ forApply: true })).plan.moves).toEqual([]);
  expect((await applyPlan()).json()).toEqual({ applied: 0 });
});

test('appliquer un plan périmé : 409, rien d’appliqué', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  const p = await plan({ forApply: true });
  await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 47 });
  const res = await call('POST', '/replacement/plan/apply', { choices: [], fingerprint: p.fingerprint, hash: p.plan.hash });
  expect(res.statusCode).toBe(409);
  expect((await replacement()).recasements).toEqual([]);
  expect((await call('POST', '/replacement/plan/apply', { choices: [], fingerprint: 'périmée', hash: p.plan.hash })).statusCode).toBe(409);
});

test('appliquer un plan qui a changé : 409', async () => {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 49 });
  const p = await plan({ forApply: true });
  const res = await call('POST', '/replacement/plan/apply', { choices: [], fingerprint: p.fingerprint, hash: 'autre' });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('Le plan a changé depuis l’affichage : relisez-le avant de l’appliquer.');
  expect((await replacement()).recasements).toEqual([]);
});

test('nouvelle catégorie puis un autre combattant qui la rejoint : appliqué en entier', async () => {
  // X pèse 58 kg (inscrit -54). L'organisateur valide sa correction vers une catégorie -61 vide (nouvelle) ;
  // Y, seule en +61, la rejoint ensuite : son déplacement vise une catégorie qui n'existe pas encore en base.
  const x = await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 52 });
  const y = await reg({ weightClassId: 'cadet:F:+61', approxWeightKg: 62 });
  await call('PUT', `/weigh-in/${x.fighterId}`, { weighInKg: 58 });
  const r = await replacement();
  const c = r.cases.find((k) => k.kind === 'weight_out' && k.registrationId === x.id)!;
  const toNew = (r.proposals[c.id] as unknown as { id: string; target: object }[]).find((p) => 'newKey' in p.target)!;
  const choices: Choice[] = [{ kind: 'validate', proposalId: toNew.id, caseId: c.id }];
  const before = await plan({ forApply: true, choices });
  expect(before.plan.moves.map((m) => m.registrationId)).toEqual([x.id, y.id]);
  expect(before.plan.moves[0]).toMatchObject({ validated: true, anchor: null });
  expect(before.plan.moves[1]!.anchor).toBe(x.id);
  expect(before.plan.alone).toEqual([]);
  expect((await applyPlan({ choices })).json()).toEqual({ applied: 2 });
  const cats = await categories();
  expect(cats.map((k) => k.registrationIds.length).sort()).toEqual([2, 2]);
  expect(cats.find((k) => k.registrationIds.includes(x.id))!.registrationIds).toContain(y.id);
  const journal = (await replacement()).recasements;
  expect(journal.map((e) => e.registrationId).sort()).toEqual([x.id, y.id].sort());
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
  // L'aperçu « en masse » n'existe plus : le plan d'ensemble a sa propre route.
  expect((await call('POST', '/replacement/preview', { bulk: 'all' })).statusCode).toBe(400);
});

test('la route en masse n’existe plus', async () => {
  expect((await call('POST', '/replacement/bulk', { mode: 'all', fingerprint: 'x' })).statusCode).toBe(404);
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

test('catégorie lancée : jamais cible ni modifiée par le plan d’ensemble', async () => {
  await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  const b = await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const cat54 = (await categories()).find((c) => c.registrationIds.includes(b.id))!;
  await call('PATCH', `/categories/${cat54.id}`, { status: 'started' });
  const r = await replacement();
  expect(Object.values(r.proposals).flat().some((p) => p.id.includes(cat54.id))).toBe(false);
  await applyPlan();
  expect((await categories()).find((c) => c.id === cat54.id)!.registrationIds).toHaveLength(2);
});

test('annulation : clé de catégorie recalculée ; seulement la réaffectation la plus récente d’une inscription', async () => {
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

test('annulation d’un ancien réaffectation refusée si un plus récent existe pour la même inscription', async () => {
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

test('pesée : un réaffecté n’est pas « hors catégorie », il est signalé « réaffecté »', async () => {
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

test('journal : motif de la réaffectation ; pesée : catégorie de chaque inscription', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
  await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
  const r = await replacement();
  const p = r.proposals[r.cases.find((x) => x.registrationId === a.id)!.id]![0]!;
  await call('POST', '/replacement/apply', { proposalId: p.id });
  expect((await replacement()).recasements[0]!.reason).toBe(p.reason);
  const w = (await call('GET', '/weigh-in')).json() as { fighters: { fighterId: string; registrations: { categoryLabel: string | null }[] }[] };
  expect(w.fighters.find((f) => f.fighterId === a.fighterId)!.registrations[0]!.categoryLabel).toBe('Karaté · Jiyu · Cadets F · -47 / -54 kg');
});

test('annulation : ordre fiable même si deux réaffectations ont la même heure (à la milliseconde)', async () => {
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

describe('pesée par session', () => {
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

  test('liste limitée aux combattants de la session', async () => {
    const { kata, combat } = await twoWaves();
    expect((await list(kata)).fighters.map((f) => f.registrations.map((r) => r.discipline))).toEqual([['kata']]);
    expect((await list(combat)).fighters).toHaveLength(2);
  });

  test('combattant dans deux sessions : présence indépendante', async () => {
    const { both, kata, combat } = await twoWaves();
    await call('PUT', `/weigh-in/${both.fighterId}`, { presence: 'absent', waveId: combat });
    expect(await presences()).toEqual(['COMBAT:karate:unknown', 'DEUX:karate:absent', 'DEUX:kata:unknown']);
    await call('PUT', `/weigh-in/${both.fighterId}`, { weighInKg: 50, waveId: kata });
    expect(await presences()).toEqual(['COMBAT:karate:unknown', 'DEUX:karate:absent', 'DEUX:kata:present']);
    expect((await list(kata)).fighters[0]!.presence).toBe('present');
    expect((await list(combat)).fighters.find((f) => f.fighterId === both.fighterId)!.presence).toBe('absent');
  });

  test('clôture de la session du matin : les autres sessions ne bougent pas', async () => {
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

describe('pesée par session (relecture)', () => {
  const bands = ['poussin', 'pupille', 'benjamin', 'minime', 'cadet', 'junior', 'senior'];
  test('catégorie d’arrivée d’une réaffectation : garde sa session', async () => {
    const minime = await reg({ lastName: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-50' });
    for (let i = 0; i < 3; i++) await reg({ lastName: `CAD${i}`, weightClassId: 'cadet:F:-54' });
    const [matin, aprem] = (await call('PUT', '/waves', [
      { name: 'Matin', rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] } },
      { name: 'Après-midi', rules: { ageBandCodes: ['cadet', 'junior', 'senior'], disciplines: [] } },
    ])).json() as { id: string }[];
    const cadets = (await categories()).find((c) => c.label.includes('Cadets'))!;
    expect((await call('POST', '/replacement/move', { registrationId: minime.id, categoryId: cadets.id })).statusCode).toBe(200);
    const after = ((await call('GET', '/categories')).json() as { id: string; waveId: string | null }[]).find((c) => c.id === cadets.id)!;
    expect(after.waveId).toBe(aprem!.id);
    void matin;
  });

  test('sans session : clôturer ne marque pas absent un combattant déjà présent (inscrit ensuite sur place en kata)', async () => {
    const a = await reg({ lastName: 'PESEE' });
    await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 53 });
    await call('POST', '/registrations', { clubId: null, lastName: 'PESEE', firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'onsite' });
    const closed = (await call('POST', '/weigh-in/close')).json() as { markedAbsent: number };
    expect(closed.markedAbsent).toBe(0);
    const regs = (await call('GET', '/registrations')).json() as { presence: string }[];
    expect(regs.map((r) => r.presence)).toEqual(['present', 'present']);
  });

  test('avec des sessions : pointage et clôture sans session refusés (400), poids non enregistré', async () => {
    const a = await reg({ lastName: 'X' });
    await call('PUT', '/waves', [{ name: 'Tous', rules: { ageBandCodes: bands, disciplines: [] } }]);
    expect((await call('POST', '/weigh-in/close')).statusCode).toBe(400);
    expect((await call('PUT', `/weigh-in/${a.fighterId}`, { presence: 'present' })).statusCode).toBe(400);
    expect((await call('PUT', `/weigh-in/${a.fighterId}`, { weighInKg: 77, waveId: 'inconnue' })).statusCode).toBe(404);
    const w = (await call('GET', '/registrations')).json() as { fighter: { weighInKg: number | null } }[];
    expect(w[0]!.fighter.weighInKg).toBeNull();
  });

  test('compteurs de la réaffectation : un combattant présent dans une session compte comme présent', async () => {
    const a = await reg({ lastName: 'DEUX' });
    await call('POST', '/registrations', { clubId: null, lastName: 'DEUX', firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual' });
    const [kata, combat] = (await call('PUT', '/waves', [
      { name: 'Kata', rules: { ageBandCodes: [], disciplines: ['kata'] } },
      { name: 'Combats', rules: { ageBandCodes: bands, disciplines: [] } },
    ])).json() as { id: string }[];
    await call('PUT', `/weigh-in/${a.fighterId}`, { presence: 'present', waveId: kata!.id });
    await call('PUT', `/weigh-in/${a.fighterId}`, { presence: 'absent', waveId: combat!.id });
    expect((await replacement()).summary).toMatchObject({ present: 1, absent: 0, unknown: 0 });
  });
});

describe('réaffectation par session', () => {
  type P = {
    id: string; type: string; preApproved: boolean; waveChange: { from: string | null; to: string | null } | null;
    waveShifts: { registrationId: string; from: string | null; to: string | null }[];
  };
  /**
   * Matin (poussins à minimes) : une minime seule dont la seule proposition est la catégorie cadette (Après-midi).
   * Après-midi : une cadette -61 seule, recasable en +61 (cas simple).
   */
  async function setup() {
    const mini = await reg({ lastName: 'MINI', ageBandCode: 'minime', weightClassId: 'minime:F:-45', approxWeightKg: 45 });
    for (let i = 0; i < 2; i++) await reg({ lastName: `CAD${i}`, weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
    const alone = await reg({ lastName: 'SEULE', weightClassId: 'cadet:F:-61', approxWeightKg: 58 });
    for (let i = 0; i < 2; i++) await reg({ lastName: `LOURDE${i}`, weightClassId: 'cadet:F:+61', approxWeightKg: 60 });
    const [matin, aprem] = (await call('PUT', '/waves', [
      { name: 'Matin', rules: { ageBandCodes: ['poussin', 'pupille', 'benjamin', 'minime'], disciplines: [] } },
      { name: 'Après-midi', rules: { ageBandCodes: ['cadet', 'junior', 'senior'], disciplines: [] } },
    ])).json() as { id: string }[];
    return { mini, alone, matin: matin!.id, aprem: aprem!.id };
  }
  const ofWave = async (wave: string) => (await call('GET', `/replacement?vague=${wave}`)).json() as Replacement & { proposals: Record<string, P[]> };
  const regRow = async (id: string) =>
    ((await call('GET', '/registrations')).json() as { id: string; presence: string; categoryId: string; fighter: { weighInKg: number | null } }[]).find((r) => r.id === id)!;
  const waveOfReg = async (id: string) => ((await call('GET', '/categories')).json() as { registrationIds: string[]; waveId: string | null }[]).find((c) => c.registrationIds.includes(id))!.waveId;

  test('GET ?vague= : cas de la session seulement ; compteurs de la session', async () => {
    const { mini, alone, matin, aprem } = await setup();
    await call('PUT', `/weigh-in/${mini.fighterId}`, { presence: 'present', weighInKg: 45, waveId: matin });
    const m = await ofWave(matin);
    expect(m.cases.map((c) => c.registrationId)).toEqual([mini.id]);
    expect(Object.keys(m.proposals)).toEqual([m.cases[0]!.id]);
    expect(m.summary).toMatchObject({ present: 1, absent: 0, unknown: 0, cases: 1, alone: 1, withoutProposal: 0 });
    const a = await ofWave(aprem);
    expect(a.cases.map((c) => c.registrationId)).toEqual([alone.id]);
    expect(a.summary).toMatchObject({ present: 0, unknown: 5, cases: 1 });
    // Sans vague dans l'adresse : tous les cas.
    expect((await replacement()).cases).toHaveLength(2);
    expect((await call('GET', '/replacement?vague=inconnue')).statusCode).toBe(404);
  });

  test('proposition vers une autre session : marquée, validable à la main ; l’inscription repasse « non pesé » ; le poids reste', async () => {
    const { mini, matin, aprem } = await setup();
    await call('PUT', `/weigh-in/${mini.fighterId}`, { presence: 'present', weighInKg: 45, waveId: matin });
    const r = await ofWave(matin);
    const [p] = r.proposals[r.cases[0]!.id]!;
    expect(p).toMatchObject({ type: 'C', preApproved: false, waveChange: { from: matin, to: aprem } });
    expect((await call('POST', '/replacement/apply', { proposalId: p!.id, fingerprint: r.fingerprint })).statusCode).toBe(200);
    const row = await regRow(mini.id);
    expect(row.presence).toBe('unknown');
    expect(row.fighter.weighInKg).toBe(45);
    expect(await waveOfReg(mini.id)).toBe(aprem);
    const w = (await call('GET', `/weigh-in?vague=${aprem}`)).json() as { fighters: { fighterId: string; presence: string; weighInKg: number | null }[] };
    expect(w.fighters.find((f) => f.fighterId === mini.fighterId)).toMatchObject({ presence: 'unknown', weighInKg: 45 });
    expect((await call('GET', `/weigh-in?vague=${matin}`)).json().fighters).toEqual([]);
  });

  test('annuler : catégorie et présence d’avant rétablies', async () => {
    const { mini, matin } = await setup();
    await call('PUT', `/weigh-in/${mini.fighterId}`, { presence: 'present', weighInKg: 45, waveId: matin });
    const r = await ofWave(matin);
    await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases[0]!.id]![0]!.id });
    expect((await regRow(mini.id)).presence).toBe('unknown');
    const entry = (await replacement()).recasements[0]!;
    expect((await call('POST', '/replacement/undo', { recasementId: entry.id })).statusCode).toBe(200);
    expect((await regRow(mini.id)).presence).toBe('present');
    // La catégorie vidée par le recasement a été supprimée : l'annulation la recrée (nouvel identifiant).
    expect((await categories()).find((c) => c.registrationIds.includes(mini.id))!.label).toContain('Minimes');
    expect(await waveOfReg(mini.id)).toBe(matin);
  });

  test('sessions : waveId obligatoire, inconnu 404, une seule session traitée', async () => {
    const { mini, alone, matin, aprem } = await setup();
    // Matin : la minime n'a que des propositions qui changent de session, le plan n'y touche pas.
    const forMatin = await plan({ waveId: matin });
    expect(forMatin.plan.moves).toEqual([]);
    expect(forMatin.plan.alone).toEqual([mini.id]);
    expect((await applyPlan({ waveId: matin })).json()).toEqual({ applied: 0 });
    expect((await ofWave(matin)).cases.map((c) => c.registrationId)).toEqual([mini.id]);

    expect((await call('POST', '/replacement/plan', { choices: [] })).statusCode).toBe(400);
    expect((await call('POST', '/replacement/plan/apply', { choices: [], fingerprint: 'x', hash: 'x' })).statusCode).toBe(400);
    expect((await call('POST', '/replacement/plan', { choices: [], waveId: 'inconnue' })).statusCode).toBe(404);
    expect((await call('POST', '/replacement/plan/apply', { choices: [], fingerprint: 'x', hash: 'x', waveId: 'inconnue' })).statusCode).toBe(404);

    expect((await plan({ waveId: aprem, forApply: true })).plan.moves).toHaveLength(1);
    expect((await applyPlan({ waveId: aprem })).json()).toEqual({ applied: 1 });
    expect((await ofWave(aprem)).cases).toEqual([]);
    expect((await replacement()).recasements.map((x) => x.registrationId)).toEqual([alone.id]);
  });

  test('empreinte : sessions modifiées entre le plan et son application → 409', async () => {
    const { aprem } = await setup();
    const p = await plan({ waveId: aprem, forApply: true });
    const waves = (await call('GET', '/waves')).json() as { id: string; name: string; rules: { ageBandCodes: string[]; disciplines: string[] } }[];
    await call('PUT', '/waves', waves.map((w) => ({ id: w.id, name: w.name, rules: { ...w.rules, ageBandCodes: [...w.rules.ageBandCodes, 'espoir'] } })));
    const apply = (q: PlanOut) => call('POST', '/replacement/plan/apply', { waveId: aprem, choices: [], fingerprint: q.fingerprint, hash: q.plan.hash });
    expect((await apply(p)).statusCode).toBe(409);
    const p2 = await plan({ waveId: aprem, forApply: true });
    const cat = ((await call('GET', '/categories')).json() as { id: string; waveId: string | null }[]).find((c) => c.waveId === aprem)!;
    await call('PATCH', `/categories/${cat.id}`, { waveOverride: 'none' });
    expect((await apply(p2)).statusCode).toBe(409);
  });

  test('changement de session entraîné : les réaffectés qui changent de session avec leur catégorie repassent « non pesé » ; annuler rétablit', async () => {
    const { mini, matin, aprem } = await setup();
    let r = await ofWave(matin);
    await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases[0]!.id]![0]!.id });
    const cads = ((await call('GET', '/registrations')).json() as { id: string; fighterId: string; fighter: { lastName: string } }[]).filter((x) => x.fighter.lastName.startsWith('CAD'));
    for (const c of cads) await call('PUT', `/weigh-in/${c.fighterId}`, { weighInKg: 52, waveId: aprem });
    await call('PUT', `/weigh-in/${mini.fighterId}`, { presence: 'present', waveId: aprem });
    expect((await applyPlan({ waveId: aprem })).json()).toEqual({ applied: 2 }); // CAD0 et SEULE
    expect(await waveOfReg(mini.id)).toBe(aprem);
    r = await ofWave(aprem);
    // Le plan a casé l'une des deux cadettes ; l'autre, dernière d'origine, est encore hors catégorie.
    const last = r.cases.find((c) => c.kind === 'weight_out' && cads.some((x) => x.id === c.registrationId))!;
    const p = r.proposals[last.id]![0]!;
    expect(p.waveShifts).toMatchObject([{ registrationId: mini.id, from: aprem, to: matin }]);
    await call('POST', '/replacement/apply', { proposalId: p.id });
    expect(await waveOfReg(mini.id)).toBe(matin);
    expect((await regRow(mini.id)).presence).toBe('unknown');
    expect((await regRow(last.registrationId)).presence).toBe('present');
    const entry = (await replacement()).recasements.find((x) => x.registrationId === last.registrationId)!;
    await call('POST', '/replacement/undo', { recasementId: entry.id });
    expect(await waveOfReg(mini.id)).toBe(aprem);
    expect((await regRow(mini.id)).presence).toBe('present');
  });

  test('sans session : annuler ne touche pas à la présence (pointée absente après la réaffectation)', async () => {
    const a = await reg({ weightClassId: 'cadet:F:-47', approxWeightKg: 46 });
    await reg({ weightClassId: 'cadet:F:-54', approxWeightKg: 50 });
    await call('PUT', `/weigh-in/${a.fighterId}`, { presence: 'present' });
    const r = await replacement();
    await call('POST', '/replacement/apply', { proposalId: r.proposals[r.cases.find((c) => c.registrationId === a.id)!.id]![0]!.id });
    await call('PUT', `/weigh-in/${a.fighterId}`, { presence: 'absent' });
    await call('POST', '/replacement/undo', { recasementId: (await replacement()).recasements[0]!.id });
    expect((await regRow(a.id)).presence).toBe('absent');
  });
});

test('split : le seul en +84 reçoit les deux plus lourds de -84 (une réaffectation chacun), aperçu compris', async () => {
  const sen = (kg: number, wc = 'senior:M:-84') => reg({ sex: 'M', ageBandCode: 'senior', weightClassId: wc, approxWeightKg: kg });
  const alone = await sen(85, 'senior:M:+84');
  const below = [await sen(72), await sen(78), await sen(83), await sen(84)];
  const r = await replacement();
  const c = r.cases.find((x) => x.registrationId === alone.id)!;
  const pull = r.proposals[c.id]!.find((p) => p.reason.includes('pour donner une poule'))!;
  expect(pull.manual).toBe(false);
  const preview = (await call('POST', '/replacement/preview', { proposalId: pull.id })).json() as { categories: { label: string; after: string[][] }[] };
  expect(preview.categories.find((x) => x.label.includes('+84'))!.after.flat()).toHaveLength(3);
  expect((await call('POST', '/replacement/apply', { proposalId: pull.id, fingerprint: r.fingerprint })).statusCode).toBe(200);
  const cat = (await categories()).find((x) => x.registrationIds.includes(alone.id))!;
  expect(cat.registrationIds.sort()).toEqual([alone.id, below[2]!.id, below[3]!.id].sort());
  const after = await replacement();
  expect(after.recasements.map((x) => x.registrationId).sort()).toEqual([below[2]!.id, below[3]!.id].sort());
  expect(after.cases.some((x) => x.kind === 'alone' || x.kind === 'return')).toBe(false);
});

test('catégorie fermée : carte, compteur et cibles manuelles', async () => {
  await reg();
  await reg();
  await reg({ weightClassId: 'cadet:F:-61' });
  await reg({ weightClassId: 'cadet:F:-61' });
  const junior = await reg({ ageBandCode: 'junior', weightClassId: 'junior:F:-53' });
  await reg({ ageBandCode: 'junior', weightClassId: 'junior:F:-48' });
  const cell = (ageBandCode: string) => ({ ageBandCode, sex: 'F', discipline: 'karate', ruleset: 'jiyu' });
  await call('PUT', '/closed-categories', { cells: [cell('cadet')], closed: true });
  expect((await replacement()).summary.closed).toBe(4);
  await call('PUT', '/closed-categories', { cells: [cell('cadet')], closed: false });
  await call('PUT', '/closed-categories', { cells: [cell('junior')], closed: true });
  const r = (await call('GET', '/replacement')).json() as Replacement & { moveTargets: Record<string, { categoryId: string }[]> };
  expect(r.cases.find((c) => c.id === `closed:${junior.id}`)).toBeDefined();
  const juniorCats = (await categories()).filter((c) => c.label.includes('Juniors')).map((c) => c.id);
  expect(r.moveTargets[`closed:${junior.id}`]!.some((t) => juniorCats.includes(t.categoryId))).toBe(false);
  expect(juniorCats).toHaveLength(2);
  expect(r.summary.closed).toBe(2);
});

const closeCadet = (closed = true) => call('PUT', '/closed-categories', { cells: [{ ageBandCode: 'cadet', sex: 'F', discipline: 'karate', ruleset: 'jiyu' }], closed });
const withdraw = async (registrationId: string) => call('POST', '/replacement/withdraw', { registrationId, fingerprint: (await replacement()).fingerprint });

test("ne combat pas : hors tableau, hors pesée, dans l'historique", async () => {
  const a = await reg();
  await reg();
  await reg();
  await closeCadet();
  expect((await withdraw(a.id)).statusCode).toBe(200);
  expect((await categories()).some((c) => c.registrationIds.includes(a.id))).toBe(false);
  const w = (await call('GET', '/weigh-in')).json() as { fighters: { fighterId: string }[] };
  expect(w.fighters.some((f) => f.fighterId === a.fighterId)).toBe(false);
  const rows = (await call('GET', '/registrations')).json() as { id: string; withdrawn: boolean }[];
  expect(rows.find((r) => r.id === a.id)!.withdrawn).toBe(true);
  const r = await replacement();
  expect(r.cases.some((c) => c.registrationId === a.id)).toBe(false);
  expect(r.recasements[0]).toMatchObject({ registrationId: a.id, type: 'W', toLabel: 'Ne combat pas', status: 'validated' });
});

test('annuler « ne combat pas » après réouverture : catégorie normale, pas de carte', async () => {
  const a = await reg();
  await reg();
  await closeCadet();
  await withdraw(a.id);
  await closeCadet(false);
  const entry = (await replacement()).recasements[0]!;
  expect((await call('POST', '/replacement/undo', { recasementId: entry.id })).statusCode).toBe(200);
  expect((await categories()).some((c) => c.registrationIds.includes(a.id))).toBe(true);
  const rows = (await call('GET', '/registrations')).json() as { id: string; withdrawn: boolean }[];
  expect(rows.find((r) => r.id === a.id)!.withdrawn).toBe(false);
  expect((await replacement()).cases).toEqual([]);
});

test('ne combat pas refusé hors catégorie fermée', async () => {
  const a = await reg();
  await reg();
  const res = await withdraw(a.id);
  expect(res.statusCode).toBe(409);
  expect(res.body).toContain('Ce combattant n’est plus dans une catégorie fermée : rechargez.');
});

test('mise de côté : compteurs, reprise, disparition quand le cas est réglé', async () => {
  const a = await reg();
  const caseId = `alone:${a.id}`;
  expect((await call('POST', '/replacement/set-aside', { caseId, note: 'on attend le coach' })).statusCode).toBe(200);
  let r = (await call('GET', '/replacement')).json() as Replacement & { setAside: Record<string, { note: string }> };
  expect(r.summary.cases).toBe(0);
  expect(r.summary.setAside).toBe(1);
  expect(r.setAside[caseId]!.note).toBe('on attend le coach');
  expect((await call('POST', '/replacement/resume', { caseId })).statusCode).toBe(200);
  expect((await replacement()).summary.cases).toBe(1);
  // Remise de côté, puis le cas disparaît (un adversaire arrive) et revient : il revient dans la liste principale.
  await call('POST', '/replacement/set-aside', { caseId });
  const b = await reg();
  expect((await replacement()).cases).toEqual([]);
  expect((await app.inject({ method: 'DELETE', url: `${base}/registrations/${b.id}` })).statusCode).toBe(204);
  r = (await call('GET', '/replacement')).json() as Replacement & { setAside: Record<string, { note: string }> };
  expect(r.summary.cases).toBe(1);
  expect(r.summary.setAside).toBe(0);
});

test("mise de côté d'une carte qui n'existe plus : 409", async () => {
  const res = await call('POST', '/replacement/set-aside', { caseId: 'alone:inconnu' });
  expect(res.statusCode).toBe(409);
  expect(res.body).toContain('Cette carte n’existe plus : rechargez.');
});

// --- Relecture finale de l'étape 23 ---

const cadetInput = (over: object = {}) => ({
  clubId: null, lastName: 'NOMX', firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...over,
});

test("ne combat pas : tombe quand l'inscription passe dans une catégorie ouverte, et l'annuler ne défait pas la modification", async () => {
  const a = await reg();
  await reg();
  await reg({ discipline: 'shido-boxing' });
  await closeCadet();
  await withdraw(a.id);
  expect((await call('PUT', `/registrations/${a.id}`, cadetInput({ lastName: 'NOMA', discipline: 'shido-boxing' }))).statusCode).toBe(200);
  const rows = (await call('GET', '/registrations')).json() as { id: string; withdrawn: boolean; discipline: string }[];
  expect(rows.find((r) => r.id === a.id)!.withdrawn).toBe(false);
  expect((await categories()).some((c) => c.registrationIds.includes(a.id))).toBe(true);
  const entry = (await replacement()).recasements.find((r) => r.type === 'W')!;
  await call('POST', '/replacement/undo', { recasementId: entry.id });
  const after = (await call('GET', '/registrations')).json() as { id: string; discipline: string }[];
  expect(after.find((r) => r.id === a.id)!.discipline).toBe('shido-boxing');
});

test('déplacement manuel vers une catégorie fermée : refusé', async () => {
  const a = await reg({ ageBandCode: 'junior', weightClassId: 'junior:F:-53' });
  await reg();
  await reg();
  await closeCadet();
  const cadet = (await categories()).find((c) => c.label.includes('Cadets'))!;
  const res = await call('POST', '/replacement/move', { registrationId: a.id, categoryId: cadet.id });
  expect(res.statusCode).toBe(400);
  expect(res.body).toContain('Catégorie non ouverte à cette compétition : choisissez-en une autre.');
});

test("mise de côté : une copie en lecture seule n'efface rien en lisant", async () => {
  const a = await reg();
  await call('POST', '/replacement/set-aside', { caseId: `alone:${a.id}` });
  await reg(); // le cas disparaît
  const sql = (q: string) => {
    const raw = new Database(dbPath);
    const out = raw.prepare(q).all();
    raw.close();
    return out;
  };
  const id = base.split('/').pop()!;
  sql(`update competitions set owner_instance_id = 'autre', owner_name = 'PC' where id = '${id}' returning id`);
  expect((await replacement()).summary.setAside).toBe(0);
  expect(sql('select case_id from set_aside_cases')).toHaveLength(1);
  sql(`update competitions set owner_instance_id = null, owner_name = null where id = '${id}' returning id`);
  await replacement();
  expect(sql('select case_id from set_aside_cases')).toHaveLength(0);
});

test('clôture de la pesée : une inscription « ne combat pas » reste non pesée', async () => {
  const a = await reg();
  await reg();
  await closeCadet();
  await withdraw(a.id);
  await call('POST', '/weigh-in/close', {});
  const rows = (await call('GET', '/registrations')).json() as { id: string; presence: string }[];
  expect(rows.find((r) => r.id === a.id)!.presence).toBe('unknown');
});

describe('liste des règles', () => {
  const view = async () => (await call('GET', '')).json().settings as { mixMinorsAdults: boolean; replacementRules: { cutAfter: string } };
  const def = rulesView(defaultSettings());

  test('Table centrale : range, coupe et active les règles, mélange mineurs/adultes compris', async () => {
    const untouched = (await call('GET', '')).json().settings as Record<string, unknown>;
    const body = { order: ['return', ...def.order.filter((r) => r !== 'return').reverse()], on: { ...def.on, minorsAdults: true }, cutAfter: 'weight' };
    const res = await call('PUT', '/replacement/rules', body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
    const s = await view();
    expect(s.mixMinorsAdults).toBe(true);
    expect(s.replacementRules.cutAfter).toBe('weight');
    // Les autres réglages de la compétition restent intacts.
    const { mixMinorsAdults: _m, replacementRules: _r, ...others } = (await call('GET', '')).json().settings as Record<string, unknown>;
    const { mixMinorsAdults: _m0, replacementRules: _r0, ...othersBefore } = untouched;
    expect(others).toEqual(othersBefore);
    const reset = await call('POST', '/replacement/rules/reset');
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual(def);
    expect((await view()).mixMinorsAdults).toBe(false);
  });

  test('réinitialisation : recopie les règles par défaut de l’application', async () => {
    const mine = { ...def, cutAfter: 'ageUp', on: { ...def.on, mixSexes: true } };
    expect((await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { defaultReplacementRules: mine } })).statusCode).toBe(200);
    const reset = await call('POST', '/replacement/rules/reset');
    expect(reset.json()).toEqual(mine);
  });

  test('liste invalide : 400', async () => {
    const noReturnFirst = await call('PUT', '/replacement/rules', { ...def, order: [...def.order.slice(1), 'return'] });
    expect(noReturnFirst.statusCode).toBe(400);
    const missing = await call('PUT', '/replacement/rules', { ...def, order: def.order.slice(0, -1) });
    expect(missing.statusCode).toBe(400);
    expect((await call('PUT', '/replacement/rules', { ...def, extra: 1 })).statusCode).toBe(400);
  });

  test('compétition inconnue : 404', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/competitions/nope/replacement/rules', payload: def })).statusCode).toBe(404);
  });
});
