import { expect, test } from 'vitest';
import { defaultZoneNames, validateZones } from '../../src/domain/zones.js';

test('noms de zones par défaut', () => {
  expect(defaultZoneNames(3)).toEqual(['Tatami 1', 'Tatami 2', 'Tatami 3']);
});

test('validation des zones', () => {
  expect(validateZones([])).toEqual(['Il faut au moins une zone de combat.']);
  expect(validateZones([{ name: '  ' }])).toEqual(['Une zone de combat n’a pas de nom.']);
  expect(validateZones([{ name: 'Ring' }, { name: ' ring ' }])).toEqual(['Deux zones portent le même nom : « Ring ».']);
  expect(validateZones([{ name: 'x'.repeat(41) }])).toEqual(['Nom de zone trop long (40 caractères au plus) : « ' + 'x'.repeat(41) + ' ».']);
  expect(validateZones([{ name: 'Tatami 1' }, { name: 'Ring' }])).toEqual([]);
});
