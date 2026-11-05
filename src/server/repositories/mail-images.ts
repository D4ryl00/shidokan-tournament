import { and, eq, lt, notInArray } from 'drizzle-orm';
import { detectImageType, MAIL_IMAGE_LIMITS, mailImageUrl } from '../../domain/mail-images.js';
import type { AppDb } from '../db/client.js';
import { mailImages } from '../db/schema.js';
import { cleanMailHtml } from '../mail-html.js';
import { getAppSettings } from './app-settings.js';

export class MailImageError extends Error {
  readonly statusCode = 400;
}

/** Délai avant qu'une image que plus aucun message ne cite soit effacée (le temps d'écrire un message avant de l'enregistrer). */
const ORPHAN_DELAY_MS = 24 * 3600 * 1000;

/** Enregistre une image (JPEG, PNG ou GIF, 2 Mo au plus) ; le type est reconnu à son contenu, jamais à ce que le client déclare. */
export function addMailImage(db: AppDb, data: Buffer): { id: string; url: string; size: number } {
  if (data.length === 0) throw new MailImageError('Aucune image reçue.');
  const contentType = detectImageType(data);
  if (!contentType) throw new MailImageError('Format d’image non accepté : JPEG, PNG ou GIF.');
  if (data.length > MAIL_IMAGE_LIMITS.fileBytes) throw new MailImageError('Image trop lourde : 2 Mo au plus.');
  const id = crypto.randomUUID();
  db.insert(mailImages).values({ id, contentType, size: data.length, data }).run();
  return { id, url: mailImageUrl(id), size: data.length };
}

export function readMailImage(db: AppDb, id: string): { contentType: string; data: Buffer } | null {
  const r = db.select({ contentType: mailImages.contentType, data: mailImages.data }).from(mailImages).where(eq(mailImages.id, id)).get();
  return r ?? null;
}

/**
 * Images citées par un message au format HTML : celui de l'application et celui de chaque compétition, y compris une compétition
 * gérée ailleurs ou purgée. Un message au format texte ne cite rien. C'est le corps filtré qui compte, comme pour le mail envoyé.
 */
export function referencedMailImageIds(db: AppDb): Set<string> {
  const ids = new Set<string>();
  const add = (mail: unknown) => {
    const m = mail as { format?: unknown; body?: unknown } | null | undefined;
    if (m && m.format === 'html' && typeof m.body === 'string') for (const id of cleanMailHtml(m.body).imageIds) ids.add(id);
  };
  add(getAppSettings(db).invitationMail);
  for (const { settingsJson } of db.$client.prepare('select settings_json as settingsJson from competitions').all() as { settingsJson: string }[]) {
    try {
      add((JSON.parse(settingsJson) as { invitationMail?: unknown } | null)?.invitationMail);
    } catch {
      // Réglages illisibles : cette compétition ne cite rien de lisible ; les autres comptent.
    }
  }
  return ids;
}

/** Efface les images créées il y a plus de 24 h que plus aucun message ne cite. Renvoie leur nombre. */
export function sweepMailImages(db: AppDb, now = new Date()): number {
  const cutoff = new Date(now.getTime() - ORPHAN_DELAY_MS).toISOString();
  // Citations lues et suppression faites dans la même transaction : un enregistrement ne s'intercale pas.
  return db.transaction((tx) => {
    const cited = [...referencedMailImageIds(db)];
    const old = lt(mailImages.createdAt, cutoff);
    return tx.delete(mailImages).where(cited.length ? and(old, notInArray(mailImages.id, cited)) : old).run().changes;
  });
}
