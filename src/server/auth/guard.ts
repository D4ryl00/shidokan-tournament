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

/** Routes ouvertes sans connexion (motifs des routes de Fastify, pas les adresses brutes). */
const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/me', '/api/auth/login']);
const isPublicRoute = (route: string) =>
  PUBLIC_ROUTES.has(route) || route === '/api/inscription/:token' || route.startsWith('/api/inscription/:token/') || route.startsWith('/api/sync/remote/'); // ouvertes par leur jeton
const TOO_MANY = { error: 'Trop de requêtes : réessayez dans quelques minutes.' };

/** Chemin décodé (`/%61pi` → `/api`), barres répétées réduites ; null si l'encodage est invalide. */
function decodedPath(url: string): string | null {
  try {
    return decodeURIComponent(url.split('?')[0]!).replace(/\/{2,}/g, '/');
  } catch {
    return null;
  }
}

/**
 * Rôle serveur : écritures d'une autre origine refusées, nombre de requêtes limité (pages des clubs, connexion),
 * et connexion obligatoire pour toute route /api qui n'est pas publique. La décision porte sur la route réellement trouvée
 * par Fastify (qui décode l'adresse) et, en plus, sur l'adresse décodée : `/%61pi/…` ne contourne rien.
 * Rôle local : aucun contrôle (comme avant).
 */
export function registerGuard(app: FastifyInstance, db: AppDb, role: InstanceRole): void {
  app.decorateRequest('user', null);
  if (role !== 'serveur') return;
  const clubPages = new RateLimiter(300, 10 * 60 * 1000);
  const logins = new RateLimiter(10, 15 * 60 * 1000);
  const loginsPerAccount = new RateLimiter(30, 60 * 60 * 1000);
  const syncCalls = new RateLimiter(120, 10 * 60 * 1000);
  app.addHook('onRequest', async (req, reply) => {
    const path = decodedPath(req.url);
    if (path === null) return reply.status(400).send({ error: 'Adresse invalide.' });
    const route = req.routeOptions.url ?? path;
    const api = route.startsWith('/api/') || path.startsWith('/api/') || path === '/api';
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let host: string | null = null;
      try {
        host = new URL(req.headers.origin).host;
      } catch {
        host = null;
      }
      if (host !== req.headers.host) return reply.status(403).send({ error: 'Origine refusée.' });
    }
    if ((route.startsWith('/api/inscription/') || path.startsWith('/api/inscription/')) && !clubPages.hit(req.ip)) return reply.status(429).send(TOO_MANY);
    if ((route.startsWith('/api/sync/remote/') || path.startsWith('/api/sync/remote/')) && !syncCalls.hit(req.ip)) return reply.status(429).send(TOO_MANY);
    if ((route === '/api/auth/login' || path === '/api/auth/login') && req.method === 'POST' && !logins.hit(req.ip)) return reply.status(429).send(TOO_MANY);
    const token = cookieValue(req, SESSION_COOKIE);
    req.user = token ? sessionUser(db, token) : null;
    if (api && !req.user && !isPublicRoute(route)) {
      return reply.status(401).send({ error: 'Connexion requise.' });
    }
  });
  // Essais par compte, en plus des essais par adresse : la cible d'une attaque répartie est aussi protégée.
  app.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.url !== '/api/auth/login' || req.method !== 'POST') return;
    const email = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof email === 'string' && !loginsPerAccount.hit(email.trim().toLowerCase())) return reply.status(429).send(TOO_MANY);
  });
}
