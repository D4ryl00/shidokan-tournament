import { MantineProvider, SegmentedControl } from '@mantine/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { FINALS_CONTROL } from '../../src/web/pages/FinalsPage.js';
import { theme } from '../../src/web/theme.js';

test('sélecteurs des finales : pastille pleine à la couleur de l’application, visible en clair comme en sombre', () => {
  const html = (props: object) =>
    renderToStaticMarkup(createElement(MantineProvider, { theme }, createElement(SegmentedControl, { ...props, value: 'a', data: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })));
  expect(html(FINALS_CONTROL)).toContain('--sc-color');
  expect(html({ size: 'xs' })).not.toContain('--sc-color');
});
