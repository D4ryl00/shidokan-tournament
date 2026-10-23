import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { seedDev } from '../../scripts/seed-dev.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
});
afterEach(async () => app.close());

type Reg = { discipline: string; ruleset: string | null; otherDisciplines: string[]; acceptsJiyuFirst: boolean | null; fighter: { sex: string; ageBandCode: string; grade: string | null }; club: { name: string } | null };

test('script de dev : une compétition de test, des combattants dans des catégories variées', async () => {
  const { competitionId, registrations } = await seedDev(app, { seed: 1 });
  const regs = (await app.inject({ method: 'GET', url: `/api/competitions/${competitionId}/registrations` })).json() as Reg[];
  expect(regs).toHaveLength(registrations);
  expect(regs.length).toBeGreaterThanOrEqual(80);
  // Toutes les disciplines, les deux sexes, mineurs et adultes, jiyu et shobu
  expect(new Set(regs.map((r) => r.discipline))).toEqual(new Set(['karate', 'shido-boxing', 'shido-mix', 'triathlon', 'kata']));
  expect(new Set(regs.map((r) => r.fighter.sex))).toEqual(new Set(['F', 'M']));
  expect(new Set(regs.map((r) => r.fighter.ageBandCode)).size).toBeGreaterThanOrEqual(8);
  expect(regs.some((r) => r.ruleset === 'shobu' && r.acceptsJiyuFirst === true)).toBe(true);
  expect(regs.some((r) => r.otherDisciplines.length > 0)).toBe(true);
  expect(regs.some((r) => r.discipline === 'kata' && r.fighter.grade)).toBe(true);
  expect(regs.some((r) => r.club === null)).toBe(true);
  // Des tableaux générés, des catégories avec un seul combattant (cas de recasement)
  const cats = (await app.inject({ method: 'GET', url: `/api/competitions/${competitionId}/categories` })).json() as { registrationIds: string[]; bracket: unknown }[];
  expect(cats.filter((c) => c.registrationIds.length >= 4 && c.bracket).length).toBeGreaterThanOrEqual(3);
  const rep = (await app.inject({ method: 'GET', url: `/api/competitions/${competitionId}/replacement` })).json() as { cases: unknown[] };
  expect(rep.cases.length).toBeGreaterThan(0);
});

test('script de dev : mêmes données pour une même graine, sans toucher aux autres compétitions', async () => {
  const other = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Vraie compétition', date: '2026-11-22' } })).json().id as string;
  const a = await seedDev(app, { seed: 7 });
  const b = await seedDev(app, { seed: 7 });
  const names = async (id: string) =>
    ((await app.inject({ method: 'GET', url: `/api/competitions/${id}/registrations` })).json() as { fighter: { lastName: string; firstName: string } }[])
      .map((r) => `${r.fighter.lastName} ${r.fighter.firstName}`).sort();
  expect(await names(a.competitionId)).toEqual(await names(b.competitionId));
  expect((await app.inject({ method: 'GET', url: `/api/competitions/${other}/registrations` })).json()).toEqual([]);
}, 20_000); // deux compétitions générées : plus lent que les autres quand toute la suite tourne en parallèle
