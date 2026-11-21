import { MantineProvider } from '@mantine/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { KataView } from '../../src/web/components/BracketView.js';
import type { PassageTime } from '../../src/domain/schedule/organiser-times.js';

const entrants = new Map(['r1', 'r2', 'r3'].map((id) => [id, { name: `Kataka ${id}`, club: 'Club' }]));
const renderKata = (numbers?: Map<string, number>) =>
  renderToStaticMarkup(createElement(MantineProvider, null, createElement(KataView as never, {
    category: {}, entrants, numbers, bracket: { kind: 'kata', order: ['r3', 'r1', 'r2'], entrants: ['r1', 'r2', 'r3'] },
  })));

test('feuille de kata : numéro de chaque kataka et de la finale', () => {
  const html = renderKata(new Map([['kata:tour1:r3', 14], ['kata:tour1:r1', 15], ['kata:tour1:r2', 16], ['kata:finale:1', 17], ['kata:finale:2', 18]]));
  expect(html.indexOf('n° 14')).toBeLessThan(html.indexOf('n° 15'));
  expect(html).toContain('n° 17 et 18');
});

test('feuille de kata sans numéros : le rang, pas de ligne finale', () => {
  const html = renderKata();
  expect(html).not.toContain('n° ');
  expect(html).not.toContain('kata-finale-numbers');
});

const renderWithTimes = (times: (matchId: string) => PassageTime | null, printable = false, kataScores?: object) =>
  renderToStaticMarkup(createElement(MantineProvider, null, createElement(KataView as never, {
    category: {}, entrants, times, printable, kataScores, bracket: { kind: 'kata', order: ['r3', 'r1', 'r2'], entrants: ['r1', 'r2', 'r3'] },
  })));

test('colonne « Heure » : seulement quand un kataka a une heure ou une note', () => {
  const none = renderWithTimes(() => null);
  expect(none).not.toContain('Heure');
  expect(none).not.toContain('<thead');
  expect(none).not.toContain('passage-time');
  const one = renderWithTimes((k) => (k === 'kata:tour1:r1' ? { kind: 'at', clock: '10:42', planned: false } : null));
  expect(one).toContain('<thead');
  expect(one).toContain('Heure');
  expect(one).toMatch(/data-testid="passage-time"[^>]*>vers 10:42</);
});

test('colonne « Heure » : jamais à l’impression', () => {
  const html = renderWithTimes(() => ({ kind: 'at', clock: '10:42', planned: false }), true);
  expect(html).not.toContain('Heure');
  expect(html).not.toContain('passage-time');
});
