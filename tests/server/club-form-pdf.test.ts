import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { entryCells } from '../../src/domain/closed-categories.js';
import { ffkDefaultGrid } from '../../src/domain/grid-ffk.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe Shidokan', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

/** Texte des opérateurs Tj des flux du PDF (polices standard : chaînes hexadécimales WinAnsi). */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let body = Buffer.from(m[1]!, 'latin1');
    try { body = zlib.inflateSync(body); } catch { /* flux non compressé */ }
    for (const t of body.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(new TextDecoder('windows-1252').decode(Buffer.from(t[1]!, 'hex')));
  }
  return out.join('\n');
}
const pages = async (pdf: Buffer) => (await PDFDocument.load(pdf)).getPageCount();

async function offerAll(over: (code: string) => boolean) {
  const cells = entryCells(ffkDefaultGrid()).filter((c) => !over(c.ageBandCode));
  expect((await app.inject({ method: 'PUT', url: `${base}/closed-categories`, payload: { cells, closed: true } })).statusCode).toBe(204);
}

test('fiche papier PDF : téléchargement, une page A4 paysage, logo, tranches proposées', async () => {
  await offerAll((c) => c !== 'mini-poussin' && c !== 'espoir');
  const res = await app.inject({ method: 'GET', url: `${base}/club-form.pdf` });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect(res.headers['content-disposition']).toContain('attachment; filename="fiche-club-2026-11-22.pdf"');
  const pdf = res.rawPayload;
  expect(await pages(pdf)).toBe(1);
  const size = (await PDFDocument.load(pdf)).getPage(0).getSize();
  expect([Math.round(size.width), Math.round(size.height)]).toEqual([842, 595]);
  expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  const text = pdfText(pdf);
  expect(text).toContain('FICHE DE PRÉ-INSCRIPTION');
  expect(text).toContain('Coupe Shidokan — dimanche 22 novembre 2026');
  expect(text).toContain('Pu');
  expect(text).not.toContain('MP');
  expect(text).toContain('Page …… / ……');
});

test('fiche papier PDF : nom long, lieu, 15 tranches → toujours une page, lieu présent', async () => {
  await app.inject({ method: 'PATCH', url: base, payload: { name: 'Coupe Shidokan de la Côte d’Azur et des Alpes-Maritimes — édition spéciale 2026', location: 'Gymnase municipal Jean Médecin, Nice' } });
  const grid = (await app.inject({ method: 'GET', url: `${base}/grid` })).json();
  grid.ageBands.push({ code: 'mini2', label: 'Minimes 2', minAge: 12, maxAge: 13, isMinor: true, sortOrder: 99 });
  await app.inject({ method: 'PUT', url: `${base}/grid`, payload: grid });
  const pdf = (await app.inject({ method: 'GET', url: `${base}/club-form.pdf` })).rawPayload;
  expect(await pages(pdf)).toBe(1);
  expect(pdfText(pdf)).toContain('Jean Médecin, Nice');
});

test('encadré des catégories non ouvertes, une seule page', async () => {
  await app.inject({ method: 'PUT', url: `${base}/closed-categories`, payload: { cells: [{ ageBandCode: 'senior', sex: 'F', discipline: 'kata', ruleset: null }], closed: true } });
  let pdf = (await app.inject({ method: 'GET', url: `${base}/club-form.pdf` })).rawPayload;
  expect(pdfText(pdf).replace(/\s+/g, ' ')).toContain('Non ouvert à cette compétition : Seniors (F) : pas de Kata');
  expect(await pages(pdf)).toBe(1);
  await offerAll((c) => !['mini-poussin', 'poussin', 'pupille', 'v3', 'v4', 'v5'].includes(c));
  pdf = (await app.inject({ method: 'GET', url: `${base}/club-form.pdf` })).rawPayload;
  expect(await pages(pdf)).toBe(1);
});
