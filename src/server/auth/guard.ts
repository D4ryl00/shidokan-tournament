import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDb } from '../db/client.js';
import { sessionUser, type SessionUser } from './sessions.js';

export type InstanceRole = 'serveur' | 'local';
export const roleFromEnv = (v: string | undefined): InstanceRole => (v === 'serveur' ? 'serveur' : 'local');
export const SESSION_COOKIE = 'shidokan_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/** Nombre de requêtes limité par clé (adresse IP) sur une fenêtre glissante, en mémoire. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  /** Vrai si la requête passe ; faux au-delà de la limite. */
  hit(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return true;
  }
}

export function cookieValue(req: FastifyRequest, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

const PUBLIC = [/^\/api\/health$/, /^\/api\/auth\/me$/, /^\/api\/auth\/login$/, /^\/api\/inscription(\/|$)/];
const TOO_MANY = { error: 'Trop de requêtes : réessayez dans quelques minutes.' };

/**
 * Rôle serveur : écritures d'une autre origine refusées, nombre de requêtes limité (pages des clubs, connexion),
 * et connexion obligatoire pour toute route /api qui n'est pas publique. Rôle local : aucun contrôle (comme avant).
 */
export function registerGuard(app: FastifyInstance, db: AppDb, role: InstanceRole): void {
  app.decorateRequest('user', null);
  if (role !== 'serveur') return;
  const clubPages = new RateLimiter(300, 10 * 60 * 1000);
  const logins = new RateLimiter(10, 15 * 60 * 1000);
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let host: string | null = null;
      try {
        host = new URL(req.headers.origin).host;
      } catch {
        host = null;
      }
      if (host !== req.headers.host) return reply.status(403).send({ error: 'Origine refusée.' });
    }
    if (path.startsWith('/api/inscription/') && !clubPages.hit(req.ip)) return reply.status(429).send(TOO_MANY);
    if (path === '/api/auth/login' && req.method === 'POST' && !logins.hit(req.ip)) return reply.status(429).send(TOO_MANY);
    const token = cookieValue(req, SESSION_COOKIE);
    req.user = token ? sessionUser(db, token) : null;
    if (path.startsWith('/api/') && !PUBLIC.some((p) => p.test(path)) && !req.user) return reply.status(401).send({ error: 'Connexion requise.' });
  });
}
