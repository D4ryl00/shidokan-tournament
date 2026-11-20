import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import type { DayEstimateView } from '../../src/domain/schedule/estimate.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
let n = 0;
async function reg(over: object = {}) {
  const res = await call('POST', '/registrations', {
    clubId: null, lastName: `NOM${++n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'kata', ruleset: null, weightClassId: null, source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
}
const many = async (count: number, over: object = {}) => {
  for (let i = 0; i < count; i++) await reg(over);
};
const h = (hh: number, mm: number) => hh * 3600 + mm * 60;
const estimate = async (query = '') => {
  const res = await call('GET', `/schedule/estimate${query}`);
  expect(res.statusCode).toBe(200);
  return res.json() as DayEstimateView;
};

/**
 * Une zone ; Matin (minimes) et Après-midi (cadets) : un kata de 3 chacune, 5 passages de 1 min 30 et un changement
 * (1 min) entre le tour 1 et la finale = 8 min 30.
 */
async function twoSessions() {
  const [zone] = (await call('GET', '/zones')).json() as { id: string }[];
  await call('PUT', '/zones', [{ id: zone!.id, name: 'Tatami 1' }]);
  const [matin, aprem] = (await call('PUT', '/waves', [
    { name: 'Matin', rules: { ageBandCodes: ['minime'], disciplines: [] } },
    { name: 'Après-midi', rules: { ageBandCodes: ['cadet'], disciplines: [] } },
  ])).json() as { id: string }[];
  await many(3, { ageBandCode: 'minime' });
  await many(3);
  return { zoneId: zone!.id, matin: matin!.id, aprem: aprem!.id };
}

describe('horaires estimés de la journée', () => {
  test('sessions lancée et non lancée ; sans début prévu, la session suit la précédente', async () => {
    const { zoneId, matin, aprem } = await twoSessions();
    await call('PUT', '/wave-schedules', { waveId: matin, plannedStart: '09:00' });
    for (const c of (await call('GET', '/categories')).json() as { id: string; waveId: string | null }[]) {
      if (c.waveId === matin) await call('PATCH', `/categories/${c.id}`, { status: 'ready' });
    }
    expect((await call('POST', '/launch', { waveId: matin, restart: false })).statusCode).toBe(204);

    const e = await estimate();
    expect(e.relative).toBe(false);
    expect(e.zones).toEqual([{ id: zoneId, name: 'Tatami 1' }]);
    expect(e.waves).toEqual([
      { key: matin, name: 'Matin', start: h(9, 0), end: h(9, 8) + 30, finalsStart: null, finalsZoneId: null, zones: [{ zoneId, start: h(9, 0), end: h(9, 8) + 30, passages: 5 }], overlap: [] },
      // Non lancée : estimée quand même, après la session du matin et le changement (1 min).
      { key: aprem, name: 'Après-midi', start: h(9, 9) + 30, end: h(9, 18), finalsStart: null, finalsZoneId: null, zones: [{ zoneId, start: h(9, 9) + 30, end: h(9, 18), passages: 5 }], overlap: [] },
    ]);
    expect(e.end).toBe(h(9, 18));
  });

  test('chevauchement : décalé par défaut, pas avec decaler=0, l’alerte dans les deux cas', async () => {
    const { zoneId, matin, aprem } = await twoSessions();
    await call('PUT', '/wave-schedules', { waveId: matin, plannedStart: '09:00' });
    await call('PUT', '/wave-schedules', { waveId: aprem, plannedStart: '09:05' });
    // Matin finit à 9:08:30, + 1 min de changement : 4 min 30 de chevauchement, arrondies à 5.
    const shifted = await estimate();
    expect(shifted.waves[1]!.overlap).toEqual([{ zoneId, minutes: 5 }]);
    expect(shifted.waves[1]!.zones[0]).toMatchObject({ start: h(9, 9) + 30, end: h(9, 18) });
    const plain = await estimate('?decaler=0');
    expect(plain.waves[1]!.overlap).toEqual([{ zoneId, minutes: 5 }]);
    expect(plain.waves[1]!.zones[0]).toMatchObject({ start: h(9, 5), end: h(9, 13) + 30 });
    expect(plain.end).toBe(h(9, 13) + 30);
    expect((await estimate('?decaler=1')).end).toBe(h(9, 18));
  });

  test('la zone des finales de chaque session est donnée', async () => {
    const { zoneId, matin } = await twoSessions();
    expect((await call('PUT', '/finals/zone', { waveId: matin, finalsZoneId: zoneId })).statusCode).toBe(200);
    expect((await estimate()).waves.map((w) => w.finalsZoneId)).toEqual([zoneId, null]);
  });

  test('sans session ni début prévu : relatif, depuis 0', async () => {
    await many(3);
    const e = await estimate();
    expect(e.relative).toBe(true);
    expect(e.waves).toHaveLength(1);
    expect(e.waves[0]).toMatchObject({ key: '', name: 'Session unique', start: 0, end: 510 });
  });
});
