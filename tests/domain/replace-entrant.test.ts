import { expect, test } from 'vitest';
import { generateBracket, replaceEntrant, type CombatBracket, type KataBracket } from '../../src/domain/brackets/index.js';
import { entrants } from './brackets/helpers.js';

const OPTS = { repechage: false, thirdPlace: false, kataBronzeCount: 1 as const };
const x = { registrationId: 'x', clubId: 'cx', label: 'X' };

test('élimination : même case, même côté', () => {
  const b = generateBracket('single_elimination', entrants(5), OPTS, 3) as CombatBracket;
  const snapshot = JSON.stringify(b);
  const n = replaceEntrant(b, 'r2', x) as CombatBracket;
  expect(JSON.stringify(b)).toBe(snapshot);
  b.matches.forEach((m, i) => {
    for (const side of ['a', 'b'] as const) {
      const was = m[side];
      const now = n.matches[i]![side];
      expect(now).toEqual(was.kind === 'entrant' && was.registrationId === 'r2' ? { kind: 'entrant', registrationId: 'x' } : was);
    }
  });
  expect(n.entrants.map((e) => e.registrationId)).toEqual(b.entrants.map((e) => (e.registrationId === 'r2' ? 'x' : e.registrationId)));
  expect(n.entrants.find((e) => e.registrationId === 'x')).toEqual(x);
});
test('poules', () => {
  const b = generateBracket('round_robin', entrants(4), OPTS, 3) as CombatBracket;
  const n = replaceEntrant(b, 'r2', x) as CombatBracket;
  expect(n.pools!.flat()).toContain('x');
  expect(n.pools!.flat()).not.toContain('r2');
  expect(b.pools!.flat()).toContain('r2');
});
test('kata', () => {
  const b = generateBracket('kata_two_rounds', entrants(4), OPTS, 3) as KataBracket;
  const n = replaceEntrant(b, 'r2', x) as KataBracket;
  expect(n.order).toEqual(b.order.map((id) => (id === 'r2' ? 'x' : id)));
  expect(b.order).toContain('r2');
});
