import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { detectImageType, MAIL_IMAGE_LIMITS, mailImageIdsIn, mailImageUrl, reducedSize } from '../../src/domain/mail-images.js';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { updateAppSettings } from '../../src/server/repositories/app-settings.js';
import { addMailImage, readMailImage, referencedMailImageIds, sweepMailImages } from '../../src/server/repositories/mail-images.js';
import { startRetention } from '../../src/server/repositories/retention.js';
import { buildPackage, unclassifiedTables } from '../../src/server/sync/package.js';
import { createCompetition } from '../../src/server/repositories/competitions.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb | null = null;
let app: FastifyInstance | null = null;
afterEach(async () => {
  if (db) closeDb(db);
  db = null;
  if (app) await app.close();
  app = null;
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-05T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const htmlMail = (body: string) => ({ subject: 'Invitation', body, format: 'html' as const });

test('limites : valeurs de la conception', () => {
  expect(MAIL_IMAGE_LIMITS).toMatchObject({ maxWidth: 1200, fileBytes: 2 * 1024 * 1024, perMessage: 10, widths: { small: 200, medium: 400, full: 600 } });
  expect(mailImageUrl(ID1)).toBe(`/api/mail-images/${ID1}`);
});

test('detectImageType : JPEG, PNG et GIF par leurs premiers octets ; SVG, WebP et texte renommé refusés', () => {
  expect(detectImageType(JPEG)).toBe('image/jpeg');
  expect(detectImageType(PNG)).toBe('image/png');
  expect(detectImageType(GIF)).toBe('image/gif');
  expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  expect(detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBeNull();
  expect(detectImageType(Buffer.from('affiche.png'))).toBeNull();
  expect(detectImageType(new Uint8Array(0))).toBeNull();
});

test('reducedSize : réduit à 1200 px de large en gardant les proportions, ne touche pas une image plus étroite', () => {
  expect(reducedSize(4000, 2000)).toEqual({ width: 1200, height: 600 });
  expect(reducedSize(800, 600)).toEqual({ width: 800, height: 600 });
  expect(reducedSize(1200, 900)).toEqual({ width: 1200, height: 900 });
});

test('mailImageIdsIn : seul l’attribut src d’une balise img compte (pas un alt qui contient « src= »)', () => {
  const trap = `<img alt=" src='/api/mail-images/${ID1}'" src="/api/mail-images/${ID2}">`;
  expect(mailImageIdsIn(trap)).toEqual([ID2]);
  expect(mailImageIdsIn(`<img alt="a > b" src='/api/mail-images/${ID1}'><img src=/api/mail-images/${ID2}><img src="/api/mail-images/${ID1}">`)).toEqual([ID1, ID2]);
  expect(mailImageIdsIn(`<p>/api/mail-images/${ID1}</p><img src="https://x.example/api/mail-images/${ID1}"><img data-src="/api/mail-images/${ID1}">`)).toEqual([]);
});

async function orgaApp() {
  app = await buildApp({ clubServices: true, dbPath: tmpDbPath() });
  return app;
}
const post = (a: FastifyInstance, payload: Buffer) => a.inject({ method: 'POST', url: '/api/mail-images', payload, headers: { 'content-type': 'application/octet-stream' } });

test('POST /api/mail-images : fichier vide, type inconnu et plus de 2 Mo refusés', async () => {
  const a = await orgaApp();
  expect((await post(a, Buffer.alloc(0))).statusCode).toBe(400);
  const unknown = await post(a, Buffer.from('<svg></svg>'));
  expect(unknown.statusCode).toBe(400);
  expect(unknown.json().error).toBe('Format d’image non accepté : JPEG, PNG ou GIF.');
  const big = await post(a, Buffer.concat([PNG, Buffer.alloc(MAIL_IMAGE_LIMITS.fileBytes)]));
  expect(big.statusCode).toBe(400);
  expect(big.json().error).toBe('Image trop lourde : 2 Mo au plus.');
});

test('un fichier correct revient par GET, avec nosniff', async () => {
  const a = await orgaApp();
  const created = await post(a, PNG);
  expect(created.statusCode).toBe(201);
  const { id, url, size } = created.json() as { id: string; url: string; size: number };
  expect(url).toBe(`/api/mail-images/${id}`);
  expect(size).toBe(PNG.length);
  const got = await a.inject({ method: 'GET', url });
  expect(got.statusCode).toBe(200);
  expect(got.headers['content-type']).toBe('image/png');
  expect(got.headers['x-content-type-options']).toBe('nosniff');
  expect(Buffer.from(got.rawPayload).equals(PNG)).toBe(true);
  expect((await a.inject({ method: 'GET', url: `/api/mail-images/${ID1}` })).statusCode).toBe(404);
});

test('POST /api/mail-html/check : le filtre retire un script et le dit', async () => {
  const a = await orgaApp();
  const res = await a.inject({ method: 'POST', url: '/api/mail-html/check', payload: { html: '<p>Bonjour</p><script>alert(1)</script>' } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ html: '<p>Bonjour</p>', removed: ['« script »'] });
});

test('sweepMailImages : sans citation, reste moins de 24 h, supprimée au-delà', () => {
  db = openDb(tmpDbPath());
  const fresh = addMailImage(db, PNG).id;
  const old = addMailImage(db, JPEG).id;
  db.$client.prepare('update mail_images set created_at = ? where id = ?').run(hoursAgo(25), old);
  db.$client.prepare('update mail_images set created_at = ? where id = ?').run(hoursAgo(23), fresh);
  expect(sweepMailImages(db, NOW)).toBe(1);
  expect(readMailImage(db, old)).toBeNull();
  expect(readMailImage(db, fresh)?.contentType).toBe('image/png');
});

test('sweepMailImages : une image citée par le message de l’application ou par une compétition reste, même gérée ailleurs ; le texte ne compte pas', async () => {
  db = openDb(tmpDbPath());
  const [inApp, inComp, inForeign, inText, free] = [PNG, JPEG, GIF, Buffer.concat([PNG, Buffer.from([9])]), Buffer.concat([PNG, Buffer.from([8])])].map((b) => addMailImage(db!, b).id);
  db.$client.prepare('update mail_images set created_at = ?').run(hoursAgo(48));
  const img = (id: string) => `<p><img src="/api/mail-images/${id}"></p>`;
  updateAppSettings(db, { invitationMail: htmlMail(img(inApp!)) } as never);
  const own = await createCompetition(db, { name: 'Coupe A', date: '2026-11-22' });
  const foreign = await createCompetition(db, { name: 'Open B', date: '2026-12-06' });
  const setMail = (id: string, mail: unknown) =>
    db!.$client.prepare('update competitions set settings_json = ? where id = ?').run(JSON.stringify({ invitationMail: mail }), id);
  setMail(own.id, htmlMail(img(inComp!)));
  setMail(foreign.id, htmlMail(img(inForeign!)));
  db.$client.prepare("update competitions set owner_instance_id = 'autre-pc', owner_name = 'PC de Lyon' where id = ?").run(foreign.id);
  // Message au format texte (sans format) d'une compétition qui contient l'adresse : ne compte pas.
  const textOnly = await createCompetition(db, { name: 'Gala C', date: '2027-01-10' });
  setMail(textOnly.id, { subject: 'x', body: `Voir /api/mail-images/${inText}` });
  expect([...referencedMailImageIds(db)].sort()).toEqual([inApp, inComp, inForeign].sort());
  expect(sweepMailImages(db, NOW)).toBe(2);
  for (const id of [inApp, inComp, inForeign]) expect(readMailImage(db, id!), id).not.toBeNull();
  for (const id of [inText, free]) expect(readMailImage(db, id!), id).toBeNull();
  // Retirée du message de l'application, reprise par une compétition : reste ; retirée de partout : supprimée.
  updateAppSettings(db, { invitationMail: htmlMail('<p>sans image</p>') } as never);
  expect(sweepMailImages(db, NOW)).toBe(1);
  expect(readMailImage(db, inApp!)).toBeNull();
  expect(readMailImage(db, inComp!)).not.toBeNull();
});

test('un message au format texte avec l’adresse d’une image ne la retient pas', () => {
  db = openDb(tmpDbPath());
  const id = addMailImage(db, PNG).id;
  updateAppSettings(db, { invitationMail: { subject: 'x', body: `<img src="/api/mail-images/${id}">` } } as never);
  expect(referencedMailImageIds(db).size).toBe(0);
});

test('démarrage : le nettoyage des images ne bloque pas la purge, et une panne est signalée', () => {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  const old = addMailImage(db, PNG).id;
  db.$client.prepare('update mail_images set created_at = ?').run(hoursAgo(48));
  const errors: unknown[] = [];
  startRetention(db, dbPath, (e) => errors.push(e))();
  expect(errors).toEqual([]);
  expect(readMailImage(db, old)).toBeNull();
  db.$client.exec('drop table mail_images');
  startRetention(db, dbPath, (e) => errors.push(e))();
  expect(errors).toHaveLength(1);
});

test('mail_images est classée (locale) : aucune table non classée, et pas dans un paquet de compétition', async () => {
  db = openDb(tmpDbPath());
  expect(unclassifiedTables(db)).toEqual([]);
  const c = await createCompetition(db, { name: 'Coupe', date: '2026-11-22' });
  expect(Object.keys(buildPackage(db, c.id, { handOver: false, role: 'local' }).tables)).not.toContain('mail_images');
});
