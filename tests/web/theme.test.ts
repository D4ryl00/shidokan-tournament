import { expect, test } from 'vitest';
import { TOKENS } from '../../src/web/theme.js';

/** Luminance relative et contraste (WCAG 2). */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test('les deux thèmes ont les mêmes jetons, aucun vide', () => {
  expect(Object.keys(TOKENS.dark).sort()).toEqual(Object.keys(TOKENS.light).sort());
  for (const theme of [TOKENS.dark, TOKENS.light]) for (const v of Object.values(theme)) expect(v.trim()).not.toBe('');
});

test('valeurs de la conception', () => {
  expect(TOKENS.dark.bg).toBe('#141118');
  expect(TOKENS.light.bg).toBe('#f7f5f9');
  expect(TOKENS.dark.accent).toBe('#c17ad3');
  expect(TOKENS.light.accent).toBe('#722f82');
});

test('contraste lisible (≥ 4,5:1) dans les deux thèmes', () => {
  for (const [name, t] of Object.entries(TOKENS)) {
    const pairs: [string, string, string][] = [
      ['text/bg', t.text, t.bg], ['text/card', t.text, t.card], ['soft/bg', t.soft, t.bg], ['soft/card', t.soft, t.card],
      // Texte discret (--mantine-color-dimmed) : phrases d'aide, résumés, indications.
      ['muted/bg', t.muted, t.bg], ['muted/card', t.muted, t.card], ['muted/row', t.muted, t.row],
      ['onAccent/accent', t.onAccent, t.accent], ['okText/ok', t.okText, t.ok], ['warnText/warn', t.warnText, t.warn], ['chipText/chip', t.chipText, t.chip],
    ];
    for (const [pair, fg, bg] of pairs) expect(contrast(fg, bg), `${name} ${pair}`).toBeGreaterThanOrEqual(4.5);
  }
});
