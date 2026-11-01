import fs from 'node:fs';
import path from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { attachmentContentType, checkNewAttachment, cleanAttachmentName, clubFormFileNames, replacedMissing } from '../../domain/mail-attachments.js';
import type { AppDb } from '../db/client.js';
import { mailAttachments } from '../db/schema.js';
import { getCompetition } from './competitions.js';
import { NotFoundError } from './registrations.js';

/** Pièce jointe ajoutée au mail aux clubs, sans son contenu ; `missing` : le fichier n'est plus dans le dossier. */
export interface MailAttachmentInfo {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  included: boolean;
  createdAt: string;
  missing: boolean;
}

export class AttachmentError extends Error {
  readonly statusCode = 400;
}

const NOT_FOUND = 'Pièce jointe introuvable';

/** Dossier des pièces jointes, à côté de la base (comme `sauvegardes/`). */
export const attachmentDir = (dbPath: string): string => path.join(path.dirname(path.resolve(dbPath)), 'pieces-jointes');
const fileOf = (dbPath: string, id: string) => path.join(attachmentDir(dbPath), id);

type Row = typeof mailAttachments.$inferSelect;
const infoOf = (dbPath: string, r: Row): MailAttachmentInfo => ({
  id: r.id,
  fileName: r.fileName,
  contentType: r.contentType,
  size: r.size,
  included: r.included,
  createdAt: r.createdAt,
  missing: !fs.existsSync(fileOf(dbPath, r.id)),
});

function rowOf(db: AppDb, competitionId: string, id: string): Row {
  const r = db.select().from(mailAttachments).where(and(eq(mailAttachments.id, id), eq(mailAttachments.competitionId, competitionId))).get();
  if (!r) throw new NotFoundError(NOT_FOUND);
  return r;
}

/** Pièces jointes ajoutées à la compétition, dans l'ordre d'ajout. */
export function listMailAttachments(db: AppDb, dbPath: string, competitionId: string): MailAttachmentInfo[] {
  return db
    .select()
    .from(mailAttachments)
    .where(eq(mailAttachments.competitionId, competitionId))
    .orderBy(asc(mailAttachments.createdAt), asc(sql`rowid`))
    .all()
    .map((r) => infoOf(dbPath, r));
}

/** Ajoute un fichier (coché) : nom nettoyé et vérifié, contenu écrit dans le dossier puis ligne créée. */
export async function addMailAttachment(db: AppDb, dbPath: string, competitionId: string, rawName: string, data: Buffer): Promise<MailAttachmentInfo> {
  const competition = await getCompetition(db, competitionId);
  if (!competition) throw new NotFoundError('Compétition introuvable');
  const fileName = cleanAttachmentName(rawName);
  const forms = clubFormFileNames(competition.date);
  const existing = db
    .select({ id: mailAttachments.id, fileName: mailAttachments.fileName, size: mailAttachments.size })
    .from(mailAttachments)
    .where(eq(mailAttachments.competitionId, competitionId))
    .all()
    .map((r) => ({ ...r, missing: !fs.existsSync(fileOf(dbPath, r.id)) }));
  const refusal = checkNewAttachment({ fileName, size: data.length }, existing, [forms.pdf, forms.ods]);
  if (refusal) throw new AttachmentError(refusal);
  // Fichier manquant du même nom (après une restauration…) : le nouveau contenu reprend sa ligne, sa case et sa place.
  const replaced = replacedMissing(fileName, existing);
  const id = replaced?.id ?? crypto.randomUUID();
  fs.mkdirSync(attachmentDir(dbPath), { recursive: true });
  const tmp = `${fileOf(dbPath, id)}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, fileOf(dbPath, id));
  const contentType = attachmentContentType(fileName)!;
  try {
    if (replaced) db.update(mailAttachments).set({ fileName, contentType, size: data.length }).where(eq(mailAttachments.id, id)).run();
    else db.insert(mailAttachments).values({ id, competitionId, fileName, contentType, size: data.length }).run();
  } catch (e) {
    fs.rmSync(fileOf(dbPath, id), { force: true });
    throw e;
  }
  return infoOf(dbPath, rowOf(db, competitionId, id));
}

/** Une pièce jointe et son contenu ; introuvable si la ligne n'est pas de cette compétition ou si le fichier manque. */
export function readMailAttachment(db: AppDb, dbPath: string, competitionId: string, id: string): { info: MailAttachmentInfo; data: Buffer } {
  const info = infoOf(dbPath, rowOf(db, competitionId, id));
  if (info.missing) throw new NotFoundError(NOT_FOUND);
  return { info, data: fs.readFileSync(fileOf(dbPath, id)) };
}

export function setMailAttachmentIncluded(db: AppDb, competitionId: string, id: string, included: boolean): void {
  rowOf(db, competitionId, id);
  db.update(mailAttachments).set({ included }).where(eq(mailAttachments.id, id)).run();
}

/** Supprime la ligne puis le fichier (déjà absent : toléré). */
export function deleteMailAttachment(db: AppDb, dbPath: string, competitionId: string, id: string): void {
  rowOf(db, competitionId, id);
  db.delete(mailAttachments).where(eq(mailAttachments.id, id)).run();
  fs.rmSync(fileOf(dbPath, id), { force: true });
}

/**
 * Efface du dossier les fichiers qui n'ont plus de ligne (pièce ou compétition supprimée, purge, restauration d'une sauvegarde plus
 * ancienne, écriture interrompue `.tmp`). Renvoie le nombre de fichiers effacés ; ceux qu'on ne peut pas effacer restent.
 */
export function sweepAttachmentFiles(db: AppDb, dbPath: string): number {
  const dir = attachmentDir(dbPath);
  if (!fs.existsSync(dir)) return 0;
  const known = new Set(db.select({ id: mailAttachments.id }).from(mailAttachments).all().map((r) => r.id));
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (known.has(name)) continue;
    // Un fichier qu'on ne peut pas effacer (droits, fichier verrouillé) reste : un nettoyage ne doit jamais empêcher l'application de démarrer.
    try {
      fs.rmSync(path.join(dir, name), { force: true, recursive: true });
      removed++;
    } catch {
      // essayé de nouveau au prochain balayage
    }
  }
  return removed;
}
