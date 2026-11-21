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
  number, categoryId: 'c', categoryLabel: 'Cadets -60 kg', matchId: `m${number}`, a: 'A', b: 'B', aClub: 'Club A', bClub: 'Sans club', timing: '2 rounds de 2 min · prolongation 1 min', kataPart: null, kata: null, noRest: false, held: false, early,
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

const kataItem = (number: number, kataPart: 'tour1' | 'finale', kata: NonNullable<QueueItem['kata']>): QueueItem => ({
  number, categoryId: 'k', categoryLabel: 'Kata Filles', matchId: kataPart === 'tour1' ? `kata:tour1:r${number}` : `kata:finale:${kata.position}`, a: null, b: null, aClub: null, bClub: null, timing: null, kataPart, kata,
  noRest: false, held: false, early: false,
});

test('combat : le club de chaque combattant, à l’appel et sur les lignes suivantes', () => {
  const html = render([item(1, false), item(2, false)]);
  expect(html.match(/Club A/g)).toHaveLength(2);
  expect(html.match(/Sans club/g)).toHaveLength(2);
});

test('kata à l’appel : une seule personne, pas de « Se prépare »', () => {
  const html = render([
    kataItem(1, 'tour1', { name: 'DURAND Léa', club: 'Club A', position: 1, total: 3, absent: false }),
    kataItem(2, 'tour1', { name: 'MARTIN Zoé', club: 'Club B', position: 2, total: 3, absent: false }),
  ]);
  expect(html.match(/data-testid="kata-current"/g)).toHaveLength(1);
  expect(html).not.toContain('Se prépare');
  expect(html).not.toContain('kata-lineup');
  expect(html).toContain('Kata Filles (tour 1)');
  expect(html).toContain('kataka 1 sur 3');
  expect(html).toContain('Club A');
  expect(html.indexOf('MARTIN Zoé')).toBeGreaterThan(html.indexOf('Ensuite'));
  expect(html.indexOf('DURAND Léa')).toBeLessThan(html.indexOf('Ensuite'));
});

test('finaliste absent tardif : « · absent » à l’appel et dans « Ensuite », passage conservé', () => {
  const html = render([
    kataItem(4, 'finale', { name: 'DURAND Léa', club: 'Club A', position: 1, total: 2, absent: true }),
    kataItem(5, 'finale', { name: 'MARTIN Zoé', club: 'Club B', position: 2, total: 2, absent: true }),
  ]);
  expect(html.match(/data-testid="kata-absent"/g)).toHaveLength(2);
  expect(html.slice(0, html.indexOf('Ensuite'))).toContain('absent');
  expect(html.slice(html.indexOf('Ensuite'))).toContain('absent');
  expect(render([kataItem(4, 'finale', { name: 'DURAND Léa', club: 'Club A', position: 1, total: 2, absent: false })])).not.toContain('absent');
});

test('finale aux finalistes inconnus : « Finaliste 1 », sans « kataka i sur n »', () => {
  const html = render([kataItem(4, 'finale', { name: null, club: null, position: 1, total: 2, absent: false }), kataItem(5, 'finale', { name: null, club: null, position: 2, total: 2, absent: false })]);
  expect(html).toContain('Finaliste 1');
  expect(html.slice(html.indexOf('Ensuite'))).toContain('Finaliste 2');
  expect(html).toContain('Kata Filles (finale)');
  expect(html).not.toContain('kataka 1 sur');
});

test('finale aux finalistes connus : nom et club, kataka suivant dans « Ensuite »', () => {
  const html = render([item(1, false), kataItem(2, 'finale', { name: 'DURAND Léa', club: 'Club A', position: 1, total: 2, absent: false })]);
  const next = html.slice(html.indexOf('Ensuite'));
  expect(next).toContain('DURAND Léa');
  expect(next).toContain('Club A');
  expect(next).toContain('Kata Filles (finale)');
});

test('durée du combat : à l’appel et dans « Ensuite », jamais pour un kata', () => {
  const html = render([item(1, false), item(2, false)]);
  expect(html.match(/data-testid="match-timing"/g)).toHaveLength(2);
  expect(html).toContain('2 rounds de 2 min · prolongation 1 min');
  expect(render([kataItem(1, 'tour1', { name: 'A', club: 'X', position: 1, total: 3, absent: false })])).not.toContain('match-timing');
});
