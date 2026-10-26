import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { cookieValue, SESSION_COOKIE, type InstanceRole } from '../auth/guard.js';
import type { AppDb } from '../db/client.js';
import { clubDirectory } from '../db/schema.js';
import { GMAIL_SEND_SCOPE, type GoogleClient } from '../google/client.js';
import { getAppSettings, setGoogleContactsState, setGoogleSender } from '../repositories/app-settings.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const back = (result: 'connecte' | 'annule' | 'envoi-refuse' | 'expire' | 'erreur' | 'session') => `/parametres?google=${result}#mails`;

/** Session de la requête (empreinte du cookie), ou null sans session (PC de la compétition). */
const sessionOf = (req: FastifyRequest) => {
  const cookie = cookieValue(req, SESSION_COOKIE);
  return cookie ? createHash('sha256').update(cookie).digest('base64url') : null;
};

/** Retours attendus de Google : à usage unique, liés à la session qui a cliqué, valables 10 minutes. */
class OAuthStates {
  private readonly states = new Map<string, { session: string | null; expiresAt: number }>();
  create(session: string | null): string {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expiresAt <= now) this.states.delete(k);
    const state = randomBytes(32).toString('base64url');
    this.states.set(state, { session, expiresAt: now + STATE_TTL_MS });
    return state;
  }
  take(state: string | undefined, session: string | null): boolean {
    const entry = state ? this.states.get(state) : undefined;
    if (!entry) return false;
    this.states.delete(state!);
    return entry.expiresAt > Date.now() && entry.session === session;
  }
}

/**
 * « Se connecter avec Google » : départ vers Google et retour, seulement si Google est configuré ; « Déconnecter » toujours (un compte
 * peut rester enregistré après le retrait de la configuration).
 */
export async function googleRoutes(app: FastifyInstance, { db, google, role }: { db: AppDb; google: GoogleClient | null; role: InstanceRole }) {
  app.post('/api/app-settings/google/disconnect', async () => {
    const { google: sender } = getAppSettings(db);
    const revoked = sender ? (google ? await google.revoke(sender.refreshToken) : false) : true;
    setGoogleSender(db, null, 'smtp');
    return { revoked };
  });
  if (!google) return;
  const states = new OAuthStates();

  app.post('/api/app-settings/google/start', async (req) => ({ url: google.authUrl(states.create(sessionOf(req))) }));

  // Route publique (voir guard.ts) : sans session, retour sur les Réglages, qui demandent de se connecter.
  app.get('/api/app-settings/google/callback', async (req, reply) => {
    if (role === 'serveur' && !req.user) return reply.redirect(back('session'));
    const q = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }).parse(req.query);
    if (!states.take(q.state, sessionOf(req))) return reply.redirect(back('expire'));
    if (q.error || !q.code) return reply.redirect(back('annule'));
    let granted: Awaited<ReturnType<GoogleClient['exchangeCode']>>;
    try {
      granted = await google.exchangeCode(q.code);
    } catch (e) {
      // Ni le code ni les jetons dans le journal : seulement le motif.
      req.log.error({ reason: e instanceof Error ? e.message : 'inconnu' }, 'Connexion à Google impossible');
      return reply.redirect(back('erreur'));
    }
    const current = getAppSettings(db);
    // Révoquer chez Google retire toute l'autorisation du compte : jamais celle du compte déjà connecté.
    const sameAccount = current.google?.email === granted.email;
    if (!granted.scopes.includes(GMAIL_SEND_SCOPE)) {
      if (!sameAccount) void google.revoke(granted.refreshToken);
      return reply.redirect(back('envoi-refuse'));
    }
    const fromName = current.google?.fromName ?? current.smtp?.fromName ?? 'Shidokan France';
    const sender = { email: granted.email, fromName, refreshToken: granted.refreshToken, status: 'ok' as const, lastRefreshAt: new Date().toISOString(), scopes: granted.scopes };
    const knownAccount = current.googleContacts.account;
    db.transaction((tx) => {
      const t = tx as unknown as AppDb;
      // Reconnexion : le mode d'envoi choisi est gardé ; première connexion (ou après « Déconnecter ») : Google.
      setGoogleSender(t, sender, current.google ? current.mailMode : 'google');
      // Autre compte Google : les liens faits avec les contacts de l'ancien compte n'ont plus de sens.
      if (knownAccount !== null && knownAccount !== granted.email) {
        t.update(clubDirectory).set({ googleContactId: null }).run();
        setGoogleContactsState(t, { pending: [] });
      }
      setGoogleContactsState(t, { account: granted.email });
    });
    if (current.google && !sameAccount) void google.revoke(current.google.refreshToken);
    return reply.redirect(back('connecte'));
  });
}
