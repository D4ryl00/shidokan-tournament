import { CONTACTS_SCOPE } from '../../src/domain/app-settings.js';
import type { ContactLabel, GoogleContact } from '../../src/domain/google-contacts.js';

// Faux Google des tests : jetons, révocation, envoi Gmail et API People, aiguillés selon l'adresse appelée.
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface FakeGoogle {
  fetch: typeof fetch;
  /** Adresse du compte qui se connecte. */
  email: string;
  /** Autorisations accordées à l'échange du code (Google permet d'en décocher). */
  grantedScopes: string[];
  /** Après ce nombre de mails envoyés, l'accès est retiré (null = jamais). */
  revokeAfterSends: number | null;
  /** Le prochain envoi reçoit 401 (jeton d'accès expiré). */
  expireAccessOnce: boolean;
  /** Le jeton d'accès expire quand ce nombre de mails est atteint (une fois). */
  expireAccessAfterSends: number | null;
  /** La révocation échoue. */
  revokeFails: boolean;
  /** Le réseau est coupé (fetch lève). */
  networkDown: boolean;
  /** Google ne renvoie pas de jeton de renouvellement. */
  noRefreshToken: boolean;
  /** Gmail refuse tout jeton d'accès (401), même neuf, alors que le renouvellement fonctionne (panne passagère). */
  rejectAllSends: boolean;
  /** Erreur renvoyée par Gmail à l'envoi. */
  sendError: { status: number; message: string } | null;
  /** Erreur renvoyée par l'API People (par exemple API non activée : 403 SERVICE_DISABLED). */
  peopleError: { status: number; message: string; reason: string } | null;
  /** Contacts et libellés servis par l'API People (pages de 2). */
  contacts: GoogleContact[];
  labels: ContactLabel[];
  sent: Buffer[];
  sendHeaders: Headers[];
  revoked: string[];
  refreshCount: number;
  /** Corps des demandes faites au point d'échange des jetons. */
  tokenRequests: URLSearchParams[];
}

export function fakeGoogle(): FakeGoogle {
  let n = 0;
  const access = new Set<string>();
  // Comme chez Google : révoquer un jeton retire toute l'autorisation du compte (tous ses jetons).
  const accountOf = new Map<string, string>();
  const fake: FakeGoogle = {
    email: 'orga@gmail.com',
    grantedScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send', CONTACTS_SCOPE],
    revokeAfterSends: null,
    expireAccessOnce: false,
    expireAccessAfterSends: null,
    revokeFails: false,
    networkDown: false,
    noRefreshToken: false,
    sendError: null,
    peopleError: null,
    rejectAllSends: false,
    contacts: [],
    labels: [],
    sent: [],
    sendHeaders: [],
    revoked: [],
    refreshCount: 0,
    tokenRequests: [],
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      if (fake.networkDown) throw new TypeError('fetch failed');
      const url = String(input instanceof Request ? input.url : input);
      const accessRevoked = () => fake.revokeAfterSends !== null && fake.sent.length >= fake.revokeAfterSends;
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const body = new URLSearchParams(String(init?.body));
        fake.tokenRequests.push(body);
        const accessToken = `at-${++n}`;
        if (body.get('grant_type') === 'authorization_code') {
          access.add(accessToken);
          accountOf.set(`rt-${n}`, fake.email);
          return json(200, {
            access_token: accessToken,
            expires_in: 3599,
            ...(fake.noRefreshToken ? {} : { refresh_token: `rt-${n}` }),
            scope: fake.grantedScopes.join(' '),
            token_type: 'Bearer',
            id_token: `${b64url({ alg: 'RS256' })}.${b64url({ email: fake.email, email_verified: true })}.sig`,
          });
        }
        fake.refreshCount++;
        const rt = body.get('refresh_token')!;
        if (fake.revoked.includes(rt) || accessRevoked()) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        access.add(accessToken);
        return json(200, { access_token: accessToken, expires_in: 3599, scope: fake.grantedScopes.join(' '), token_type: 'Bearer' });
      }
      if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
        if (fake.revokeFails) return json(503, { error: 'unavailable' });
        const token = new URLSearchParams(String(init?.body)).get('token')!;
        const account = accountOf.get(token);
        const all = account ? [...accountOf].filter(([, a]) => a === account).map(([t]) => t) : [token];
        for (const t of all) if (!fake.revoked.includes(t)) fake.revoked.push(t);
        return json(200, {});
      }
      if (url.startsWith('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send')) {
        const headers = new Headers(init?.headers);
        const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
        if (fake.expireAccessOnce || fake.expireAccessAfterSends === fake.sent.length) {
          fake.expireAccessOnce = false;
          fake.expireAccessAfterSends = null;
          access.delete(token);
        }
        if (!access.has(token) || accessRevoked() || fake.rejectAllSends) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
        if (fake.sendError) return json(fake.sendError.status, { error: { code: fake.sendError.status, message: fake.sendError.message } });
        fake.sent.push(Buffer.from(init?.body as Uint8Array));
        fake.sendHeaders.push(headers);
        return json(200, { id: `m${fake.sent.length}`, threadId: 't', labelIds: ['SENT'] });
      }
      if (url.startsWith('https://people.googleapis.com/v1/')) {
        const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? '';
        if (fake.expireAccessOnce) {
          fake.expireAccessOnce = false;
          access.delete(token);
        }
        if (!access.has(token) || accessRevoked()) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
        if (!fake.grantedScopes.includes(CONTACTS_SCOPE)) {
          return new Response(JSON.stringify({ error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }), {
            status: 403,
            headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="https://accounts.google.com/", error="insufficient_scope"' },
          });
        }
        if (fake.peopleError) {
          const { status, message, reason } = fake.peopleError;
          return json(status, { error: { code: status, message, status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] } });
        }
        const u = new URL(url);
        const from = Number(u.searchParams.get('pageToken') ?? 0);
        const page = <T>(all: T[]) => ({ items: all.slice(from, from + 2), ...(from + 2 < all.length ? { nextPageToken: String(from + 2) } : {}) });
        if (u.pathname === '/v1/contactGroups') {
          const all = [{ resourceName: 'contactGroups/myContacts', name: 'myContacts', groupType: 'SYSTEM_CONTACT_GROUP' }, ...fake.labels.map((l) => ({ ...l, groupType: 'USER_CONTACT_GROUP' }))];
          const { items, nextPageToken } = page(all);
          return json(200, { contactGroups: items, nextPageToken });
        }
        if (u.pathname === '/v1/people/me/connections') {
          const { items, nextPageToken } = page(fake.contacts);
          return json(200, {
            connections: items.map((c) => ({
              resourceName: c.resourceName,
              names: c.name ? [{ displayName: c.name, metadata: { primary: true } }] : undefined,
              // La principale (la première du contact) est donnée en dernier : le client doit la remettre en tête.
              emailAddresses: c.emails.length ? [...c.emails.slice(1).map((value) => ({ value })), { value: c.emails[0], metadata: { primary: true } }] : undefined,
              phoneNumbers: c.phone ? [{ value: c.phone, metadata: { primary: true } }] : undefined,
              organizations: c.organization ? [{ name: c.organization }] : undefined,
              memberships: c.groups.map((g) => ({ contactGroupMembership: { contactGroupResourceName: g } })),
            })),
            nextPageToken,
          });
        }
      }
      return json(404, { error: 'not found' });
    }) as typeof fetch,
  };
  return fake;
}

type Injectable = { inject(o: { method: string; url: string; headers?: Record<string, string> }): Promise<{ statusCode: number; headers: Record<string, unknown>; json(): any }> };

/** Parcours complet : « Se connecter avec Google », Google accepte, retour sur l'application. Renvoie la réponse du retour. */
export async function connectGoogle(app: Injectable, headers: Record<string, string> = {}, code = 'code-ok') {
  const start = await app.inject({ method: 'POST', url: '/api/app-settings/google/start', headers });
  const state = new URL(start.json().url).searchParams.get('state')!;
  return app.inject({ method: 'GET', url: `/api/app-settings/google/callback?code=${code}&state=${encodeURIComponent(state)}`, headers });
}
