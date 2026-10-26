import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { GMAIL_SEND_SCOPE, type GoogleClient } from '../google/client.js';
import { getAppSettings, setGoogleSender } from '../repositories/app-settings.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const back = (result: 'connecte' | 'annule' | 'envoi-refuse' | 'expire' | 'erreur') => `/parametres?google=${result}#mails`;

/** Retours attendus de Google : à usage unique, liés à la session qui a cliqué, valables 10 minutes. */
class OAuthStates {
  private readonly states = new Map<string, { userId: string | null; expiresAt: number }>();
  create(userId: string | null): string {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expiresAt <= now) this.states.delete(k);
    const state = randomBytes(32).toString('base64url');
    this.states.set(state, { userId, expiresAt: now + STATE_TTL_MS });
    return state;
  }
  take(state: string | undefined, userId: string | null): boolean {
    const entry = state ? this.states.get(state) : undefined;
    if (!entry) return false;
    this.states.delete(state!);
    return entry.expiresAt > Date.now() && entry.userId === userId;
  }
}

/** « Se connecter avec Google » : départ vers Google, retour, déconnexion. Enregistrées seulement si Google est configuré. */
export async function googleRoutes(app: FastifyInstance, { db, google }: { db: AppDb; google: GoogleClient }) {
  const states = new OAuthStates();

  app.post('/api/app-settings/google/start', async (req) => ({ url: google.authUrl(states.create(req.user?.id ?? null)) }));

  app.get('/api/app-settings/google/callback', async (req, reply) => {
    const q = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }).parse(req.query);
    if (!states.take(q.state, req.user?.id ?? null)) return reply.redirect(back('expire'));
    if (q.error || !q.code) return reply.redirect(back('annule'));
    let granted: Awaited<ReturnType<GoogleClient['exchangeCode']>>;
    try {
      granted = await google.exchangeCode(q.code);
    } catch (e) {
      // Ni le code ni les jetons dans le journal : seulement le motif.
      req.log.error({ reason: e instanceof Error ? e.message : String(e) }, 'Connexion à Google impossible');
      return reply.redirect(back('erreur'));
    }
    if (!granted.scopes.includes(GMAIL_SEND_SCOPE)) {
      void google.revoke(granted.refreshToken);
      return reply.redirect(back('envoi-refuse'));
    }
    const current = getAppSettings(db);
    const fromName = current.google?.fromName ?? current.smtp?.fromName ?? 'Shidokan France';
    setGoogleSender(db, { email: granted.email, fromName, refreshToken: granted.refreshToken, status: 'ok', lastRefreshAt: new Date().toISOString() }, 'google');
    if (current.google && current.google.refreshToken !== granted.refreshToken) void google.revoke(current.google.refreshToken);
    return reply.redirect(back('connecte'));
  });

  app.post('/api/app-settings/google/disconnect', async () => {
    const { google: sender } = getAppSettings(db);
    const revoked = sender ? await google.revoke(sender.refreshToken) : true;
    setGoogleSender(db, null, 'smtp');
    return { revoked };
  });
}
