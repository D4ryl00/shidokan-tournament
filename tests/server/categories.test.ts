import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { generateBracket, type Bracket, type BracketFormat } from '../../src/domain/brackets/index.js';
import { buildApp } from '../../src/server/app.js';
import { buildFfkWorkbook } from '../helpers/ffk-fixture.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function register(over: object = {}) {
  return (await registerRow(over)).id;
}
async function registerRow(over: object = {}) {
  n++;
  const res = await req('POST', '/registrations', {
    clubId: null, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}
type Cat = { id: string; label: string; status: string; effectiveFormat: string; registrationIds: string[]; seed: number; stale: boolean; arranged: boolean; bracket: { kind: string; matches?: { id: string }[]; order?: string[]; entrants: { registrationId: string }[] } | null };
const categories = async () => (await req('GET', '/categories')).json() as Cat[];

test('3 inscrites → poule ; 4e → élimination directe', async () => {
  for (let i = 0; i < 3; i++) await register();
  let [c] = await categories();
  expect(c).toMatchObject({ label: 'Karaté · Jiyu · Cadets F · -54 kg', status: 'provisional', effectiveFormat: 'round_robin' });
  expect(c!.bracket!.matches).toHaveLength(3);
  await register();
  [c] = await categories();
  expect(c!.effectiveFormat).toBe('single_elimination');
  expect(c!.registrationIds).toHaveLength(4);
  expect(c!.bracket!.matches).toHaveLength(3);
});

test('seule dans sa catégorie : pas de match ; dernière inscription supprimée → catégorie supprimée', async () => {
  const id = await register();
  const [c] = await categories();
  expect(c!.bracket!.matches).toEqual([]);
  await req('DELETE', `/registrations/${id}`);
  expect(await categories()).toEqual([]);
});

test('kata → kata_two_rounds', async () => {
  await register({ discipline: 'kata', ruleset: null, weightClassId: null });
  await register({ discipline: 'kata', ruleset: null, weightClassId: null });
  const [c] = await categories();
  expect(c).toMatchObject({ effectiveFormat: 'kata_two_rounds', label: 'Kata · Cadets F' });
  expect(c!.bracket!.kind).toBe('kata');
});

test('changement de format ; format incompatible refusé', async () => {
  for (let i = 0; i < 4; i++) await register();
  const [c] = await categories();
  const res = await req('PATCH', `/categories/${c!.id}`, { format: 'round_robin' });
  expect(res.json()).toMatchObject({ effectiveFormat: 'round_robin' });
  expect(res.json().bracket.matches).toHaveLength(6);
  expect((await req('PATCH', `/categories/${c!.id}`, { format: 'best_of_three' })).statusCode).toBe(400);
});

test('verrouillage : catégorie lancée jamais régénérée', async () => {
  for (let i = 0; i < 3; i++) await register();
  const [c] = await categories();
  expect((await req('PATCH', `/categories/${c!.id}`, { status: 'started' })).statusCode).toBe(200);
  const before = (await categories())[0]!.bracket;
  await register();
  const [after] = await categories();
  expect(after!.bracket).toEqual(before);
  expect(after!.registrationIds).toHaveLength(4);
  expect(after!.stale).toBe(true);
  expect((await req('POST', `/categories/${c!.id}/redraw`)).statusCode).toBe(409);
  expect((await req('PATCH', `/categories/${c!.id}`, { status: 'ready' })).statusCode).toBe(409);
  const unlocked = await req('PATCH', `/categories/${c!.id}`, { status: 'ready', unlock: true });
  expect(unlocked.statusCode).toBe(200);
  expect(unlocked.json().bracket.entrants).toHaveLength(4);
  expect(unlocked.json().stale).toBe(false);
});

test('nouveau tirage et échange', async () => {
  for (let i = 0; i < 8; i++) await register();
  const [c] = await categories();
  const redrawn = (await req('POST', `/categories/${c!.id}/redraw`)).json() as Cat;
  expect(redrawn.seed).not.toBe(c!.seed);
  const [a, b] = redrawn.bracket!.entrants.map((e) => e.registrationId);
  const swapped = (await req('POST', `/categories/${c!.id}/swap`, { a, b })).json() as Cat;
  expect(swapped.bracket!.entrants.slice(0, 2).map((e) => e.registrationId)).toEqual([b, a]);
});

test('réglage de compétition (repêchage) appliqué aux catégories sans valeur propre', async () => {
  for (let i = 0; i < 8; i++) await register();
  await app.inject({ method: 'PATCH', url: base, payload: { settings: { repechage: true } } });
  const [c] = await categories();
  expect(c!.bracket!.matches!.some((m) => m.id.startsWith('rep'))).toBe(true);
});

test('import FFK → une catégorie par clé distincte', async () => {
  const file = buildFfkWorkbook({
    Karate: [
      ['A A', null, 'L1', '1 C', 'Feminine', 'Karate', 'Cadet', -54, null],
      ['B B', null, 'L2', '1 C', 'Feminine', 'Karate', 'Cadet', -54, null],
      ['C C', null, 'L3', '1 C', 'Masculin', 'Karate', 'Senior', -75, null],
    ],
  });
  const up = (await app.inject({ method: 'POST', url: `${base}/ffk-imports`, payload: file, headers: { 'content-type': 'application/octet-stream' } })).json();
  await req('POST', `/ffk-imports/${up.uploadId}/commit`, { sheets: up.sheets });
  expect((await categories()).map((c) => c.registrationIds.length)).toEqual([2, 1]);
});

test('changement de libellé dans la grille : pas de régénération (l’échange manuel reste)', async () => {
  for (let i = 0; i < 4; i++) await register();
  const [c] = await categories();
  const [a, b] = c!.bracket!.entrants.map((e) => e.registrationId);
  const swapped = (await req('POST', `/categories/${c!.id}/swap`, { a, b })).json() as Cat;
  const grid = (await req('GET', '/grid')).json() as { weightClasses: { id: string; label: string; maxKg: number | null }[] };
  const wc = grid.weightClasses.find((w) => w.id === 'cadet:F:-54')!;
  wc.label = '-55';
  wc.maxKg = 55;
  await app.inject({ method: 'PUT', url: `${base}/grid`, payload: grid });
  const [after] = await categories();
  expect(after!.label).toContain('-55');
  expect(after!.bracket).toEqual(swapped.bracket);
});

test('échange : combattants identiques ou étrangers au tableau refusés', async () => {
  for (let i = 0; i < 4; i++) await register();
  const [c] = await categories();
  const a = c!.bracket!.entrants[0]!.registrationId;
  expect((await req('POST', `/categories/${c!.id}/swap`, { a, b: a })).statusCode).toBe(400);
  expect((await req('POST', `/categories/${c!.id}/swap`, { a, b: 'inconnu' })).statusCode).toBe(400);
});

test('catégorie lancée : un changement de poids ne déplace pas le combattant', async () => {
  const id = await register();
  await register();
  const [c] = await categories();
  await req('PATCH', `/categories/${c!.id}`, { status: 'started' });
  await app.inject({ method: 'PUT', url: `${base}/registrations/${id}`, payload: {
    clubId: null, lastName: 'NOMX', firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-61', source: 'manual',
  } });
  const cats = await categories();
  expect(cats.find((x) => x.id === c!.id)!.registrationIds).toContain(id);
  expect(cats).toHaveLength(1);
});

test('catégorie prête : régénérée quand un inscrit est ajouté', async () => {
  for (let i = 0; i < 3; i++) await register();
  const [c] = await categories();
  await req('PATCH', `/categories/${c!.id}`, { status: 'ready' });
  await register();
  const [after] = await categories();
  expect(after!.status).toBe('ready');
  expect(after!.bracket!.entrants).toHaveLength(4);
});


test('tableau non régénéré (lancé) : les noms des inscrits suivent les corrections', async () => {
  const a = await register();
  await register();
  const [c] = await categories();
  await req('PATCH', `/categories/${c!.id}`, { status: 'started' });
  const res = await app.inject({ method: 'PUT', url: `${base}/registrations/${a}`, payload: {
    clubId: null, lastName: 'CORRIGÉ', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54', source: 'manual',
  } });
  expect(res.statusCode).toBe(200);
  const [after] = await categories();
  expect(after!.status).toBe('started');
  const entrant = (after!.bracket!.entrants as { registrationId: string; label: string }[]).find((e) => e.registrationId === a)!;
  expect(entrant.label).toBe('CORRIGÉ Léa');
});

describe('tableaux arrangés à la main', () => {
  type Slot = { kind: string; registrationId?: string };
  type FullCat = Omit<Cat, 'bracket'> & { bracket: Bracket & { matches?: { id: string; phase: string; round: number; a: Slot; b: Slot }[] } };
  const full = async () => (await categories())[0] as unknown as FullCat;
  const side = (s: Slot) => (s.kind === 'entrant' ? s.registrationId! : null);
  /** Paires du 1er tour (exemptions : null), chaque paire triée. */
  const firstRound = (c: FullCat) =>
    c.bracket.matches!.filter((m) => m.phase === 'main' && m.round === 1).map((m) => [side(m.a), side(m.b)]);
  const realPairs = (c: FullCat) =>
    firstRound(c).filter((p): p is [string, string] => p[0] !== null && p[1] !== null).map((p) => [...p].sort().join('+')).sort();
  const pair = (x: string, y: string) => [x, y].sort().join('+');
  /**
   * x et y se rencontrent dans leur premier combat : face à face au 1er tour, ou chacun exempt dans deux matchs voisins
   * (4 ➜ 5 inscrits : un seul match complet au 1er tour, l'autre paire se retrouve au 2e).
   */
  const meetFirst = (c: FullCat, x: string, y: string) => {
    const slots = firstRound(c).flat();
    const [i, j] = [slots.indexOf(x), slots.indexOf(y)];
    if (i < 0 || j < 0) return false;
    if ((i ^ 1) === j) return true;
    return i >> 2 === j >> 2 && slots[i ^ 1] === null && slots[j ^ 1] === null;
  };
  /** Échanges jusqu'à obtenir les paires [r1, r2], [r3, r4] au 1er tour (au moins un échange). */
  async function arrange(c: FullCat, [r1, r2]: string[]): Promise<FullCat> {
    const partner = firstRound(c).map((p) => (p[0] === r1 ? p[1] : p[1] === r1 ? p[0] : undefined)).find((x) => x !== undefined)!;
    const [a, b] = partner === r2 ? [r1, r2] : [partner!, r2];
    const res = await req('POST', `/categories/${c.id}/swap`, { a, b });
    expect(res.statusCode).toBe(200);
    return res.json() as FullCat;
  }

  test('un échange marque le tableau arrangé ; Nouveau tirage le remet à false', async () => {
    for (let i = 0; i < 4; i++) await register();
    const c = await full();
    expect(c.arranged).toBe(false);
    const [a, b] = c.bracket.entrants.map((e) => e.registrationId);
    expect(((await req('POST', `/categories/${c.id}/swap`, { a, b })).json() as Cat).arranged).toBe(true);
    expect((await full()).arranged).toBe(true);
    expect(((await req('POST', `/categories/${c.id}/redraw`)).json() as Cat).arranged).toBe(false);
    expect((await full()).arranged).toBe(false);
  });

  test('l’arrivée d’un inscrit garde les échanges', async () => {
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await register());
    const arranged = await arrange(await full(), r);
    expect(realPairs(arranged)).toEqual([pair(r[0]!, r[1]!), pair(r[2]!, r[3]!)].sort());
    await register();
    const after = await full();
    expect(after.bracket.entrants).toHaveLength(5);
    expect(realPairs(after)).toHaveLength(1);
    expect(meetFirst(after, r[0]!, r[1]!)).toBe(true);
    expect(meetFirst(after, r[2]!, r[3]!)).toBe(true);
    expect(after.arranged).toBe(true);
  });

  test('un tableau sans échange est tiré comme avant', async () => {
    for (let i = 0; i < 5; i++) await register();
    const c = await full();
    const settings = (await app.inject({ method: 'GET', url: base })).json().settings as { repechage: boolean; thirdPlaceMatch: boolean; kataBronzeCount: 1 | 2 };
    const entrants = [...c.bracket.entrants].sort((x, y) => (x.registrationId < y.registrationId ? -1 : 1));
    const expected = generateBracket(c.effectiveFormat as BracketFormat, entrants, { repechage: settings.repechage, thirdPlace: settings.thirdPlaceMatch, kataBronzeCount: settings.kataBronzeCount }, c.seed);
    expect(c.arranged).toBe(false);
    expect(c.bracket).toEqual(expected);
  });

  test('absent puis présent : son adversaire exempt, autres paires gardées ; de retour, il retrouve une place face à un exempté', async () => {
    const rows = [];
    for (let i = 0; i < 4; i++) rows.push(await registerRow());
    const r = rows.map((x) => x.id);
    const c0 = await full();
    await req('PATCH', `/categories/${c0.id}`, { format: 'single_elimination' });
    await arrange(await full(), r);
    await app.inject({ method: 'PUT', url: `${base}/weigh-in/${rows[0]!.fighterId}`, payload: { presence: 'absent' } });
    const absent = await full();
    expect(absent.bracket.entrants.map((e) => e.registrationId)).not.toContain(r[0]);
    expect(firstRound(absent)).toEqual(expect.arrayContaining([expect.arrayContaining([r[1], null])]));
    expect(realPairs(absent)).toEqual([pair(r[2]!, r[3]!)]);
    expect(absent.arranged).toBe(true);
    const exempted = firstRound(absent).filter((p) => p.includes(null)).flat().filter((x) => x !== null);
    await app.inject({ method: 'PUT', url: `${base}/weigh-in/${rows[0]!.fighterId}`, payload: { presence: 'present' } });
    const back = await full();
    const opponent = firstRound(back).map((p) => (p[0] === r[0] ? p[1] : p[1] === r[0] ? p[0] : undefined)).find((x) => x !== undefined);
    expect(exempted).toContain(opponent);
    expect(realPairs(back)).toEqual(expect.arrayContaining([pair(r[2]!, r[3]!)]));
    expect(back.arranged).toBe(true);
  });

  test('Régénérer (session figée) garde les places', async () => {
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await register());
    const c = await full();
    await req('PATCH', `/categories/${c.id}`, { status: 'ready' });
    await arrange(await full(), r);
    expect((await req('POST', '/launch', { waveId: null, restart: false })).statusCode).toBe(204);
    await register();
    const frozen = await full();
    expect(frozen.stale).toBe(true);
    expect(frozen.bracket.entrants).toHaveLength(4);
    expect((await req('POST', `/categories/${c.id}/regenerate`)).statusCode).toBe(200);
    const after = await full();
    expect(after.bracket.entrants).toHaveLength(5);
    expect(meetFirst(after, r[0]!, r[1]!)).toBe(true);
    expect(meetFirst(after, r[2]!, r[3]!)).toBe(true);
    expect(after.arranged).toBe(true);
  });
});
