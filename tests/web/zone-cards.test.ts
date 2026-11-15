import { MantineProvider } from '@mantine/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { Zone } from '../../src/domain/zones.js';
import type { QueueItem } from '../../src/web/api.js';
import { ZoneQueueCard } from '../../src/web/components/ZoneQueueCard.js';
import { zoneCardsVisible } from '../../src/web/components/ZoneCards.js';

test('« À trancher » : seulement sur un PC (rôle local) qui gère la compétition', () => {
  expect(zoneCardsVisible('local', true)).toBe(true);
  expect(zoneCardsVisible('local', false)).toBe(false); // copie en lecture seule (portable de zone)
  expect(zoneCardsVisible('serveur', true)).toBe(false); // serveur en ligne : pas de journaux de zone
  expect(zoneCardsVisible(undefined, undefined)).toBe(false);
});

const item = (number: number, early: boolean): QueueItem => ({
  number, categoryId: 'c', categoryLabel: 'Cadets -60 kg', matchId: `m${number}`, a: 'A', b: 'B', aClub: 'Club A', bClub: 'Sans club', katakas: null, kataPart: null, lineup: null, noRest: false, held: false, early,
});
const render = (queue: QueueItem[]) =>
  renderToStaticMarkup(createElement(MantineProvider, null, createElement(ZoneQueueCard, {
    zone: { id: 'z', name: 'Tatami 1' } as Zone, queue, waitingOtherZones: 0, autonomous: false, onEnter: () => {}, onScore: () => {},
  })));

test('« Prête · peut passer plus tôt » : sur une ligne early, jamais sur la première', () => {
  const html = render([item(1, true), item(2, false), item(3, true)]);
  expect(html.match(/data-testid="queue-early"/g)).toHaveLength(1);
  expect(html).toContain('Prête · peut passer plus tôt');
  expect(html.indexOf('data-number="3"')).toBeLessThan(html.indexOf('queue-early'));
  expect(html.indexOf('data-number="2"')).toBeLessThan(html.indexOf('data-number="3"'));
});

test('sans ligne early : pas de mention', () => {
  expect(render([item(1, false), item(2, false)])).not.toContain('queue-early');
});

const kata = (number: number, list: { name: string; club: string; done: boolean }[], round: 'tour1' | 'finale' = 'tour1'): QueueItem => ({
  number, categoryId: 'k', categoryLabel: 'Kata Filles', matchId: null, a: null, b: null, aClub: null, bClub: null, katakas: list.length, kataPart: null,
  lineup: { round, list }, noRest: false, held: false, early: false,
});
const k = (name: string, club: string, done = false) => ({ name, club, done });

test('combat : le club de chaque combattant, à l’appel et sur les lignes suivantes', () => {
  const html = render([item(1, false), item(2, false)]);
  expect(html.match(/Club A/g)).toHaveLength(2);
  expect(html.match(/Sans club/g)).toHaveLength(2);
});

test('kata à l’appel : « kataka i sur n », se présente, se prépare', () => {
  const html = render([kata(1, [k('DUPONT Léa', 'Shidokan Paris', true), k('MOREAU Inès', 'KC Nantes'), k('GIRARD Zoé', 'Shidokan Lyon')])]);
  expect(html).toContain('Kata Filles (tour 1)');
  expect(html).toContain('kataka 2 sur 3');
  const current = html.slice(html.indexOf('kata-current'), html.indexOf('kata-next'));
  expect(current).toContain('Se présente :');
  expect(current).toContain('MOREAU Inès');
  expect(current).toContain('KC Nantes');
  expect(html.slice(html.indexOf('kata-next'))).toContain('GIRARD Zoé');
});

test('kata à l’appel, dernier kataka : pas de « Se prépare »', () => {
  const html = render([kata(1, [k('DUPONT Léa', 'Shidokan Paris', true), k('MOREAU Inès', 'KC Nantes')], 'finale')]);
  expect(html).toContain('Kata Filles (finale)');
  expect(html).toContain('Se présente :');
  expect(html).not.toContain('Se prépare');
});

test('kata à l’appel, tous notés (départage à faire) : personne n’est appelé', () => {
  const html = render([kata(1, [k('DUPONT Léa', 'Shidokan Paris', true)], 'finale')]);
  expect(html).not.toContain('Se présente');
  expect(html).not.toContain('kataka 1 sur 1');
});

test('kata dans « Ensuite » : tous les katakas avec leur club, dans l’ordre', () => {
  const html = render([item(1, false), kata(2, [k('DUPONT Léa', 'Shidokan Paris'), k('MOREAU Inès', 'KC Nantes')])]);
  const lineup = html.slice(html.indexOf('kata-lineup'));
  expect(lineup.indexOf('DUPONT Léa')).toBeLessThan(lineup.indexOf('MOREAU Inès'));
  expect(lineup).toContain('Shidokan Paris');
  expect(lineup).toContain('KC Nantes');
});
