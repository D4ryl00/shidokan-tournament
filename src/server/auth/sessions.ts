import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppDb } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { hashPassword, MIN_PASSWORD, verifyPassword } from './passwords.js';

export interface SessionUser {
  id: string;
  email: string;
  role: 'organisateur';
}

const DAY = 24 * 3600 * 1000;
export const SESSION_DAYS = 30;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function createUser(db: AppDb, email: string, password: string): SessionUser {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (password.length < MIN_PASSWORD) throw new HttpError(400, `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`);
  if (db.select().from(users).where(eq(users.email, normalized)).get()) throw new HttpError(409, 'Ce compte existe déjà.');
  const id = crypto.randomUUID();
  db.insert(users).values({ id, email: normalized, passwordHash: hashPassword(password) }).run();
  return { id, email: normalized, role: 'organisateur' };
}

export function listUsers(db: AppDb): { id: string; email: string; createdAt: string }[] {
  return db.select({ id: users.id, email: users.email, createdAt: users.createdAt }).from(users).orderBy(users.email).all();
}

export function findUserByEmail(db: AppDb, email: string) {
  return db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
}

export function deleteUser(db: AppDb, id: string): void {
  if (!db.delete(users).where(eq(users.id, id)).run().changes) throw new HttpError(404, 'Compte introuvable.');
}

/** Change le mot de passe et ferme toutes les autres sessions du compte (un cookie volé ne sert plus). */
export function changePassword(db: AppDb, userId: string, current: string, next: string, keepToken: string | null = null): void {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !verifyPassword(current, user.passwordHash)) throw new HttpError(400, 'Mot de passe actuel incorrect.');
  if (next.length < MIN_PASSWORD) throw new HttpError(400, `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`);
  db.update(users).set({ passwordHash: hashPassword(next) }).where(eq(users.id, userId)).run();
  const keep = keepToken ? hash(keepToken) : null;
  for (const s of db.select().from(sessions).where(eq(sessions.userId, userId)).all()) {
    if (s.tokenHash !== keep) db.delete(sessions).where(eq(sessions.id, s.id)).run();
  }
}

/** Nouvelle session : renvoie le jeton du cookie (seule son empreinte est gardée). */
export function createSession(db: AppDb, userId: string, now = new Date()): string {
  const token = randomBytes(32).toString('base64url');
  db.insert(sessions)
    .values({ id: crypto.randomUUID(), userId, tokenHash: hash(token), expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY).toISOString(), lastSeenAt: now.toISOString() })
    .run();
  return token;
}

/** Compte d'une session valide ; une session expirée est supprimée. L'expiration glisse (au plus une mise à jour par heure). */
export function sessionUser(db: AppDb, token: string, now = new Date()): SessionUser | null {
  const row = db.select().from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.tokenHash, hash(token))).get();
  if (!row) return null;
  if (row.sessions.expiresAt <= now.toISOString()) {
    db.delete(sessions).where(eq(sessions.id, row.sessions.id)).run();
    return null;
  }
  if (now.getTime() - new Date(row.sessions.lastSeenAt).getTime() > 3600 * 1000) {
    db.update(sessions)
      .set({ lastSeenAt: now.toISOString(), expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY).toISOString() })
      .where(eq(sessions.id, row.sessions.id))
      .run();
  }
  return { id: row.users.id, email: row.users.email, role: row.users.role };
}

export function deleteSession(db: AppDb, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hash(token))).run();
}
