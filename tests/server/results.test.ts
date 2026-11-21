import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { setFinalsZone } from '../../src/server/repositories/wave-finals.js';
import { readWorkbook } from '../../src/server/spreadsheet/read.js';
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

/** Zone des finales de la session unique (compétition sans session). */
const finalsZone = async (zoneId: string) => {
  const db = openDb(dbPath);
  try {
    await setFinalsZone(db, base.split('/').at(-1)!, null, zoneId);
  } finally {
    closeDb(db);
  }
};

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(over: object = {}) {
  n++;
  const club = (await call('POST', '/clubs', { name: `Club ${n % 2 ? 'A' : 'B'}` })).json();
  return (await call('POST', '/registrations', {
    clubId: club.id, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  })).json().row as { id: string };
}
type Cat = { id: string; status: string; registrationIds: string[]; bracket: { kind: string; matches?: { id: string; round: number; phase: string }[] } };
const cats = async () => (await call('GET', '/categories')).json() as Cat[];
type Res = { records: { matchId: string; entrantA: string; entrantB: string }[]; ignored: { matchId: string }[]; progress: { status: string; played: number; total: number; podium: { complete: boolean; first: string | null; ties: string[][] } } };
const results = async (cid: string) => (await call('GET', `/categories/${cid}/results`)).json() as Res;
const put = (cid: string, matchId: string, winner: 'a' | 'b', method = 'points') => call('PUT', `/categories/${cid}/results/${matchId}`, { winner, method });

async function fourInElimination() {
  for (let i = 0; i < 4; i++) await reg();
  return (await cats())[0]!;
}

test('saisie : lancée puis terminée, podium', async () => {
  const c = await fourInElimination();
  expect((await put(c.id, 'w1-0', 'a')).statusCode).toBe(200);
  expect((await cats())[0]!.status).toBe('started');
  await put(c.id, 'w1-1', 'b');
  await put(c.id, 'w2-0', 'a');
  expect((await cats())[0]!.status).toBe('finished');
  const p = (await call('GET', '/podiums')).json() as { categories: { complete: boolean }[]; medals: { gold: number }[] };
  expect(p.categories[0]!.complete).toBe(true);
  expect(p.medals.reduce((s, r) => s + r.gold, 0)).toBe(1);
});

test('KO en jiyu et combat non jouable refusés', async () => {
  const c = await fourInElimination();
  expect((await put(c.id, 'w1-0', 'a', 'ko')).statusCode).toBe(400);
  expect((await put(c.id, 'w2-0', 'a')).statusCode).toBe(400);
});

test('correction : la finale devient à revoir et ignorée', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  await put(c.id, 'w1-1', 'a');
  await put(c.id, 'w2-0', 'a');
  const res = await put(c.id, 'w1-0', 'b');
  expect(res.json().affected).toEqual(['w2-0']);
  const r = await results(c.id);
  expect(r.ignored.map((x) => x.matchId)).toEqual(['w2-0']);
  expect(r.progress.podium.complete).toBe(false);
  expect((await cats())[0]!.status).toBe('started');
});

test('déverrouillage + nouveau combattant : anciens résultats jamais réappliqués à d’autres combattants', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  const before = (await results(c.id)).records[0]!;
  await call('PATCH', `/categories/${c.id}`, { status: 'ready', unlock: true });
  await reg();
  await call('POST', `/categories/${c.id}/redraw`);
  const r = await results(c.id);
  const cat = (await cats()).find((x) => x.id === c.id)!;
  const { resolveBracket } = await import('../../src/domain/brackets/index.js');
  const m = resolveBracket(cat.bracket as never, {}).matches.find((x) => x.id === 'w1-0')!;
  const samePair = [m.entrantA, m.entrantB].sort().join() === [before.entrantA, before.entrantB].sort().join();
  // Le résultat n'est appliqué que si le combat oppose exactement les deux mêmes combattants.
  expect(r.progress.played).toBe(samePair ? 1 : 0);
  expect(r.ignored).toHaveLength(samePair ? 0 : 1);
});

test('effacer le dernier résultat → prête', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  await call('DELETE', `/categories/${c.id}/results/w1-0`);
  expect((await cats())[0]!.status).toBe('ready');
});

test('poule de 3 en cycle → départage → terminée', async () => {
  for (let i = 0; i < 3; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const c = (await cats())[0]!;
  const ids = c.registrationIds;
  const matches = (await (await call('GET', `/categories/${c.id}/results`)).json()) as Res;
  void matches;
  // cycle réel : ids[0] bat ids[1], ids[1] bat ids[2], ids[2] bat ids[0]
  const { resolveBracket } = await import('../../src/domain/brackets/index.js');
  const beats: Record<string, string> = { [ids[0]!]: ids[1]!, [ids[1]!]: ids[2]!, [ids[2]!]: ids[0]! };
  for (const m of resolveBracket(c.bracket as never, {}).matches) {
    await put(c.id, m.id, beats[m.entrantA!] === m.entrantB ? 'a' : 'b');
  }
  let r = await results(c.id);
  expect(r.progress.podium.ties).toHaveLength(1);
  expect(r.progress.status).toBe('started');
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'pool:0', order: ids });
  r = await results(c.id);
  expect(r.progress.status).toBe('finished');
});

test('kata à 3 : notes, égalité, départage', async () => {
  const k = [await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null })];
  const c = (await cats())[0]!;
  const note = (rid: string, round: string, notes: number[]) => call('PUT', `/categories/${c.id}/kata/${rid}/${round}`, { notes });
  await note(k[0]!.id, 'round1', [9, 9, 9]);
  await note(k[1]!.id, 'round1', [8, 8, 8]);
  await note(k[2]!.id, 'round1', [8, 8, 8]);
  let r = await results(c.id);
  expect(r.progress.podium.complete).toBe(false);
  expect(r.progress.podium.ties.length).toBe(1);
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'kata', order: [k[2]!.id, k[1]!.id] });
  await note(k[0]!.id, 'final', [7, 7, 7]);
  await note(k[2]!.id, 'final', [9, 9, 9]);
  r = await results(c.id);
  expect(r.progress).toMatchObject({ status: 'finished', podium: { first: k[2]!.id } });
  expect((await note(k[0]!.id, 'round1', [11])).statusCode).toBe(400);
});

test('programme des zones', async () => {
  await fourInElimination();
  for (let i = 0; i < 2; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const [a, b] = await cats();
  const zone = ((await call('GET', '/zones')).json() as { id: string }[])[0]!;
  await call('PATCH', `/categories/${a!.id}`, { zoneId: zone.id, order: 2 });
  await call('PATCH', `/categories/${b!.id}`, { zoneId: zone.id, order: 1 });
  const s = (await call('GET', '/schedule')).json() as { zones: { zone: { id: string }; categories: { id: string; nextMatches: unknown[] }[] }[] };
  const t1 = s.zones.find((t) => t.zone.id === zone.id)!;
  expect(t1.categories.map((c) => c.id)).toEqual([b!.id, a!.id]);
  expect(t1.categories[1]!.nextMatches).toHaveLength(2);
});

test('programme : la zone des finales, sans catégorie à elle, apparaît avec la finale dans sa file', async () => {
  const c = await fourInElimination();
  const [t1, t2] = (await call('GET', '/zones')).json() as { id: string }[];
  await finalsZone(t2!.id);
  await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  await put(c.id, 'w1-0', 'a');
  await put(c.id, 'w1-1', 'a');
  const s = (await call('GET', '/schedule')).json() as { zones: { zone: { id: string }; categories: unknown[]; queue: { matchId: string | null }[] }[] };
  const finals = s.zones.find((t) => t.zone.id === t2!.id);
  expect(finals?.categories).toEqual([]);
  expect(finals?.queue.map((q) => q.matchId)).toEqual(['w2-0']);
});

test('file d’une zone : les passages de finale sont marqués comme tels, les autres non', async () => {
  const c = await fourInElimination();
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  const queue = async () =>
    ((await call('GET', '/schedule')).json() as { zones: { zone: { id: string }; queue: { matchId: string | null; final: boolean }[] }[] }).zones.find((t) => t.zone.id === t1!.id)!.queue;
  expect((await queue()).map((q) => [q.matchId, q.final])).toEqual([['w1-0', false], ['w1-1', false]]);
  await put(c.id, 'w1-0', 'a');
  await put(c.id, 'w1-1', 'a');
  expect((await queue()).map((q) => [q.matchId, q.final])).toEqual([['w2-0', true]]);
});

test('finale prête avant son tour : signalée même au-delà des 6 premiers ; son résultat se saisit hors ordre', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  for (let i = 0; i < 4; i++) await reg();
  for (let i = 0; i < 16; i++) await reg({ weightClassId: 'cadet:F:-47' });
  const [a, b] = [(await cats()).find((c) => c.registrationIds.length === 4)!, (await cats()).find((c) => c.registrationIds.length === 16)!];
  for (const c of [a, b]) await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  expect((await call('PUT', '/finals/categories', { waveId: null, when: 'end' })).statusCode).toBe(200);
  const queue = async () => ((await call('GET', '/schedule')).json() as { zones: { zone: { id: string }; queue: { number: number; categoryId: string; matchId: string | null; early: boolean }[] }[] }).zones.find((t) => t.zone.id === t1!.id)!.queue;
  expect((await queue()).some((q) => q.early)).toBe(false);
  await put(a.id, 'w1-0', 'a');
  await put(a.id, 'w1-1', 'a');
  const before = await queue();
  const finale = before.find((q) => q.categoryId === a.id && q.matchId === 'w2-0')!;
  expect(finale).toBeDefined();
  expect(finale.early).toBe(true);
  expect(before.indexOf(finale)).toBeGreaterThanOrEqual(6); // ajoutée après les 6 premiers
  expect(before.filter((q) => q.early)).toEqual([finale]);
  expect((await put(a.id, 'w2-0', 'b')).statusCode).toBe(200);
  const after = await queue();
  expect(after.some((q) => q.categoryId === a.id)).toBe(false);
  expect(after.slice(0, 6).map((q) => q.number)).toEqual(before.slice(0, 6).map((q) => q.number));
  expect(after.every((q) => !q.early)).toBe(true);
});

type QItem = {
  number: number; categoryId: string; matchId: string | null; kataPart: string | null; early: boolean;
  a: string | null; aClub: string | null; bClub: string | null; timing: string | null;
  kata: { name: string | null; club: string | null; position: number; total: number; absent: boolean } | null;
};
const queueOf = async (zoneId: string) =>
  ((await call('GET', '/schedule')).json() as { zones: { zone: { id: string }; queue: QItem[] }[] }).zones.find((t) => t.zone.id === zoneId)?.queue ?? [];
const twoSessions = async () =>
  (await call('PUT', '/waves', [
    { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ])).json() as { id: string }[];

test('finale de kata prête avant son tour : early', async () => {
  const [t1, t2] = (await call('GET', '/zones')).json() as { id: string }[];
  const k = [await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null })];
  for (let i = 0; i < 4; i++) await reg({ weightClassId: 'cadet:F:-47' });
  const all = await cats();
  const kata = all.find((c) => c.registrationIds.length === 3 && c.registrationIds.includes(k[0]!.id))!;
  const elim = all.find((c) => c.id !== kata.id)!;
  for (const c of [elim, kata]) await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  await finalsZone(t2!.id);
  await call('PUT', '/finals/categories', { waveId: null, categoryIds: [kata.id], where: 'own', when: 'end' });
  // Tour 1 pas encore noté : finalistes inconnus, la finale n'est pas prête.
  const waiting = (await queueOf(t1!.id)).find((x) => x.categoryId === kata.id && x.kataPart === 'finale');
  expect(waiting).toMatchObject({ early: false, kata: { name: null, club: null, position: 1, total: 2 } });
  expect((await queueOf(t1!.id)).filter((x) => x.categoryId === kata.id && x.kataPart === 'tour1')).toHaveLength(3);
  for (const [i, r] of k.entries()) await call('PUT', `/categories/${kata.id}/kata/${r.id}/round1`, { notes: [9 - i, 9 - i, 9 - i] });
  const q = await queueOf(t1!.id);
  const fin = (await queueOf(t2!.id)).concat(q).find((x) => x.categoryId === kata.id && x.kataPart === 'finale');
  expect(fin, JSON.stringify([q, await queueOf(t2!.id)])).toBeDefined();
  expect(fin!.early).toBe(true);
  // Un combat d'une autre catégorie non joué précède les deux places : les deux peuvent passer plus tôt.
  const finales = (await queueOf(t2!.id)).concat(q).filter((x) => x.categoryId === kata.id && x.kataPart === 'finale');
  expect(finales.map((x) => [x.kata!.position, x.early])).toEqual([[1, true], [2, true]]);
});

test('finale de kata à la suite de son tour 1 : jamais « early » à cause d’un passage de la même catégorie', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  const k = await kataRegs(3);
  const kata = await kataCatOf(k[0]!.id);
  await call('PATCH', `/categories/${kata.id}`, { zoneId: t1!.id });
  for (const [i, r] of k.entries()) await call('PUT', `/categories/${kata.id}/kata/${r.id}/round1`, { notes: [9 - i, 9 - i, 9 - i] });
  const q = await katas(t1!.id, kata.id);
  expect(q.map((i) => [i.kata!.position, i.early])).toEqual([[1, false], [2, false]]);
});

test('file des zones : club de chaque combattant', async () => {
  const c = await fourInElimination();
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  const q = (await queueOf(t1!.id))[0]!;
  expect(q.aClub).toMatch(/^Club [AB]$/);
  expect(q.bClub).toMatch(/^Club [AB]$/);
  expect(q.kata).toBeNull();
});

test('file des zones : durée de chaque combat, exception d’un combat comprise', async () => {
  const c = await fourInElimination();
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  const [first, second] = await queueOf(t1!.id);
  expect(first!.timing).toMatch(/^\d+ rounds? de .+/);
  await call('PATCH', `/categories/${c.id}`, { durations: { bracket: null, finals: null, matches: { [second!.matchId!]: { rounds: 1, roundSec: 90, restSec: 0, overtimeSec: 0 } } } });
  const after = await queueOf(t1!.id);
  expect(after.find((q) => q.matchId === second!.matchId)!.timing).toBe('1 round de 1 min 30');
});

const kataRegs = async (n: number) => {
  const out: { id: string; fighterId: string }[] = [];
  for (let i = 0; i < n; i++) out.push((await reg({ discipline: 'kata', ruleset: null, weightClassId: null })) as { id: string; fighterId: string });
  return out;
};
const kataCatOf = async (id: string) => (await cats()).find((c) => c.registrationIds.includes(id))! as Cat & { bracket: { order: string[] } };
const lastNames = async () => {
  const names = (await call('GET', '/registrations')).json() as { id: string; fighter: { lastName: string } }[];
  return (id: string) => names.find((r) => r.id === id)!.fighter.lastName;
};
const katas = async (zoneId: string, categoryId: string) => (await queueOf(zoneId)).filter((x) => x.categoryId === categoryId);

test('file des zones : un élément par kataka, dans l’ordre du tirage, puis la finale', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  const k = await kataRegs(3);
  const kata = await kataCatOf(k[0]!.id);
  await call('PATCH', `/categories/${kata.id}`, { zoneId: t1!.id });
  const order = kata.bracket.order;
  const nameOf = await lastNames();
  let q = await katas(t1!.id, kata.id);
  const first = (x: QItem) => x.kata?.name?.split(' ')[0];
  expect(q.map((i) => [i.kataPart, i.kata?.name ? first(i) : null, i.kata?.position, i.kata?.total])).toEqual([
    ['tour1', nameOf(order[0]!), 1, 3], ['tour1', nameOf(order[1]!), 2, 3], ['tour1', nameOf(order[2]!), 3, 3], ['finale', null, 1, 2], ['finale', null, 2, 2],
  ]);
  expect(new Set(q.map((i) => i.number)).size).toBe(5);
  expect(q.every((i) => i.aClub === null && i.timing === null && i.matchId!.startsWith('kata:'))).toBe(true);
  expect(/^Club [AB]$/.test(q[0]!.kata!.club!)).toBe(true);
  await call('PUT', `/categories/${kata.id}/kata/${order[0]}/round1`, { notes: [9, 9, 9] });
  q = await katas(t1!.id, kata.id);
  expect(first(q[0]!)).toBe(nameOf(order[1]!));
  expect(q[0]!.kata!.position).toBe(2);
  expect(q).toHaveLength(4);
  await call('PUT', `/categories/${kata.id}/kata/${order[1]}/round1`, { notes: [8, 8, 8] });
  await call('PUT', `/categories/${kata.id}/kata/${order[2]}/round1`, { notes: [7, 7, 7] });
  q = await katas(t1!.id, kata.id);
  expect(q.map((i) => [i.kataPart, first(i), i.kata?.position, i.kata?.total])).toEqual([
    ['finale', nameOf(order[0]!), 1, 2], ['finale', nameOf(order[1]!), 2, 2],
  ]);
  // La finale 1 jouée, la place 2 reste seule.
  await call('PUT', `/categories/${kata.id}/kata/${order[0]}/final`, { notes: [9, 9, 9] });
  q = await katas(t1!.id, kata.id);
  expect(q.map((i) => i.kata?.position)).toEqual([2]);
});

test('file des zones : égalité pour la 2e place de finale, « Finaliste 1/2 » sans nom tant qu’elle n’est pas départagée', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  const k = await kataRegs(3);
  const kata = await kataCatOf(k[0]!.id);
  await call('PATCH', `/categories/${kata.id}`, { zoneId: t1!.id });
  const nameOf = await lastNames();
  await call('PUT', `/categories/${kata.id}/kata/${k[0]!.id}/round1`, { notes: [9, 9, 9] });
  await call('PUT', `/categories/${kata.id}/kata/${k[1]!.id}/round1`, { notes: [8, 8, 8] });
  await call('PUT', `/categories/${kata.id}/kata/${k[2]!.id}/round1`, { notes: [8, 8, 8] });
  expect((await katas(t1!.id, kata.id)).map((i) => [i.kataPart, i.kata!.name, i.kata!.position])).toEqual([['finale', null, 1], ['finale', null, 2]]);
  await call('PUT', `/categories/${kata.id}/tie-break`, { scope: 'kata', order: [k[2]!.id, k[1]!.id] });
  const q = await katas(t1!.id, kata.id);
  expect(q.map((i) => i.kata!.name!.split(' ')[0]).sort()).toEqual([nameOf(k[0]!.id), nameOf(k[2]!.id)].sort());
});

test('file des zones : kata à 2, deux passages de finale nommés d’emblée dans l’ordre du tirage', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  const k = await kataRegs(2);
  const kata = await kataCatOf(k[0]!.id);
  await call('PATCH', `/categories/${kata.id}`, { zoneId: t1!.id });
  const nameOf = await lastNames();
  const q = await katas(t1!.id, kata.id);
  expect(q.map((i) => [i.kataPart, i.kata!.name!.split(' ')[0], i.kata!.position, i.kata!.total])).toEqual(
    kata.bracket.order.map((id, i) => ['finale', nameOf(id), i + 1, 2]),
  );
});

test('file des zones : absent tardif jamais appelé, son numéro sauté, et la finale attend ses notes comme la feuille de notation', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  const k = await kataRegs(3);
  const kata = await kataCatOf(k[0]!.id);
  await call('PATCH', `/categories/${kata.id}`, { zoneId: t1!.id });
  const [first, gone, last] = kata.bracket.order;
  const before = await katas(t1!.id, kata.id);
  await call('PUT', `/categories/${kata.id}/kata/${first}/round1`, { notes: [9, 9, 9] });
  expect((await call('PUT', `/weigh-in/${k.find((r) => r.id === gone)!.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);
  let q = await katas(t1!.id, kata.id);
  expect(q.filter((i) => i.kataPart === 'tour1').map((i) => [i.matchId, i.kata!.position, i.kata!.total])).toEqual([[`kata:tour1:${last}`, 2, 2]]);
  // Les numéros des autres passages ne changent pas.
  expect(q.map((i) => i.number)).toEqual(before.filter((i) => i.matchId !== `kata:tour1:${first}` && i.matchId !== `kata:tour1:${gone}`).map((i) => i.number));
  await call('PUT', `/categories/${kata.id}/kata/${last}/round1`, { notes: [8, 8, 8] });
  q = await katas(t1!.id, kata.id);
  expect(q.map((i) => i.kataPart)).toEqual(['finale', 'finale']);
  expect(q.every((i) => i.kata!.name === null)).toBe(true); // la finale attend les notes de l'absent
  await call('PUT', `/categories/${kata.id}/kata/${gone}/round1`, { notes: [0, 0, 0] });
  q = await katas(t1!.id, kata.id);
  expect(q.every((i) => i.kataPart === 'finale' && i.kata!.name !== null)).toBe(true);
});

test('kata lancé : un absent qui arrive entre au tableau en déverrouillant, les notes déjà saisies restent, son passage est à l’appel', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  const k = await kataRegs(4);
  const late = k[3]!;
  await call('PUT', `/weigh-in/${late.fighterId}`, { presence: 'absent' });
  type KataCat = Cat & { status: string; bracket: { order: string[] } };
  const kataCat = async () => (await cats()).find((c) => c.registrationIds.includes(k[0]!.id))! as KataCat;
  let c = await kataCat();
  await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  expect(c.bracket.order).not.toContain(late.id);
  const [p1, p2] = c.bracket.order;
  await call('PUT', `/categories/${c.id}/kata/${p1}/round1`, { notes: [9, 9, 9] });
  await call('PUT', `/categories/${c.id}/kata/${p2}/round1`, { notes: [8, 8, 8] });
  expect((await kataCat()).status).toBe('started');
  await call('PUT', `/weigh-in/${late.fighterId}`, { presence: 'present' });
  expect((await kataCat()).bracket.order).not.toContain(late.id);
  expect((await call('PATCH', `/categories/${c.id}`, { status: 'ready', unlock: true })).statusCode).toBe(200);
  c = await kataCat();
  expect(c.bracket.order).toContain(late.id);
  const res = (await results(c.id)) as Res & { kataScores: { round1: Record<string, number[]> } };
  expect(res.kataScores.round1).toEqual({ [p1!]: [9, 9, 9], [p2!]: [8, 8, 8] });
  // La carte : les katakas sans notes du nouvel ordre, l'arrivant n'est pas écarté.
  const nameOf = await lastNames();
  const q = (await katas(t1!.id, c.id)).filter((i) => i.kataPart === 'tour1');
  const todo = c.bracket.order.filter((id) => id !== p1 && id !== p2);
  expect(q.map((i) => i.kata!.name!.split(' ')[0])).toEqual(todo.map(nameOf));
  expect(q.map((i) => i.kata!.position)).toEqual(todo.map((id) => c.bracket.order.indexOf(id) + 1));
  expect(q.every((i) => i.kata!.total === 4)).toBe(true);
  expect((await call('PUT', `/categories/${c.id}/kata/${late.id}/round1`, { notes: [7, 7, 7] })).statusCode).toBe(204);
  expect((await kataCat()).status).toBe('started');
});

test('finale prête : pas « early » si le seul passage non joué plus petit est d’une autre session', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  for (let i = 0; i < 4; i++) await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
  for (let i = 0; i < 4; i++) await reg();
  const [, aprem] = await twoSessions();
  for (const c of await cats()) await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id });
  await call('PUT', '/finals/categories', { waveId: aprem!.id, when: 'end' });
  const cad = (await call('GET', '/categories')).json() as (Cat & { label: string })[];
  const cadet = cad.find((c) => !c.label.includes('-45'))!;
  await put(cadet.id, 'w1-0', 'a');
  await put(cadet.id, 'w1-1', 'a');
  const q = await queueOf(t1!.id);
  const fin = q.find((x) => x.categoryId === cadet.id && x.matchId === 'w2-0')!;
  expect(q[0]!.categoryId).not.toBe(cadet.id); // les passages du matin passent en premier
  expect(fin.early).toBe(false);
});

test('« reprendre à 1 » : early calculé dans la bonne session quand deux passages de sessions différentes ont le même numéro', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  for (let i = 0; i < 8; i++) await reg({ ageBandCode: 'minime', weightClassId: 'minime:F:-45' });
  for (let i = 0; i < 4; i++) await reg();
  for (let i = 0; i < 4; i++) await reg({ weightClassId: 'cadet:F:-47' });
  const [matin, aprem] = await twoSessions();
  const list = (await call('GET', '/categories')).json() as (Cat & { label: string })[];
  const minime = list.find((c) => c.label.includes('-45'))!;
  const a = list.find((c) => c.label.includes('-54'))!;
  for (const c of list) await call('PATCH', `/categories/${c.id}`, { zoneId: t1!.id, status: 'ready' });
  await call('PUT', '/finals/categories', { waveId: aprem!.id, when: 'end' });
  expect((await call('POST', '/launch', { waveId: matin!.id })).statusCode).toBe(204);
  expect((await call('POST', '/launch', { waveId: aprem!.id, restart: true })).statusCode).toBe(204);
  // Le matin est entièrement joué.
  for (const m of minime.bracket.matches!) await put(minime.id, m.id, 'a');
  await put(a.id, 'w1-0', 'a');
  await put(a.id, 'w1-1', 'a');
  const plan = ((await call('GET', '/passages')).json() as { zones: { passages: { number: number; categoryId: string; matchId: string | null; waveId: string | null }[] }[] }).zones.flatMap((z) => z.passages);
  const fp = plan.find((p) => p.categoryId === a.id && p.matchId === 'w2-0')!;
  // Le numéro de la finale est partagé avec un passage du matin (numérotation reprise à 1).
  expect(plan.some((p) => p.waveId === matin!.id && p.number === fp.number)).toBe(true);
  const fin = (await queueOf(t1!.id)).find((x) => x.categoryId === a.id && x.matchId === 'w2-0')!;
  expect(fin.early).toBe(true);
});

test('exports .xlsx et .ods relus', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  await put(c.id, 'w1-1', 'a');
  await put(c.id, 'w2-0', 'b');
  const res = await call('GET', '/exports/results.xlsx');
  expect(res.statusCode).toBe(200);
  const book = readWorkbook(res.rawPayload);
  expect(book.sheets[0]!.cells.length).toBeGreaterThanOrEqual(4);
  const pod = readWorkbook((await call('GET', '/exports/podiums.ods')).rawPayload);
  expect(pod.sheets.map((s) => s.name)).toEqual(['Podiums', 'Clubs']);
  expect(pod.sheets[1]!.cells[0]).toEqual(['Club', 'Or', 'Argent', 'Bronze', 'Total']);
});

test('tie-break : portée invalide ou inscrits étrangers refusés ; ordres fusionnés', async () => {
  for (let i = 0; i < 3; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const c = (await cats())[0]!;
  expect((await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'pool:42', order: c.registrationIds })).statusCode).toBe(400);
  expect((await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'pool:0', order: ['inconnu', 'autre'] })).statusCode).toBe(400);
});

test('combattant absent après la fin : le podium et les médailles restent', async () => {
  const a = await reg({ weightClassId: 'cadet:F:-47' });
  await reg({ weightClassId: 'cadet:F:-47' });
  const c = (await cats())[0]!;
  await put(c.id, c.bracket.matches![0]!.id, 'a');
  const fighter = ((await call('GET', '/registrations')).json() as { id: string; fighterId: string }[]).find((x) => x.id === a.id)!.fighterId;
  await call('PUT', `/weigh-in/${fighter}`, { presence: 'absent' });
  const p = (await call('GET', '/podiums')).json() as { categories: { complete: boolean }[]; medals: unknown[] };
  expect(p.categories).toHaveLength(1);
  expect(p.categories[0]!.complete).toBe(true);
  expect(p.medals.length).toBeGreaterThan(0);
});

test('inscription d’une catégorie lancée : suppression refusée ; export toujours possible', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  const res = await call('DELETE', `/registrations/${c.registrationIds[0]}`);
  expect(res.statusCode).toBe(409);
  expect((await call('GET', '/exports/results.xlsx')).statusCode).toBe(200);
});

async function cycleOfThree() {
  for (let i = 0; i < 3; i++) await reg({ weightClassId: 'cadet:F:-61' });
  const c = (await cats())[0]!;
  const ids = c.registrationIds;
  const { resolveBracket } = await import('../../src/domain/brackets/index.js');
  const beats: Record<string, string> = { [ids[0]!]: ids[1]!, [ids[1]!]: ids[2]!, [ids[2]!]: ids[0]! };
  const matches = resolveBracket(c.bracket as never, {}).matches;
  for (const m of matches) await put(c.id, m.id, beats[m.entrantA!] === m.entrantB ? 'a' : 'b');
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'pool:0', order: ids });
  return { c, ids, matches, beats };
}
type FullRes = Res & { tieBreaks: { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] } };

test('départage de poule effacé quand un résultat de la poule change (pas s’il est ré-enregistré à l’identique)', async () => {
  const { c, matches, beats } = await cycleOfThree();
  const m = matches[0]!;
  const same = beats[m.entrantA!] === m.entrantB ? 'a' : 'b';
  await put(c.id, m.id, same);
  expect(((await results(c.id)) as FullRes).tieBreaks.pools[0]).toBeDefined();
  await put(c.id, m.id, same === 'a' ? 'b' : 'a');
  const r = (await results(c.id)) as FullRes;
  expect(r.tieBreaks.pools[0]).toBeUndefined();
  expect(r.progress.podium.ties).toHaveLength(0); // plus de cycle : classement net
});

test('départage de poule effacé quand un résultat de la poule est effacé', async () => {
  const { c, matches } = await cycleOfThree();
  await call('DELETE', `/categories/${c.id}/results/${matches[0]!.id}`);
  expect(((await results(c.id)) as FullRes).tieBreaks.pools[0]).toBeUndefined();
});

test('kata : départage effacé quand une note du tour 1 change', async () => {
  const k = [await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null })];
  const c = (await cats())[0]!;
  const note = (rid: string, round: string, notes: number[]) => call('PUT', `/categories/${c.id}/kata/${rid}/${round}`, { notes });
  await note(k[0]!.id, 'round1', [9, 9, 9]);
  await note(k[1]!.id, 'round1', [8, 8, 8]);
  await note(k[2]!.id, 'round1', [8, 8, 8]);
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'kata', order: [k[2]!.id, k[1]!.id] });
  await note(k[1]!.id, 'round1', [8, 8, 8]);
  expect(((await results(c.id)) as FullRes).tieBreaks.kata).toHaveLength(2);
  await note(k[1]!.id, 'round1', [8.5, 8, 8]);
  expect(((await results(c.id)) as FullRes).tieBreaks.kata).not.toContain(k[1]!.id);
});

test('kata : une note du tour 1 hors du groupe à égalité ne défait pas les départages', async () => {
  const k: { id: string }[] = [];
  for (let i = 0; i < 5; i++) k.push(await reg({ discipline: 'kata', ruleset: null, weightClassId: null }));
  const c = (await cats())[0]!;
  const note = (rid: string, round: string, notes: number[]) => call('PUT', `/categories/${c.id}/kata/${rid}/${round}`, { notes });
  const [a, b, d, e, f] = k.map((x) => x.id) as [string, string, string, string, string];
  await note(a, 'round1', [9, 9, 9]);
  await note(b, 'round1', [8, 8, 8]);
  await note(d, 'round1', [8, 8, 8]);
  await note(e, 'round1', [7, 7, 7]);
  await note(f, 'round1', [6, 6, 6]);
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'kata', order: [d, b] });
  await note(a, 'final', [8, 8, 8]);
  await note(d, 'final', [8, 8, 8]);
  await call('PUT', `/categories/${c.id}/tie-break`, { scope: 'kata:final', order: [d, a] });
  expect((await results(c.id)).progress.podium.complete).toBe(true);
  await note(f, 'round1', [5, 5, 5]);
  let r = (await results(c.id)) as FullRes;
  expect(r.tieBreaks.kata).toEqual([d, b]);
  expect(r.tieBreaks.kataFinal).toEqual([d, a]);
  // b passe devant : il sort du départage du tour 1, et la finale change de finalistes → départage de la finale effacé.
  await note(b, 'round1', [10, 10, 10]);
  r = (await results(c.id)) as FullRes;
  expect(r.tieBreaks.kata).toEqual([d]);
  expect(r.tieBreaks.kataFinal).toEqual([]);
});

test('régénération du tableau : les départages sont effacés', async () => {
  const { c } = await cycleOfThree();
  await call('PATCH', `/categories/${c.id}`, { status: 'ready', unlock: true });
  await reg({ weightClassId: 'cadet:F:-61' });
  const again = (await cats())[0]!;
  expect(again.registrationIds).toHaveLength(4);
  expect(((await results(again.id)) as FullRes).tieBreaks.pools[0]).toBeUndefined();
});

test('statut : une catégorie provisoire le reste tant qu’aucun résultat n’est saisi', async () => {
  const c = await fourInElimination();
  expect(c.status).toBe('provisional');
  await call('DELETE', `/categories/${c.id}/results/w1-0`);
  expect((await cats())[0]!.status).toBe('provisional');
});

test('export des podiums : podium incomplet « en cours », « Sans club » hors du classement des clubs', async () => {
  const c = await fourInElimination();
  await put(c.id, 'w1-0', 'a');
  for (let i = 0; i < 2; i++) await call('POST', '/registrations', { clubId: null, lastName: `SANS${i}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-61', source: 'manual' });
  const solo = (await cats()).find((x) => x.registrationIds.length === 2)!;
  await put(solo.id, solo.bracket.matches![0]!.id, 'a');
  const pod = readWorkbook((await call('GET', '/exports/podiums.xlsx')).rawPayload);
  const rows = pod.sheets[0]!.cells;
  expect(rows[0]).toEqual(['Catégorie', 'État', '1er', '2e', '3e', '3e']);
  expect(rows.find((r) => String(r[0]).includes('-54'))![1]).toBe('en cours');
  expect(rows.find((r) => String(r[0]).includes('-61'))![1]).toBe('terminé');
  expect(pod.sheets[1]!.cells.map((r) => r[0])).not.toContain('Sans club');
});

test('export des résultats : feuille « Kata » (notes, note retenue, rang)', async () => {
  const k = [await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null }), await reg({ discipline: 'kata', ruleset: null, weightClassId: null })];
  const c = (await cats())[0]!;
  await call('PUT', `/categories/${c.id}/kata/${k[0]!.id}/round1`, { notes: [9, 8.5, 9] });
  const book = readWorkbook((await call('GET', '/exports/results.xlsx')).rawPayload);
  const kata = book.sheets.find((s) => s.name === 'Kata')!;
  expect(kata.cells[0]).toEqual(['Catégorie', 'Tour', 'Rang', 'Kataka', 'Club', 'Notes', 'Note retenue']);
  const row = kata.cells.find((r) => r[5] === '9 ; 8,5 ; 9')!;
  expect(row).toMatchObject({ 1: 'Tour 1', 2: 1 });
  expect(Number(String(row[6]).replace(',', '.'))).toBeCloseTo(8.83, 2);
});

test('kata de 2 non séparé derrière un passage non joué : ses places de finale ne sont pas « early »', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  const kata = { discipline: 'kata', ruleset: null, weightClassId: null };
  const other = [await reg({ ...kata, sex: 'M' }), await reg({ ...kata, sex: 'M' })];
  const two = [await reg(kata), await reg(kata)];
  const first = await kataCatOf(other[0]!.id);
  const second = await kataCatOf(two[0]!.id);
  await call('PATCH', `/categories/${first.id}`, { zoneId: t1!.id, order: 1 });
  await call('PATCH', `/categories/${second.id}`, { zoneId: t1!.id, order: 2 });
  const q = await queueOf(t1!.id);
  const fin = q.filter((x) => x.categoryId === second.id && x.kataPart === 'finale');
  expect(fin).toHaveLength(2);
  expect(q.some((x) => x.categoryId === first.id && x.number < fin[0]!.number)).toBe(true);
  expect(fin.map((x) => x.early)).toEqual([false, false]);
});

test('file des zones : finaliste de kata absent tardif signalé (absent: true), passage conservé', async () => {
  const [t1] = (await call('GET', '/zones')).json() as { id: string }[];
  const k = await kataRegs(3);
  const kata = await kataCatOf(k[0]!.id);
  await call('PATCH', `/categories/${kata.id}`, { zoneId: t1!.id });
  for (const [i, r] of k.entries()) await call('PUT', `/categories/${kata.id}/kata/${r.id}/round1`, { notes: [9 - i, 9 - i, 9 - i] });
  let q = await katas(t1!.id, kata.id);
  expect(q.map((i) => i.kata!.absent)).toEqual([false, false]);
  const top = q[0]!.kata!.name!;
  const who = (await call('GET', '/registrations')).json() as { fighterId: string; fighter: { lastName: string; firstName: string } }[];
  const gone = who.find((r) => top.includes(r.fighter.lastName))!;
  expect((await call('PUT', `/weigh-in/${gone.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);
  q = await katas(t1!.id, kata.id);
  expect(q).toHaveLength(2);
  expect(q.map((i) => i.kata!.absent)).toEqual([true, false]);
});
