import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedDev } from '../../scripts/seed-dev.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await seedDev(app, { seed: 5 })).competitionId}`;
}, 20_000);
afterEach(async () => app.close());

const STALE = 'Modifié entre-temps par un autre poste : l’écran a été rechargé.';
type Cat = { id: string; rev: string; bracket: { kind: string; matches?: { id: string }[]; entrants?: { registrationId: string }[] } | null };
const categories = async () => (await app.inject({ method: 'GET', url: `${base}/categories` })).json() as Cat[];
const ifMatch = (rev: string) => ({ 'if-match': rev });

/** Premier combat qui accepte une saisie (ses deux combattants sont connus) : le résultat y est saisi avec « If-Match: none ». */
async function firstResult(body: object) {
  for (const c of await categories()) {
    if (c.bracket?.kind !== 'combat') continue;
    for (const m of c.bracket.matches ?? []) {
      const url = `${base}/categories/${c.id}/results/${m.id}`;
      if ((await app.inject({ method: 'PUT', url, headers: ifMatch('none'), payload: body })).statusCode === 200) return { cid: c.id, matchId: m.id, url };
    }
  }
  throw new Error('aucun combat jouable');
}

test('résultat : none puis none → 409 ; avec la rev lue → 200 ; DELETE périmé → 409 ; sans If-Match → accepté', async () => {
  const body = { winner: 'a', method: 'points' };
  const { cid, matchId, url } = await firstResult(body);
  const second = await app.inject({ method: 'PUT', url, headers: ifMatch('none'), payload: { ...body, winner: 'b' } });
  expect(second.statusCode).toBe(409);
  expect(second.json().error).toBe(STALE);
  const results = (await app.inject({ method: 'GET', url: `${base}/categories/${cid}/results` })).json() as { records: { matchId: string; rev: string }[] };
  const rev = results.records.find((r) => r.matchId === matchId)!.rev;
  expect((await app.inject({ method: 'PUT', url, headers: ifMatch(rev), payload: { ...body, method: 'decision' } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'DELETE', url, headers: ifMatch(rev) })).statusCode).toBe(409);
  expect((await app.inject({ method: 'PUT', url, payload: body })).statusCode).toBe(200);
});

test('notes de kata et départage : none puis none → 409 ; rev exposées', async () => {
  const kata = (await categories()).find((c) => c.bracket?.kind === 'kata' && (c.bracket.entrants?.length ?? 0) >= 2)!;
  const rid = kata.bracket!.entrants![0]!.registrationId;
  const url = `${base}/categories/${kata.id}/kata/${rid}/round1`;
  expect((await app.inject({ method: 'PUT', url, headers: ifMatch('none'), payload: { notes: [8, 8, 8] } })).statusCode).toBe(204);
  expect((await app.inject({ method: 'PUT', url, headers: ifMatch('none'), payload: { notes: [7, 7, 7] } })).statusCode).toBe(409);
  const res = (await app.inject({ method: 'GET', url: `${base}/categories/${kata.id}/results` })).json() as { kataRevs: Record<string, { round1?: string }>; tieBreakRevs: Record<string, string> };
  expect(res.kataRevs[rid]!.round1).toMatch(/^\d+$/);
  expect(res.tieBreakRevs).toEqual({});
  const order = kata.bracket!.entrants!.map((e) => e.registrationId);
  const tb = `${base}/categories/${kata.id}/tie-break`;
  expect((await app.inject({ method: 'PUT', url: tb, headers: ifMatch('none'), payload: { scope: 'kata', order } })).statusCode).toBe(204);
  expect((await app.inject({ method: 'PUT', url: tb, headers: ifMatch('none'), payload: { scope: 'kata', order: [...order].reverse() } })).statusCode).toBe(409);
});

test('inscription : PUT et DELETE avec une rev périmée → 409', async () => {
  const rows = (await app.inject({ method: 'GET', url: `${base}/registrations` })).json() as { id: string; rev: string; fighterId: string; discipline: string; ruleset: string | null; weightClassId: string | null; source: string; club: { id: string } | null; fighter: { lastName: string; firstName: string; sex: string; ageBandCode: string } }[];
  const r = rows.find((x) => x.discipline !== 'kata')!;
  expect(r.rev).toMatch(/^\d+:\d+$/);
  const input = { clubId: r.club?.id ?? null, lastName: r.fighter.lastName, firstName: r.fighter.firstName, sex: r.fighter.sex, ageBandCode: r.fighter.ageBandCode, discipline: r.discipline, ruleset: r.ruleset, weightClassId: r.weightClassId, source: r.source };
  expect((await app.inject({ method: 'PUT', url: `${base}/registrations/${r.id}`, headers: ifMatch(r.rev), payload: { ...input, firstName: 'Autre' } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url: `${base}/registrations/${r.id}`, headers: ifMatch(r.rev), payload: input })).statusCode).toBe(409);
  expect((await app.inject({ method: 'DELETE', url: `${base}/registrations/${r.id}`, headers: ifMatch(r.rev) })).statusCode).toBe(409);
});

test('catégorie : rev stable entre deux lectures ; regenerate avec une rev périmée → 409', async () => {
  const [first] = await categories();
  const again = (await categories()).find((c) => c.id === first!.id)!;
  expect(again.rev).toBe(first!.rev);
  expect((await app.inject({ method: 'PATCH', url: `${base}/categories/${first!.id}`, headers: ifMatch(first!.rev), payload: { repechage: true } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `${base}/categories/${first!.id}/regenerate`, headers: ifMatch(first!.rev) })).statusCode).toBe(409);
});

test('sessions et zones : GET renvoie un ETag ; PUT avec un ETag périmé → 409', async () => {
  const zones = await app.inject({ method: 'GET', url: `${base}/zones` });
  const etag = String(zones.headers.etag);
  expect(etag).toBeTruthy();
  const list = zones.json() as { id: string; name: string; disciplines: string[] | null }[];
  const body = list.map((z, i) => ({ id: z.id, name: i === 0 ? 'Tatami A' : z.name, disciplines: z.disciplines }));
  expect((await app.inject({ method: 'PUT', url: `${base}/zones`, headers: ifMatch(etag), payload: body })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url: `${base}/zones`, headers: ifMatch(etag), payload: body })).statusCode).toBe(409);
  const waves = await app.inject({ method: 'GET', url: `${base}/waves` });
  expect(waves.headers.etag).toBeTruthy();
  expect((await app.inject({ method: 'PUT', url: `${base}/waves`, headers: ifMatch('perime'), payload: [] })).statusCode).toBe(409);
});
