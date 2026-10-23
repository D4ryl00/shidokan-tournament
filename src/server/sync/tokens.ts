import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '../db/client.js';
import { syncTokens } from '../db/schema.js';
import { NotFoundError } from '../repositories/registrations.js';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Nouveau jeton de synchronisation (montré une seule fois). */
export function createSyncToken(db: AppDb, name: string): { id: string; name: string; token: string } {
  const token = randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  db.insert(syncTokens).values({ id, name: name.trim(), tokenHash: hash(token) }).run();
  return { id, name: name.trim(), token };
}

export function listSyncTokens(db: AppDb): { id: string; name: string; createdAt: string; lastUsedAt: string | null; revoked: boolean }[] {
  return db.select().from(syncTokens).orderBy(syncTokens.createdAt).all().map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, revoked: !!t.revokedAt }));
}

export function revokeSyncToken(db: AppDb, id: string): void {
  if (!db.update(syncTokens).set({ revokedAt: new Date().toISOString() }).where(eq(syncTokens.id, id)).run().changes) throw new NotFoundError('Jeton introuvable');
}

/** Vrai pour un en-tête `Bearer <jeton>` d'un jeton actif (sa dernière utilisation est notée). */
export function checkSyncToken(db: AppDb, authorization: string | undefined): boolean {
  const token = authorization?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!token) return false;
  const row = db.select().from(syncTokens).where(and(eq(syncTokens.tokenHash, hash(token)), isNull(syncTokens.revokedAt))).get();
  if (!row) return false;
  db.update(syncTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(syncTokens.id, row.id)).run();
  return true;
}
