import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
let base: string;
beforeEach(async () => {
  app = await buildApp({ clubServices: true, dbPath: tmpDbPath() });
  base = `/api/competitions/${(await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe 2026', date: '2026-11-22' } })).json().id}`;
});
afterEach(async () => app.close());

const PDF = Buffer.from('%PDF-1.4 règlement');
const upload = (name: string | null, data: Buffer = PDF, url = `${base}/mail-attachments`) =>
  app.inject({
    method: 'POST',
    url,
    payload: data,
    headers: { 'content-type': 'application/octet-stream', ...(name === null ? {} : { 'x-file-name': encodeURIComponent(name) }) },
  });

test('ajout, liste, téléchargement sous le nom exact, décocher, supprimer', async () => {
  const res = await upload('Règlement "2026".pdf');
  expect(res.statusCode).toBe(201);
  const a = res.json();
  expect(a).toMatchObject({ fileName: 'Règlement "2026".pdf', contentType: 'application/pdf', size: PDF.length, included: true, missing: false });
  expect((await app.inject({ method: 'GET', url: `${base}/mail-attachments` })).json().map((x: { id: string }) => x.id)).toEqual([a.id]);
  const file = await app.inject({ method: 'GET', url: `${base}/mail-attachments/${a.id}` });
  expect(file.statusCode).toBe(200);
  expect(file.rawPayload).toEqual(PDF);
  expect(file.headers['content-type']).toBe('application/pdf');
  expect(file.headers['content-disposition']).toBe(`attachment; filename="R_glement _2026_.pdf"; filename*=UTF-8''R%C3%A8glement%20%222026%22.pdf`);
  expect(file.headers['x-content-type-options']).toBe('nosniff');
  expect((await app.inject({ method: 'PATCH', url: `${base}/mail-attachments/${a.id}`, payload: { included: false } })).statusCode).toBe(204);
  expect((await app.inject({ method: 'GET', url: `${base}/mail-attachments` })).json()[0].included).toBe(false);
  expect((await app.inject({ method: 'PATCH', url: `${base}/mail-attachments/${a.id}`, payload: { included: 'non' } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'DELETE', url: `${base}/mail-attachments/${a.id}` })).statusCode).toBe(204);
  expect((await app.inject({ method: 'GET', url: `${base}/mail-attachments/${a.id}` })).statusCode).toBe(404);
  expect((await app.inject({ method: 'DELETE', url: `${base}/mail-attachments/${a.id}` })).statusCode).toBe(404);
});

test('refus : sans nom, type, trop gros (au-delà de la limite de la route), compétition inconnue', async () => {
  const noName = await upload(null);
  expect(noName.statusCode).toBe(400);
  expect(noName.json().error).toBe('Nom de fichier manquant.');
  const exe = await upload('virus.exe');
  expect(exe.statusCode).toBe(400);
  expect(exe.json().error).toBe('Type de fichier non accepté : .exe (acceptés : PDF, images, documents, tableurs, présentations, texte)');
  const big = await upload('gros.pdf', Buffer.alloc(10 * 1024 * 1024 + 100));
  expect(big.statusCode).toBe(400);
  expect(big.json().error).toBe('Fichier trop gros : 10 Mo au plus.');
  expect((await upload('enorme.pdf', Buffer.alloc(12 * 1024 * 1024))).statusCode).toBe(413);
  expect((await upload('a.pdf', PDF, '/api/competitions/inconnue/mail-attachments')).statusCode).toBe(404);
  expect((await app.inject({ method: 'GET', url: '/api/competitions/inconnue/mail-attachments' })).statusCode).toBe(404);
});
