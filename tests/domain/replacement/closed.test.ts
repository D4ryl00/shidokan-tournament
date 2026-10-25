import { expect, test } from 'vitest';
import { applyAll, bulkPlan } from '../../../src/domain/replacement/apply.js';
import { detectCases } from '../../../src/domain/replacement/detect.js';
import { proposalsFor } from '../../../src/domain/replacement/propose.js';
import type { State } from '../../../src/domain/replacement/types.js';
import { makeState, member } from './fixtures.js';

const caseOf = (s: State, id: string) => detectCases(s).find((c) => c.id === id)!;
const target = (p: { target: { categoryId: string } | { newKey: unknown } }) => ('categoryId' in p.target ? p.target.categoryId : null);

test("membre d'une catégorie fermée : un cas closed, ni alone ni weight_gap", () => {
  const a = member({ weightClassId: 'cadet:F:-54' });
  const s = makeState([a], { closedEntries: ['cadet|F|karate|jiyu'] });
  expect(detectCases(s).map((c) => [c.kind, c.registrationId, c.detail])).toEqual([['closed', a.registrationId, 'Catégorie non ouverte à cette compétition']]);
});

/** Cadettes en karaté jiyu (fermé), cadettes en shido-boxing (ouvert), juniors en karaté jiyu (fermé). */
function closedFixture() {
  const a = member({ weightClassId: 'cadet:F:-54', otherDisciplines: ['shido-boxing'] });
  const b = member({ weightClassId: 'cadet:F:-54' });
  const c = member({ weightClassId: 'cadet:F:-54', discipline: 'shido-boxing' });
  const d = member({ weightClassId: 'cadet:F:-54', discipline: 'shido-boxing' });
  const e = member({ ageBandCode: 'junior', weightClassId: 'junior:F:-53' });
  const f = member({ ageBandCode: 'junior', weightClassId: 'junior:F:-53' });
  const s = makeState([a, b, c, d, e, f], { closedEntries: ['cadet|F|karate|jiyu', 'junior|F|karate|jiyu'] });
  return { s, a, b, c, e };
}

test('propositions jamais vers une catégorie fermée', () => {
  const { s, a, c, e } = closedFixture();
  const props = proposalsFor(s, caseOf(s, `closed:${a.registrationId}`));
  expect(props.length).toBeGreaterThan(0);
  expect(props.every((p) => target(p) === c.categoryId)).toBe(true);
  expect(props.some((p) => target(p) === e.categoryId)).toBe(false);
});

test('cible multi-tranches à moitié ouverte : proposée', () => {
  const x = member({ ageBandCode: 'junior', weightClassId: 'junior:F:-53', categoryId: 'merged' });
  const y = member({ ageBandCode: 'junior', weightClassId: 'junior:F:-53', categoryId: 'merged' });
  const m = member({ weightClassId: 'cadet:F:-54' });
  const merged = {
    id: 'merged', status: 'provisional' as const, aliasKeys: [], waveOverride: null,
    key: { discipline: 'karate' as const, ruleset: 'jiyu' as const, sex: 'F' as const, ageBandCodes: ['cadet', 'junior'], weightClassIds: ['cadet:F:-54', 'junior:F:-53'] },
  };
  const s = makeState([x, y, m], { categories: [merged], closedEntries: ['cadet|F|karate|jiyu'] });
  const props = proposalsFor(s, caseOf(s, `closed:${m.registrationId}`));
  expect(props.some((p) => target(p) === 'merged')).toBe(true);
});

test("déplacé hors d'une catégorie fermée : pas de retour", () => {
  const { s, a } = closedFixture();
  const first = proposalsFor(s, caseOf(s, `closed:${a.registrationId}`))[0]!;
  const after = applyAll(s, first);
  const moved = after.members.find((m) => m.registrationId === a.registrationId)!;
  expect(moved.original?.reason).toBe('closed');
  const reopened = { ...after, closedEntries: [] };
  expect(detectCases(reopened).some((c) => c.id === `return:${a.registrationId}`)).toBe(false);
});

test('classement automatique : déplace un combattant de catégorie fermée', () => {
  const { s, a } = closedFixture();
  expect(bulkPlan(s, 'all').steps.some((step) => step.proposal.caseId === `closed:${a.registrationId}`)).toBe(true);
});
