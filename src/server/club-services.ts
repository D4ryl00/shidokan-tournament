import type { FastifyInstance } from 'fastify';
import { SERVER_ONLY } from '../domain/app-settings.js';

/** Chemins réservés au serveur en ligne : mails aux clubs, pièces jointes, inscriptions en ligne, images du message, compte Google. */
const CLUB_SERVICES_PATHS = [
  /^\/api\/competitions\/[^/]+\/(invitations|mail-attachments|club-entry)(\/|$)/,
  /^\/api\/inscription(\/|$)/,
  /^\/api\/mail-images(\/|$)/,
  /^\/api\/mail-html(\/|$)/,
  /^\/api\/app-settings\/(test-mail|google)(\/|$)/,
  /^\/api\/club-directory\/google(\/|$)/,
];

/** Chemin décodé (`/%69nscription` → `/inscription`), barres répétées réduites ; null si l'encodage est invalide (Fastify répond alors lui-même). */
function decodedPath(url: string): string | null {
  try {
    return decodeURIComponent(url.split('?')[0]!).replace(/\/{2,}/g, '/');
  } catch {
    return null;
  }
}

/**
 * Sur un PC, ces chemins répondent 403 `SERVER_ONLY`, quelle que soit la méthode (y compris HEAD et OPTIONS) et que la route existe ou non.
 * Un crochet `onRequest` enregistré en premier : le refus passe avant la connexion, la garde de lecture seule et le contrôle de la compétition.
 */
export function registerClubServicesRefusal(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    const path = decodedPath(req.url);
    if (path !== null && CLUB_SERVICES_PATHS.some((p) => p.test(path))) return reply.status(403).send({ error: SERVER_ONLY });
  });
}
