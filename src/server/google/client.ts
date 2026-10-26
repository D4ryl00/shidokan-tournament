import { CONTACTS_SCOPE } from '../../domain/app-settings.js';
import type { ContactLabel, GoogleContact } from '../../domain/google-contacts.js';

/**
 * Compte Google expéditeur : autorisation OAuth 2.0 (application Web), renouvellement du jeton d'accès, révocation, et envoi d'un
 * message MIME par l'API Gmail. Seul droit demandé sur la boîte : envoyer (`gmail.send`), jamais lire. Les contacts ne sont lus qu'en lecture seule (API People).
 */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GOOGLE_SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE, CONTACTS_SCOPE] as const;

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
const LABELS_URL = 'https://people.googleapis.com/v1/contactGroups?groupFields=name,groupType&pageSize=1000';
const CONTACTS_URL = 'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,memberships&pageSize=1000';
export const GOOGLE_CALLBACK_PATH = '/api/app-settings/google/callback';

/** Google a retiré l'accès (réponse `invalid_grant`) : il faut se reconnecter. */
export class GoogleAccessRevokedError extends Error {}

/** L'API People répond 403 : le droit de lire les contacts n'a pas été accordé. */
export class ContactsScopeMissingError extends Error {}

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
  /** Libellés créés par l'utilisateur (pas ceux du système), triés par nom. */
  listContactLabels(refreshToken: string): Promise<ContactLabel[]>;
  /** Tous les contacts (toutes les pages). */
  listContacts(refreshToken: string): Promise<GoogleContact[]>;
}

interface PeopleEntry { value?: string; displayName?: string; name?: string; metadata?: { primary?: boolean } }
interface Person {
  resourceName?: string;
  names?: PeopleEntry[];
  emailAddresses?: PeopleEntry[];
  phoneNumbers?: PeopleEntry[];
  organizations?: PeopleEntry[];
  memberships?: { contactGroupMembership?: { contactGroupResourceName?: string } }[];
}

/** Valeur marquée principale, sinon la première renseignée. */
function primary(entries: PeopleEntry[] | undefined, field: (x: PeopleEntry) => string | undefined): string | null {
  const filled = (entries ?? []).filter((x) => field(x)?.trim());
  const e = filled.find((x) => x.metadata?.primary) ?? filled[0];
  return e ? field(e)!.trim() : null;
}

function toContact(p: Person): GoogleContact {
  return {
    resourceName: p.resourceName!,
    name: primary(p.names, (e) => e.displayName),
    email: primary(p.emailAddresses, (e) => e.value),
    phone: primary(p.phoneNumbers, (e) => e.value),
    organization: primary(p.organizations, (e) => e.name),
    groups: (p.memberships ?? []).map((m) => m.contactGroupMembership?.contactGroupResourceName).filter((g): g is string => !!g),
  };
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

  /**
   * Appel avec jeton d'accès. Jeton expiré ou retiré : un renouvellement forcé (qui lève si l'accès a été retiré), puis un second
   * essai. Un second 401 avec un jeton neuf n'est pas un retrait d'accès (Google vient de renouveler) : réponse ordinaire.
   */
  async function authorized(refreshToken: string, call: (access: string) => Promise<Response>): Promise<Response> {
    const res = await call(await accessToken(refreshToken));
    return res.status === 401 ? call(await accessToken(refreshToken, { force: true })) : res;
  }

  /** Lit toutes les pages d'une liste de l'API People. */
  async function people<T>(refreshToken: string, url: string, key: string): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const res = await authorized(refreshToken, (access) => http(pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url, { headers: { authorization: `Bearer ${access}` } }));
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; nextPageToken?: string } & Record<string, unknown>;
      if (res.status === 403) throw new ContactsScopeMissingError(body.error?.message ?? 'forbidden');
      if (!res.ok) throw new Error(`Google a refusé la lecture des contacts (${res.status}) : ${body.error?.message ?? 'réponse inattendue'}`);
      items.push(...((body[key] as T[] | undefined) ?? []));
      pageToken = body.nextPageToken || undefined;
    } while (pageToken);
    return items;
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
      const res = await authorized(refreshToken, (access) => send(access, mime));
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(`Gmail a refusé l’envoi (${res.status}) : ${body.error?.message ?? 'réponse inattendue'}`);
      }
    },
    async listContactLabels(refreshToken) {
      const groups = await people<{ resourceName?: string; name?: string; groupType?: string }>(refreshToken, LABELS_URL, 'contactGroups');
      return groups
        .filter((g) => g.groupType === 'USER_CONTACT_GROUP' && g.resourceName)
        .map((g) => ({ resourceName: g.resourceName!, name: g.name ?? '' }))
        .sort((x, y) => x.name.localeCompare(y.name, 'fr'));
    },
    async listContacts(refreshToken) {
      return (await people<Person>(refreshToken, CONTACTS_URL, 'connections')).filter((p) => p.resourceName).map(toContact);
    },
  };
}
