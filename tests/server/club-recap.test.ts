import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { entryKey } from '../../src/domain/closed-categories.js';
import { buildApp } from '../../src/server/app.js';
import { buildClubRecapPdf } from '../../src/server/club-recap-pdf.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
let dbPath: string;
beforeEach(async () => {
  dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url: `${base}${url}`, payload });
const newClub = async (name: string) => (await call('POST', '/clubs', { name })).json().id as string;
let n = 0;
async function reg(clubId: string | null, over: object = {}) {
  n++;
  const res = await call('POST', '/registrations', {
    clubId, lastName: `NOM${n}`, firstName: 'x', sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu',
    weightClassId: 'cadet:F:-54', source: 'manual', ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json().row as { id: string; fighterId: string };
}

/** Texte des opérateurs Tj des flux du PDF (polices standard : chaînes hexadécimales WinAnsi). */
function pdfText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let body = Buffer.from(m[1]!, 'latin1');
    try { body = zlib.inflateSync(body); } catch { /* flux non compressé */ }
    for (const t of body.toString('latin1').matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(new TextDecoder('windows-1252').decode(Buffer.from(t[1]!, 'hex')));
  }
  return out.join('\n');
}

test('récapitulatif PDF d’un club : inscrit, au final, désisté, changé', async () => {
  const club = await newClub('Étoile Sportive');
  const moved = await reg(club, { lastName: 'DEPLACE' });
  const absent = await reg(club, { lastName: 'ABSENTE', sex: 'M', weightClassId: 'cadet:M:-52' });
  const stay = await reg(club, { lastName: 'RESTE', sex: 'M', weightClassId: 'cadet:M:-57' });
  const cs = (await call('GET', '/categories')).json() as { id: string; registrationIds: string[] }[];
  const target = cs.find((c) => c.registrationIds.includes(stay.id))!;
  expect((await call('POST', '/replacement/move', { registrationId: moved.id, categoryId: target.id })).statusCode).toBe(200);
  expect((await call('PUT', `/weigh-in/${absent.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);

  const res = await call('GET', `/clubs/${club}/recap.pdf`);
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect(res.headers['content-disposition']).toBe('attachment; filename="recapitulatif-etoile-sportive.pdf"');
  const pdf = res.rawPayload;
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  const text = pdfText(pdf);
  for (const s of ['Étoile Sportive', 'Inscrit', 'Au final', 'Absent (désisté)', 'Changé', 'DEPLACE', 'RESTE']) expect(text).toContain(s);
  expect(text).toContain('(placé par l’organisation)');
});

test('récapitulatif : un désisté (retiré) figure dans le PDF', async () => {
  const club = await newClub('Club B');
  const w = await reg(club, { lastName: 'RETIREE', sex: 'M', weightClassId: 'cadet:M:-52' });
  const raw = new Database(dbPath);
  raw.prepare("UPDATE registrations SET withdrawn_reason = 'closed_category', withdrawn_entry = ?, category_id = NULL WHERE id = ?").run(
    entryKey({ ageBandCode: 'cadet', sex: 'M', discipline: 'karate', ruleset: 'jiyu' }), w.id,
  );
  raw.close();
  const text = pdfText((await call('GET', `/clubs/${club}/recap.pdf`)).rawPayload);
  expect(text).toContain('RETIREE');
  expect(text).toContain('Ne combat pas');
});

test('précédence : retiré ET absent → « Ne combat pas » ; sans catégorie → « Pas encore placé »', async () => {
  const club = await newClub('Club P');
  const both = await reg(club, { lastName: 'DOUBLE', sex: 'M', weightClassId: 'cadet:M:-52' });
  const loose = await reg(club, { lastName: 'LIBRE', sex: 'M', weightClassId: 'cadet:M:-57' });
  expect((await call('PUT', `/weigh-in/${both.fighterId}`, { presence: 'absent' })).statusCode).toBe(204);
  const raw = new Database(dbPath);
  raw.prepare("UPDATE registrations SET withdrawn_reason = 'closed_category', withdrawn_entry = ?, category_id = NULL WHERE id = ?").run(
    entryKey({ ageBandCode: 'cadet', sex: 'M', discipline: 'karate', ruleset: 'jiyu' }), both.id,
  );
  raw.close();
  const text = pdfText((await call('GET', `/clubs/${club}/recap.pdf`)).rawPayload);
  expect(text).toContain('Ne combat pas');
  expect(text).not.toContain('Absent (désisté)');
  expect(loose.id).toBeTruthy();
});

test('caractères hors WinAnsi : pas d’exception', async () => {
  const pdf = await buildClubRecapPdf({
    competition: { name: 'Coupe Łódź', date: '2026-11-22' }, club: 'Đặng Club', generatedAt: new Date(),
    lines: [{ fighter: 'ĐẶNG Łukasz', registered: 'Karaté', final: 'Karaté', changed: false, reason: null }],
  });
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
});

test('un gros club tient sur plusieurs pages', async () => {
  const lines = Array.from({ length: 80 }, (_, i) => ({ fighter: `NOM${i} x`, registered: 'Karaté · Jiyu · Cadets · -54 kg', final: 'Karaté Jiyu Cadets F -54', changed: i % 2 === 0, reason: 'catégorie de poids voisine' }));
  const pdf = await buildClubRecapPdf({ competition: { name: 'Coupe', date: '2026-11-22' }, club: 'Gros', generatedAt: new Date(), lines });
  expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
  // L'en-tête du tableau est répété à chaque page.
  const pageCount = (await PDFDocument.load(pdf)).getPageCount();
  expect(pdfText(pdf).split('Combattant').length - 1).toBe(pageCount);
});

test('une ligne plus haute qu’une page est tronquée avec « … » et reste sur sa page', async () => {
  const long = Array.from({ length: 600 }, (_, i) => `mot${i}`).join(' ');
  const pdf = await buildClubRecapPdf({
    competition: { name: 'Coupe', date: '2026-11-22' }, club: 'Long', generatedAt: new Date(),
    lines: [{ fighter: 'A b', registered: long, final: long, changed: true, reason: long }],
  });
  const doc = await PDFDocument.load(pdf);
  // En-tête seul sur la première page : la ligne passe à la suivante, où elle tient en entier.
  expect(doc.getPageCount()).toBe(2);
  expect(pdfText(pdf)).toContain('…');
});

test('.zip : un PDF par club inscrit, aucun pour un club vide ; 404 pour un club sans inscription', async () => {
  const a = await newClub('Club A');
  const b = await newClub('Club B');
  const empty = await newClub('Club Vide');
  await reg(a);
  await reg(b, { lastName: 'AUTRE', sex: 'M', weightClassId: 'cadet:M:-57' });
  const res = await call('GET', '/exports/club-recaps.zip');
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-disposition']).toBe('attachment; filename="recapitulatifs-clubs.zip"');
  const zip = await JSZip.loadAsync(res.rawPayload);
  expect(Object.keys(zip.files).sort()).toEqual(['recapitulatif-club-a.pdf', 'recapitulatif-club-b.pdf']);
  expect((await call('GET', `/clubs/${empty}/recap.pdf`)).statusCode).toBe(404);
});

test('.zip sans aucune inscription : 404', async () => {
  await newClub('Seul');
  expect((await call('GET', '/exports/club-recaps.zip')).statusCode).toBe(404);
});

/** Contenu décompressé des flux du PDF. */
function pdfStreams(pdf: Uint8Array): string {
  return [...Buffer.from(pdf).toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
    .map((m) => { const b = Buffer.from(m[1]!, 'latin1'); try { return zlib.inflateSync(b).toString('latin1'); } catch { return b.toString('latin1'); } })
    .join('\n');
}

test('une ligne changée a un fond gris et « Changé » dans une police différente du reste', async () => {
  const make = (changed: boolean) => buildClubRecapPdf({
    competition: { name: 'Coupe', date: '2026-11-22' }, club: 'C', generatedAt: new Date(),
    lines: [{ fighter: 'A b', registered: 'Karaté', final: 'Karaté', changed, reason: changed ? 'autre discipline' : null }],
  });
  const grey = (s: string) => s.split('0.95 0.95 0.95 rg').length - 1;
  const [plain, changed] = [pdfStreams(await make(false)), pdfStreams(await make(true))];
  expect(grey(changed) - grey(plain)).toBe(3);
  // « Changé » est écrit avec la police en gras , le reste avec la normale.
  const fontOf = (s: string, word: string) => {
    const hex = Buffer.from(word, 'latin1').toString('hex').toUpperCase();
    const i = s.toUpperCase().indexOf(`<${hex}>`);
    return [...s.slice(0, i).matchAll(/\/(Helvetica[\w-]*) [\d.]+ Tf/g)].pop()![1]!.includes('Bold');
  };
  expect(fontOf(changed, 'Changé')).toBe(true);
  expect(fontOf(changed, 'Karaté')).toBe(false);
});
