import { afterEach, expect, test, vi } from 'vitest';
import { MAX_PDF_PAGES, UnreadablePdfError, extractPdfLines } from '../../src/server/ffk-pdf-text.js';
import { buildFfkPdf } from '../helpers/ffk-pdf.js';

afterEach(() => vi.restoreAllMocks());

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

test('refuse un fichier qui n’est pas un PDF, avec la cause', async () => {
  const error = await extractPdfLines(new TextEncoder().encode('bonjour')).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UnreadablePdfError);
  expect((error as UnreadablePdfError).message).toBe('Ce fichier n’est pas un PDF lisible.');
  expect((error as UnreadablePdfError).cause).toBeInstanceOf(Error);
});

test(`refuse un PDF de plus de ${MAX_PDF_PAGES} pages`, async () => {
  // Une page de couverture, puis un combattant par page : 52 pages.
  const fighters = Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => `NOM${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} LEO`);
  const pdf = await buildFfkPdf({ competition: 'Coupe Test - Combats', entity: '0000001 DOJO TEST', rowsPerPage: 1, categories: [{ title: 'Senior Masculin -75 KG', fighters }] });
  const error = await extractPdfLines(pdf).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UnreadablePdfError);
  expect((error as UnreadablePdfError).message).toBe('Ce PDF a trop de pages pour un état des inscriptions d’un club.');
  expect((error as UnreadablePdfError).statusCode).toBe(400);
});

test('pdfjs trouve ses polices standard : pas d’avertissement à la lecture', async () => {
  const log = vi.spyOn(console, 'log');
  const warn = vi.spyOn(console, 'warn');
  const pdf = await buildFfkPdf({ competition: 'Coupe Test - Combats', entity: '0000001 DOJO TEST', categories: [{ title: 'Poussin Masculin -25 KG', fighters: ['DURAND LEO'] }] });
  await extractPdfLines(pdf);
  const said = [...log.mock.calls, ...warn.mock.calls].flat().map(String).join('\n');
  expect(said).not.toContain('standardFontDataUrl');
});
