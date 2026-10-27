import { expect, test } from 'vitest';
import { preparePlanState } from '../../../src/domain/replacement/plan-inputs.js';
import type { PlanChoice } from '../../../src/domain/replacement/plan.js';
import { makeState, member } from './fixtures.js';

const refuse = (proposalId: string, registrationId: string): PlanChoice => ({ kind: 'refuse', proposalId, registrationId, reason: 'raison' });

test('preparePlanState : refus du plan ajoutés aux refus des cartes quand la coche est cochée', () => {
  const a = member();
  const s = makeState([a], { refused: ['carte'], setAside: ['alone:x'] });
  const validate: PlanChoice = { kind: 'validate', proposalId: 'p', caseId: 'c' };
  const r = preparePlanState(s, [validate, refuse('plan', a.registrationId)], true, null);
  expect(r.state.refused).toEqual(['carte', 'plan']);
  expect(r.state.setAside).toEqual(['alone:x']);
  expect(r.choices).toEqual([validate]);
  expect(r.stale).toEqual([]);
});

test('preparePlanState : coche décochée, refus des cartes et mises de côté ignorés', () => {
  const a = member();
  const s = makeState([a], { refused: ['carte'], setAside: ['alone:x'] });
  const r = preparePlanState(s, [refuse('plan', a.registrationId)], false, null);
  expect(r.state.refused).toEqual(['plan']);
  expect(r.state.setAside).toEqual([]);
  // L'état d'origine n'est pas touché.
  expect(s.refused).toEqual(['carte']);
});

test('preparePlanState : refus d’un combattant absent, supprimé ou d’une autre session : stale', () => {
  const here = member();
  const gone = member({ presence: 'absent' });
  const s = makeState([here, gone]);
  const kept = refuse('a', here.registrationId);
  const absent = refuse('b', gone.registrationId);
  const deleted = refuse('c', 'inconnu');
  const r = preparePlanState(s, [kept, absent, deleted], true, null);
  expect(r.stale).toEqual([absent, deleted]);
  // Un refus « stale » n'écarte plus rien.
  expect(r.state.refused).toEqual(['a']);
  // Autre session : le combattant n'est pas dans la session demandée.
  expect(preparePlanState(s, [kept], true, 'vague-2').stale).toEqual([kept]);
});

test('preparePlanState : un refus dont le cas n’existe qu’au milieu du plan n’est pas stale', () => {
  // Le combattant est présent dans la session sans aucun cas dans l'état réel : son refus reste.
  const a = member();
  const b = member();
  const s = makeState([a, b]);
  const choice = refuse(`A:${a.registrationId}>ailleurs`, a.registrationId);
  expect(preparePlanState(s, [choice], true, null).stale).toEqual([]);
});
