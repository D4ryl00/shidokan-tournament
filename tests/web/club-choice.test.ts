import { expect, test } from 'vitest';
import { choiceKey, parseChoice } from '../../src/web/components/club-picker/choice.js';

test('parseChoice reads club and directory keys', () => {
  expect(parseChoice('dir:x')).toEqual({ kind: 'directory', id: 'x' });
  expect(parseChoice('club:a:b')).toEqual({ kind: 'club', id: 'a:b' });
  expect(parseChoice('autre')).toBeNull();
  expect(parseChoice('dir:')).toBeNull();
});

test('choiceKey and parseChoice round-trip', () => {
  for (const c of [{ kind: 'club', id: '1' }, { kind: 'directory', id: '2' }] as const) expect(parseChoice(choiceKey(c))).toEqual(c);
});
