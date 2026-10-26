import type { FastifyServerOptions } from 'fastify';

/**
 * Masque le jeton des liens personnels des clubs (`/inscription/<jeton>`) : seule son empreinte est gardée, pas même dans le journal.
 * Masque aussi la requête du retour de Google (code d'autorisation, state).
 */
export const redactTokens = (url: string): string =>
  url.replace(/(\/inscription\/)[^/?#]+/, '$1***').replace(/(\/api\/app-settings\/google\/callback\?).*/, '$1***');

/** Journal du serveur : requêtes sans jeton de lien personnel. */
export function loggerOptions(enabled: boolean): FastifyServerOptions['logger'] {
  if (!enabled) return false;
  return {
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, url: redactTokens(req.url) }),
    },
  };
}
