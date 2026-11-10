import { expect, test } from 'vitest';
import { UnreadablePdfError, extractPdfLines } from '../../src/server/ffk-pdf-text.js';
import { buildFfkPdf } from '../helpers/ffk-pdf.js';

test('lit les lignes d’un PDF fabriqué', async () => {
  const pdf = await buildFfkPdf({
    competition: 'Coupe Test - Combats',
    entity: '0000001 DOJO TEST',
    categories: [{ title: 'Poussin Masculin -25 KG', status: 'Inscrits', fighters: ['DURAND LEO'] }],
  });
  const lines = await extractPdfLines(pdf);
  const fighterLine = lines.find((l) => l.items.some((i) => i.text === 'DURAND LEO'));
  expect(fighterLine).toBeDefined();
  const name = fighterLine!.items.find((i) => i.text === 'DURAND LEO')!;
  expect(Math.abs(name.x - 120)).toBeLessThanOrEqual(2);
  expect(fighterLine!.items.length).toBeGreaterThan(1);
  expect(fighterLine!.items[0]!.text).toMatch(/^1000000/);
  expect(lines.some((l) => l.items.map((i) => i.text).join(' ') === 'Poussin Masculin -25 KG')).toBe(true);
});

test('refuse un fichier qui n’est pas un PDF', async () => {
  await expect(extractPdfLines(new TextEncoder().encode('bonjour'))).rejects.toBeInstanceOf(UnreadablePdfError);
});
