import { expect, test } from 'vitest';
import { keyString, naturalKey } from '../../src/domain/categories.js';
import { recapLines, type RecapRegistration } from '../../src/domain/club-recap.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';

const grid = ffkDefaultGrid();
const natural = (discipline: 'karate' | 'kata', wc: string | null) =>
  keyString(naturalKey({ discipline, ruleset: discipline === 'kata' ? null : 'jiyu', weightClassId: wc }, { sex: 'F', ageBandCode: 'cadet' }));
const reg = (over: Partial<RecapRegistration> = {}): RecapRegistration => ({
  lastName: 'Martin', firstName: 'Léa', sex: 'F', ageBandCode: 'cadet',
  registered: { discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54' },
  final: { kind: 'category', label: 'Karaté · Jiyu · Cadets F · -54 kg', keyString: natural('karate', 'cadet:F:-54') },
  recasementType: null,
  ...over,
});

test('non déplacé', () => {
  expect(recapLines([reg()], grid)).toEqual([
    { fighter: 'MARTIN Léa', registered: 'Karaté · Jiyu · Cadettes · -54 kg', final: 'Karaté · Jiyu · Cadets F · -54 kg', changed: false, reason: null, session: null },
  ]);
});

test('déplacé par une proposition A', () => {
  const [l] = recapLines([reg({ final: { kind: 'category', label: 'X', keyString: 'autre' }, recasementType: 'A' })], grid);
  expect(l).toMatchObject({ final: 'X', changed: true, reason: 'catégorie de poids voisine' });
});

test('absent', () => {
  const [l] = recapLines([reg({ final: { kind: 'absent' } })], grid);
  expect(l).toMatchObject({ final: 'Absent (désisté)', changed: true, reason: null });
});

test('ne combat pas et pas encore placé', () => {
  expect(recapLines([reg({ final: { kind: 'withdrawn' } })], grid)[0]).toMatchObject({ final: 'Ne combat pas', changed: true });
  expect(recapLines([reg({ final: { kind: 'unplaced' } })], grid)[0]).toMatchObject({ final: 'Pas encore placé', changed: true });
});

test('deux disciplines, absent dans une seule', () => {
  const kata = reg({
    registered: { discipline: 'kata', ruleset: null, weightClassId: null },
    final: { kind: 'category', label: 'Kata · Cadets F', keyString: natural('kata', null) },
  });
  const lines = recapLines([reg({ final: { kind: 'absent' } }), kata], grid);
  expect(lines.map((l) => [l.registered, l.changed])).toEqual([
    ['Karaté · Jiyu · Cadettes · -54 kg', true],
    ['Kata · Cadettes', false],
  ]);
});

test('catégorie regroupée sans déplacement', () => {
  const [l] = recapLines([reg({ final: { kind: 'category', label: 'Y', keyString: 'groupe' } })], grid);
  expect(l).toMatchObject({ changed: true, reason: 'catégorie regroupée' });
});

test('ordre : nom, prénom, discipline', () => {
  const kata = reg({ registered: { discipline: 'kata', ruleset: null, weightClassId: null } });
  const lines = recapLines([kata, reg({ lastName: 'Zola' }), reg({ firstName: 'Anna' }), reg()], grid);
  expect(lines.map((l) => `${l.fighter}|${l.registered.split(' ')[0]}`)).toEqual([
    'MARTIN Anna|Karaté', 'MARTIN Léa|Karaté', 'MARTIN Léa|Kata', 'ZOLA Léa|Karaté',
  ]);
});

test('pas de motif de déplacement pour un désisté ou un non-combattant', () => {
  expect(recapLines([reg({ final: { kind: 'absent' }, recasementType: 'A' })], grid)[0]!.reason).toBeNull();
  expect(recapLines([reg({ final: { kind: 'withdrawn' }, recasementType: 'A' })], grid)[0]!.reason).toBeNull();
});

test('pas de motif quand la catégorie finale est la catégorie inscrite', () => {
  expect(recapLines([reg({ recasementType: 'A' })], grid)[0]).toMatchObject({ changed: false, reason: null });
});

const placed = (sessions: RecapRegistration['sessions'], over: Partial<RecapRegistration> = {}) =>
  recapLines([reg({ sessions, ...over })], grid)[0]!;
test('session différente du protocole, catégorie inchangée : mention', () => {
  expect(placed({ announced: 'Poussins - Pupilles', final: 'Benjamins - Minimes' })).toMatchObject({ changed: false, session: 'Benjamins - Minimes' });
});
test('même session, sans sessions, session finale en attente : pas de mention', () => {
  expect(placed({ announced: 'A', final: 'A' }).session).toBeNull();
  expect(placed(undefined).session).toBeNull();
  expect(placed({ announced: 'A', final: null }).session).toBeNull();
});
test('absent, ne combat pas : pas de mention', () => {
  expect(placed({ announced: 'A', final: 'B' }, { final: { kind: 'absent' } }).session).toBeNull();
  expect(placed({ announced: 'A', final: 'B' }, { final: { kind: 'withdrawn' } }).session).toBeNull();
});
