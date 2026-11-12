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
  number, categoryId: 'c', categoryLabel: 'Cadets -60 kg', matchId: `m${number}`, a: 'A', b: 'B', katakas: null, kataPart: null, noRest: false, held: false, early,
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
