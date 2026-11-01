import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { createCompetition } from '../../src/server/repositories/competitions.js';
import {
  addMailAttachment,
  AttachmentError,
  attachmentDir,
  deleteMailAttachment,
  listMailAttachments,
  readMailAttachment,
  setMailAttachmentIncluded,
  sweepAttachmentFiles,
} from '../../src/server/repositories/mail-attachments.js';
import { NotFoundError } from '../../src/server/repositories/registrations.js';
import { buildPackage, unclassifiedTables } from '../../src/server/sync/package.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb | null = null;
let app: FastifyInstance | null = null;
afterEach(async () => {
  if (db) closeDb(db);
  db = null;
  if (app) await app.close();
  app = null;
});

const PDF = Buffer.from('%PDF-1.4 règlement');

async function setup() {
  const dbPath = tmpDbPath();
  db = openDb(dbPath);
  const c = await createCompetition(db, { name: 'Coupe 2026', date: '2026-11-22', location: 'Nice' });
  return { dbPath, d: db, id: c.id };
}

test('ajout : nom gardé, coché, contenu dans le dossier pieces-jointes sous son id ; liste dans l’ordre d’ajout', async () => {
  const { dbPath, d, id } = await setup();
  const a = await addMailAttachment(d, dbPath, id, 'Règlement "2026".pdf', PDF);
  expect(a).toMatchObject({ fileName: 'Règlement "2026".pdf', contentType: 'application/pdf', size: PDF.length, included: true, missing: false });
  expect(attachmentDir(dbPath)).toBe(path.join(path.dirname(path.resolve(dbPath)), 'pieces-jointes'));
  expect(fs.readFileSync(path.join(attachmentDir(dbPath), a.id))).toEqual(PDF);
  const b = await addMailAttachment(d, dbPath, id, 'C:\\affiche.png', Buffer.from('png'));
  expect(b.fileName).toBe('affiche.png');
  expect(listMailAttachments(d, dbPath, id).map((x) => x.fileName)).toEqual(['Règlement "2026".pdf', 'affiche.png']);
  expect(fs.readdirSync(attachmentDir(dbPath)).sort()).toEqual([a.id, b.id].sort());
});

test('refus : type, nom d’une fiche club ; rien n’est écrit', async () => {
  const { dbPath, d, id } = await setup();
  await expect(addMailAttachment(d, dbPath, id, 'x.exe', PDF)).rejects.toThrow(AttachmentError);
  await expect(addMailAttachment(d, dbPath, id, 'x.exe', PDF)).rejects.toThrow('Type de fichier non accepté : .exe');
  await expect(addMailAttachment(d, dbPath, id, 'Fiche-club-2026-11-22.pdf', PDF)).rejects.toThrow('Une pièce jointe porte déjà ce nom.');
  expect(listMailAttachments(d, dbPath, id)).toEqual([]);
});

test('décocher, fichier manquant, supprimer ; autre compétition introuvable', async () => {
  const { dbPath, d, id } = await setup();
  const a = await addMailAttachment(d, dbPath, id, 'reglement.pdf', PDF);
  setMailAttachmentIncluded(d, id, a.id, false);
  expect(listMailAttachments(d, dbPath, id)[0]!.included).toBe(false);
  expect(readMailAttachment(d, dbPath, id, a.id).data).toEqual(PDF);
  const other = await createCompetition(d, { name: 'Autre coupe', date: '2026-12-01', location: null });
  expect(() => readMailAttachment(d, dbPath, other.id, a.id)).toThrow(NotFoundError);
  expect(() => setMailAttachmentIncluded(d, other.id, a.id, true)).toThrow(NotFoundError);
  expect(() => deleteMailAttachment(d, dbPath, other.id, a.id)).toThrow(NotFoundError);
  fs.rmSync(path.join(attachmentDir(dbPath), a.id));
  expect(listMailAttachments(d, dbPath, id)[0]!.missing).toBe(true);
  expect(() => readMailAttachment(d, dbPath, id, a.id)).toThrow(NotFoundError);
  deleteMailAttachment(d, dbPath, id, a.id);
  expect(listMailAttachments(d, dbPath, id)).toEqual([]);
  const b = await addMailAttachment(d, dbPath, id, 'affiche.png', PDF);
  deleteMailAttachment(d, dbPath, id, b.id);
  expect(fs.existsSync(path.join(attachmentDir(dbPath), b.id))).toBe(false);
});

test('balayage : fichiers sans ligne (et .tmp) effacés, les autres gardés ; dossier absent : 0', async () => {
  const { dbPath, d, id } = await setup();
  expect(sweepAttachmentFiles(d, dbPath)).toBe(0);
  const a = await addMailAttachment(d, dbPath, id, 'reglement.pdf', PDF);
  fs.writeFileSync(path.join(attachmentDir(dbPath), 'orphelin'), 'x');
  fs.writeFileSync(path.join(attachmentDir(dbPath), 'x.tmp'), 'x');
  expect(sweepAttachmentFiles(d, dbPath)).toBe(2);
  expect(fs.readdirSync(attachmentDir(dbPath))).toEqual([a.id]);
});

test('fichier manquant ajouté de nouveau sous le même nom (casse ignorée) : même pièce, même case, même place, nouveau contenu', async () => {
  const { dbPath, d, id } = await setup();
  const a = await addMailAttachment(d, dbPath, id, 'reglement.pdf', PDF);
  const b = await addMailAttachment(d, dbPath, id, 'affiche.png', PDF);
  setMailAttachmentIncluded(d, id, a.id, false);
  fs.rmSync(path.join(attachmentDir(dbPath), a.id));
  const fresh = Buffer.from('%PDF-1.4 nouveau règlement');
  const again = await addMailAttachment(d, dbPath, id, 'Reglement.PDF', fresh);
  expect(again).toMatchObject({ id: a.id, fileName: 'Reglement.PDF', size: fresh.length, included: false, missing: false });
  expect(listMailAttachments(d, dbPath, id).map((x) => x.id)).toEqual([a.id, b.id]);
  expect(readMailAttachment(d, dbPath, id, a.id).data).toEqual(fresh);
  // Présent : toujours refusé.
  await expect(addMailAttachment(d, dbPath, id, 'affiche.png', PDF)).rejects.toThrow('Une pièce jointe porte déjà ce nom.');
});

test('fichier manquant remplacé : les limites comptent le nouveau fichier à sa place (10 pièces dont une manquante → accepté)', async () => {
  const { dbPath, d, id } = await setup();
  const all = [];
  for (let i = 0; i < 10; i++) all.push(await addMailAttachment(d, dbPath, id, `f${i}.pdf`, PDF));
  fs.rmSync(path.join(attachmentDir(dbPath), all[3]!.id));
  expect((await addMailAttachment(d, dbPath, id, 'f3.pdf', PDF)).id).toBe(all[3]!.id);
  await expect(addMailAttachment(d, dbPath, id, 'f10.pdf', PDF)).rejects.toThrow('Au plus 10 pièces jointes.');
});

test('balayage : un fichier impossible à effacer est laissé, sans erreur (le démarrage ne doit pas échouer)', async () => {
  const { dbPath, d } = await setup();
  fs.mkdirSync(attachmentDir(dbPath), { recursive: true });
  fs.writeFileSync(path.join(attachmentDir(dbPath), 'orphelin'), 'x');
  fs.chmodSync(attachmentDir(dbPath), 0o500);
  try {
    expect(sweepAttachmentFiles(d, dbPath)).toBe(0);
  } finally {
    fs.chmodSync(attachmentDir(dbPath), 0o700);
  }
  expect(sweepAttachmentFiles(d, dbPath)).toBe(1);
});

test('table propre à l’installation : classée, absente du paquet', async () => {
  const { d, id } = await setup();
  expect(unclassifiedTables(d)).toEqual([]);
  expect(Object.keys(buildPackage(d, id, { handOver: false, role: 'local' }).tables)).not.toContain('mail_attachments');
});

/** Ajoute une pièce par une seconde connexion à la base de l'application en marche. */
async function addThroughSecondConnection(dbPath: string, competitionId: string, name: string) {
  const other = openDb(dbPath);
  try {
    return await addMailAttachment(other, dbPath, competitionId, name, PDF);
  } finally {
    closeDb(other);
  }
}

test('suppression d’une compétition : ses fichiers sont effacés du dossier', async () => {
  const dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  const id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe à supprimer', date: '2026-11-22' } })).json().id as string;
  const a = await addThroughSecondConnection(dbPath, id, 'reglement.pdf');
  expect((await app.inject({ method: 'DELETE', url: `/api/competitions/${id}`, payload: { name: 'Coupe à supprimer' } })).statusCode).toBe(204);
  expect(fs.existsSync(path.join(attachmentDir(dbPath), a.id))).toBe(false);
});

test('restauration d’une sauvegarde d’avant l’ajout : le fichier devenu orphelin est effacé', async () => {
  const dbPath = tmpDbPath();
  app = await buildApp({ dbPath });
  const id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe restaurée', date: '2026-11-22' } })).json().id as string;
  const snapshot = (await app.inject({ method: 'GET', url: '/api/backup.sqlite' })).rawPayload;
  const a = await addThroughSecondConnection(dbPath, id, 'reglement.pdf');
  const res = await app.inject({ method: 'POST', url: '/api/restore', payload: snapshot, headers: { 'content-type': 'application/octet-stream' } });
  expect(res.statusCode).toBe(204);
  expect(fs.existsSync(path.join(attachmentDir(dbPath), a.id))).toBe(false);
});

test('démarrage : fichier orphelin effacé', async () => {
  const dbPath = tmpDbPath();
  closeDb(openDb(dbPath));
  fs.mkdirSync(attachmentDir(dbPath), { recursive: true });
  fs.writeFileSync(path.join(attachmentDir(dbPath), 'orphelin'), 'x');
  app = await buildApp({ dbPath });
  expect(fs.readdirSync(attachmentDir(dbPath))).toEqual([]);
});
