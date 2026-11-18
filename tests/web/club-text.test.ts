import { expect, test } from 'vitest';
import { categoryLabel, type CategoryKey } from '../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { RULE_LABELS } from '../../src/domain/replacement/rules.js';
import type { MoveView } from '../../src/domain/replacement/view.js';
import { clubRequestText } from '../../src/web/components/replacement/clubText.js';
import { whyText } from '../../src/web/components/replacement/keyDiff.js';

const grid = ffkDefaultGrid();
const key = (ageBandCodes: string[], weightClassIds: string[]): CategoryKey => ({ discipline: 'karate', ruleset: 'jiyu', sex: 'M', ageBandCodes, weightClassIds });
const from = key(['cadet'], ['cadet:M:-60']);
const to = key(['junior'], ['junior:M:-60']);
const FROM = categoryLabel(from, grid);
const TO = categoryLabel(to, grid);

type Details = MoveView['details'];
const view = (movers: MoveView['movers'], extra: Partial<MoveView> = {}): MoveView =>
  ({ why: { kind: 'alone' }, sex: 'M', from, to, forced: false, details: movers[0]!.details, movers, ...extra }) as MoveView;
const ageUp: Details = [{ rule: 'ageUp', detail: 'Cadets → Juniors' }];
const people: Record<string, { firstName: string; lastName: string; club: string | null }> = {
  a: { firstName: 'Lucas', lastName: 'MARTIN', club: 'Karaté Club Rennes' },
  b: { firstName: 'Emma', lastName: 'GIRARD', club: null },
};
const person = (id: string) => people[id]!;

test('un combattant, une règle avec détail', () => {
  expect(clubRequestText(view([{ registrationId: 'a', details: ageUp }]), grid, person))
    .toBe(`Lucas MARTIN - Karaté Club Rennes - ${FROM} : ${RULE_LABELS.ageUp} Cadets → Juniors (vers ${TO})`);
});

test('détail vide : le libellé seul ; deux règles séparées par " ; "', () => {
  const details: Details = [{ rule: 'ageUp', detail: '' }, { rule: 'weight', detail: '-60 → -65' }];
  expect(clubRequestText(view([{ registrationId: 'a', details }]), grid, person))
    .toBe(`Lucas MARTIN - Karaté Club Rennes - ${FROM} : ${RULE_LABELS.ageUp} ; ${RULE_LABELS.weight} -60 → -65 (vers ${TO})`);
});

test('correction imposée : la raison, sans la règle retour ; club null : sans club', () => {
  const v = view([{ registrationId: 'b', details: [{ rule: 'return', detail: '' }] }], { forced: true });
  expect(clubRequestText(v, grid, person)).toBe(`Emma GIRARD - sans club - ${FROM} : ${whyText(v.why, v.sex)} (vers ${TO})`);
});

test('deux combattants : deux lignes', () => {
  const v = view([{ registrationId: 'a', details: ageUp }, { registrationId: 'b', details: [{ rule: 'ageUp', detail: '' }] }]);
  expect(clubRequestText(v, grid, person).split('\n')).toEqual([
    `Lucas MARTIN - Karaté Club Rennes - ${FROM} : ${RULE_LABELS.ageUp} Cadets → Juniors (vers ${TO})`,
    `Emma GIRARD - sans club - ${FROM} : ${RULE_LABELS.ageUp} (vers ${TO})`,
  ]);
});
