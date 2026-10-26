/**
 * Compte Google expéditeur : autorisation OAuth 2.0 (application Web), renouvellement du jeton d'accès, révocation, et envoi d'un
 * message MIME par l'API Gmail. Seul droit demandé sur la boîte : envoyer (`gmail.send`), jamais lire.
 */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GOOGLE_SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE] as const;

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
export const GOOGLE_CALLBACK_PATH = '/api/app-settings/google/callback';

/** Google a retiré l'accès (réponse `invalid_grant`) : il faut se reconnecter. */
export class GoogleAccessRevokedError extends Error {}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof fetch;
}

export interface GoogleClient {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<{ refreshToken: string; email: string; scopes: string[] }>;
  /** Jeton d'accès, gardé en mémoire jusqu'à une minute avant son expiration ; `force` en demande un nouveau. */
  accessToken(refreshToken: string, opts?: { force?: boolean }): Promise<string>;
  /** Vrai si Google a confirmé ; faux si Google ou le réseau a échoué (ne lève jamais). */
  revoke(token: string): Promise<boolean>;
  sendRaw(refreshToken: string, mime: Buffer): Promise<void>;
}

/** Configuration complète, ou null s'il manque l'ID client, le code secret ou l'adresse publique. */
export function googleConfigFrom(o: { clientId?: string; clientSecret?: string; publicUrl?: string; fetch?: typeof fetch }): GoogleConfig | null {
  if (!o.clientId || !o.clientSecret || !o.publicUrl) return null;
  return { clientId: o.clientId, clientSecret: o.clientSecret, redirectUri: `${o.publicUrl.replace(/\/+$/, '')}${GOOGLE_CALLBACK_PATH}`, fetch: o.fetch };
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

/** Adresse lue dans l'id_token, reçu directement de Google en HTTPS (sa signature n'a pas besoin d'être vérifiée). */
function emailOf(idToken: string | undefined): string {
  const payload = idToken?.split('.')[1];
  const email = payload ? (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown }).email : undefined;
  if (typeof email !== 'string' || !email) throw new Error('Google n’a pas indiqué l’adresse du compte.');
  return email;
}

export function googleClient(config: GoogleConfig): GoogleClient {
  const http = config.fetch ?? fetch;
  const cache = new Map<string, { token: string; expiresAt: number }>();

  async function token(fields: Record<string, string>): Promise<TokenResponse> {
    const res = await http(TOKEN_URL, form({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }));
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    if (body.error === 'invalid_grant') throw new GoogleAccessRevokedError(body.error_description ?? 'invalid_grant');
    if (!res.ok || !body.access_token) throw new Error(`Google a refusé la demande (${res.status}) : ${body.error_description ?? body.error ?? 'réponse inattendue'}`);
    return body;
  }

  async function accessToken(refreshToken: string, opts: { force?: boolean } = {}): Promise<string> {
    const cached = cache.get(refreshToken);
    if (cached && !opts.force && cached.expiresAt > Date.now()) return cached.token;
    const body = await token({ grant_type: 'refresh_token', refresh_token: refreshToken });
    cache.set(refreshToken, { token: body.access_token!, expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 });
    return body.access_token!;
  }

  async function send(access: string, mime: Buffer): Promise<Response> {
    return http(SEND_URL, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'message/rfc822' }, body: new Uint8Array(mime) });
  }

  return {
    authUrl(state) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      return `${AUTHORIZE_URL}?${params}`;
    },
    async exchangeCode(code) {
      const body = await token({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri });
      if (!body.refresh_token) throw new Error('Google n’a pas donné de jeton de renouvellement.');
      return { refreshToken: body.refresh_token, email: emailOf(body.id_token), scopes: (body.scope ?? '').split(' ').filter(Boolean) };
    },
    accessToken,
    async revoke(t) {
      try {
        return (await http(REVOKE_URL, form({ token: t }))).ok;
      } catch {
        return false;
      }
    },
    async sendRaw(refreshToken, mime) {
      let res = await send(await accessToken(refreshToken), mime);
      // Jeton d'accès expiré ou retiré : un renouvellement (qui lève si l'accès a été retiré), puis un second essai. Un second 401
      // avec un jeton neuf n'est pas un retrait d'accès (Google vient de renouveler) : erreur ordinaire.
      if (res.status === 401) res = await send(await accessToken(refreshToken, { force: true }), mime);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(`Gmail a refusé l’envoi (${res.status}) : ${body.error?.message ?? 'réponse inattendue'}`);
      }
    },
  };
}
