import { MantineProvider } from '@mantine/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { KataView } from '../../src/web/components/BracketView.js';

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
