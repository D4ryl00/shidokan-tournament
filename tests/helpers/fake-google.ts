// Faux Google des tests : jetons, révocation et envoi Gmail, aiguillés selon l'adresse appelée.
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
  /** La révocation échoue. */
  revokeFails: boolean;
  /** Le réseau est coupé (fetch lève). */
  networkDown: boolean;
  /** Google ne renvoie pas de jeton de renouvellement. */
  noRefreshToken: boolean;
  /** Erreur renvoyée par Gmail à l'envoi. */
  sendError: { status: number; message: string } | null;
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
  const fake: FakeGoogle = {
    email: 'orga@gmail.com',
    grantedScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.send'],
    revokeAfterSends: null,
    expireAccessOnce: false,
    revokeFails: false,
    networkDown: false,
    noRefreshToken: false,
    sendError: null,
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
        fake.revoked.push(new URLSearchParams(String(init?.body)).get('token')!);
        return json(200, {});
      }
      if (url.startsWith('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send')) {
        const headers = new Headers(init?.headers);
        const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
        if (fake.expireAccessOnce) {
          fake.expireAccessOnce = false;
          access.delete(token);
        }
        if (!access.has(token) || accessRevoked()) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
        if (fake.sendError) return json(fake.sendError.status, { error: { code: fake.sendError.status, message: fake.sendError.message } });
        fake.sent.push(Buffer.from(init?.body as Uint8Array));
        fake.sendHeaders.push(headers);
        return json(200, { id: `m${fake.sent.length}`, threadId: 't', labelIds: ['SENT'] });
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
