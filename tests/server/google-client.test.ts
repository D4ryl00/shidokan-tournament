import { beforeEach, expect, test } from 'vitest';
import { ContactsScopeMissingError, GOOGLE_SCOPES, GoogleAccessRevokedError, googleClient, googleConfigFrom, type GoogleClient } from '../../src/server/google/client.js';
import { fakeGoogle, type FakeGoogle } from '../helpers/fake-google.js';

let fake: FakeGoogle;
let google: GoogleClient;
beforeEach(() => {
  fake = fakeGoogle();
  google = googleClient(googleConfigFrom({ clientId: 'id-client', clientSecret: 'secret', publicUrl: 'https://x.org/', fetch: fake.fetch })!);
});

test('configuration : il faut l’ID client, le code secret et l’adresse publique ; adresse de retour sur PUBLIC_URL', () => {
  expect(googleConfigFrom({ clientSecret: 's', publicUrl: 'https://x.org' })).toBeNull();
  expect(googleConfigFrom({ clientId: 'i', publicUrl: 'https://x.org' })).toBeNull();
  expect(googleConfigFrom({ clientId: 'i', clientSecret: 's' })).toBeNull();
  expect(googleConfigFrom({ clientId: 'i', clientSecret: 's', publicUrl: 'https://x.org/' })!.redirectUri).toBe('https://x.org/api/app-settings/google/callback');
});

test('adresse d’autorisation : le droit d’envoyer et de lire les contacts, accès durable, consentement redemandé, state', () => {
  const url = new URL(google.authUrl('etat-123'));
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: 'id-client',
    redirect_uri: 'https://x.org/api/app-settings/google/callback',
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: 'etat-123',
  });
  expect(GOOGLE_SCOPES).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/contacts.readonly']);
  expect(url.toString()).not.toContain('mail.google.com');
});

test('échange du code : jeton de renouvellement, adresse du compte, autorisations accordées', async () => {
  const r = await google.exchangeCode('code-1');
  expect(r).toEqual({ refreshToken: 'rt-1', email: 'orga@gmail.com', scopes: fake.grantedScopes });
  expect(Object.fromEntries(fake.tokenRequests[0]!)).toMatchObject({ grant_type: 'authorization_code', code: 'code-1', client_id: 'id-client', client_secret: 'secret', redirect_uri: 'https://x.org/api/app-settings/google/callback' });
});

test('échange du code sans jeton de renouvellement → erreur', async () => {
  fake.noRefreshToken = true;
  await expect(google.exchangeCode('code-1')).rejects.toThrow(/renouvellement/);
});

test('jeton d’accès gardé en mémoire ; force = nouveau renouvellement ; invalid_grant → GoogleAccessRevokedError', async () => {
  const a = await google.accessToken('rt-x');
  expect(await google.accessToken('rt-x')).toBe(a);
  expect(fake.refreshCount).toBe(1);
  expect(await google.accessToken('rt-x', { force: true })).not.toBe(a);
  expect(fake.refreshCount).toBe(2);
  fake.revoked.push('rt-y');
  await expect(google.accessToken('rt-y')).rejects.toBeInstanceOf(GoogleAccessRevokedError);
});

test('envoi : le message tel quel, en message/rfc822, avec le jeton d’accès', async () => {
  const mime = Buffer.from('From: a@b\r\nSubject: Essai\r\n\r\nBonjour');
  await google.sendRaw('rt-x', mime);
  expect(fake.sent).toEqual([mime]);
  expect(fake.sendHeaders[0]!.get('content-type')).toBe('message/rfc822');
  expect(fake.sendHeaders[0]!.get('authorization')).toMatch(/^Bearer at-\d+$/);
});

test('jeton d’accès expiré entre deux envois (401) : renouvelé une fois puis renvoyé', async () => {
  await google.sendRaw('rt-x', Buffer.from('1'));
  fake.expireAccessOnce = true;
  await google.sendRaw('rt-x', Buffer.from('2'));
  expect(fake.sent.map(String)).toEqual(['1', '2']);
  expect(fake.refreshCount).toBe(2);
});

test('accès retiré pendant un envoi : GoogleAccessRevokedError', async () => {
  await google.sendRaw('rt-x', Buffer.from('1'));
  fake.revokeAfterSends = 1;
  await expect(google.sendRaw('rt-x', Buffer.from('2'))).rejects.toBeInstanceOf(GoogleAccessRevokedError);
});

test('autre refus de Gmail : message avec le code et le motif', async () => {
  fake.sendError = { status: 403, message: 'Quota' };
  await expect(google.sendRaw('rt-x', Buffer.from('1'))).rejects.toThrow(/403.*Quota/);
});

test('révocation : vrai et jeton noté ; échec → faux, sans lever', async () => {
  expect(await google.revoke('rt-1')).toBe(true);
  expect(fake.revoked).toEqual(['rt-1']);
  fake.revokeFails = true;
  expect(await google.revoke('rt-2')).toBe(false);
  fake.revokeFails = false;
  fake.networkDown = true;
  expect(await google.revoke('rt-3')).toBe(false);
});

test('401 de Gmail même avec un jeton neuf (renouvellement accepté) : erreur ordinaire, pas un retrait d’accès', async () => {
  fake.rejectAllSends = true;
  const err = await google.sendRaw('rt-x', Buffer.from('1')).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(GoogleAccessRevokedError);
  expect(String(err)).toMatch(/401/);
});

test('autorisation : contacts en lecture seule demandés', () => {
  const scope = new URL(google.authUrl('s')).searchParams.get('scope')!;
  expect(scope).toContain('contacts.readonly');
  expect(scope.replace('contacts.readonly', '')).not.toContain('auth/contacts');
});

test('contacts : toutes les pages, principal choisi, toutes les adresses (principale en tête), libellés', async () => {
  fake.contacts = [1, 2, 3, 4, 5].map((i) => ({ resourceName: `people/c${i}`, name: `Coach ${i}`, emails: i === 4 ? [] : [`c${i}@x.org`, `autre${i}@x.org`], phone: i === 2 ? null : `060000000${i}`, organization: i === 3 ? 'Dojo' : null, groups: i === 1 ? ['contactGroups/g1'] : [] }));
  const rt = (await google.exchangeCode('c')).refreshToken;
  const list = await google.listContacts(rt);
  expect(list).toHaveLength(5);
  expect(list[0]).toEqual({ resourceName: 'people/c1', name: 'Coach 1', emails: ['c1@x.org', 'autre1@x.org'], phone: '0600000001', organization: null, groups: ['contactGroups/g1'] });
  expect(list[1]!.phone).toBeNull();
  expect(list[2]!.organization).toBe('Dojo');
  expect(list[3]!.emails).toEqual([]);
});

test('libellés : seulement ceux de l’utilisateur, triés par nom', async () => {
  fake.labels = [{ resourceName: 'contactGroups/b', name: 'Coachs' }, { resourceName: 'contactGroups/a', name: 'Arbitres' }, { resourceName: 'contactGroups/c', name: 'Dojos' }];
  const rt = (await google.exchangeCode('c')).refreshToken;
  expect(await google.listContactLabels(rt)).toEqual([
    { resourceName: 'contactGroups/a', name: 'Arbitres' },
    { resourceName: 'contactGroups/b', name: 'Coachs' },
    { resourceName: 'contactGroups/c', name: 'Dojos' },
  ]);
});

test('contacts : droit absent → ContactsScopeMissingError ; accès retiré → GoogleAccessRevokedError ; 401 → renouvelé une fois', async () => {
  const rt = (await google.exchangeCode('c')).refreshToken;
  fake.grantedScopes = fake.grantedScopes.filter((s) => !s.includes('contacts'));
  await expect(google.listContacts(rt)).rejects.toBeInstanceOf(ContactsScopeMissingError);
  await expect(google.listContactLabels(rt)).rejects.toBeInstanceOf(ContactsScopeMissingError);
  fake.grantedScopes.push('https://www.googleapis.com/auth/contacts.readonly');
  fake.contacts = [{ resourceName: 'people/c1', name: 'A', emails: [], phone: null, organization: null, groups: [] }];
  await google.accessToken(rt); // jeton en cache
  fake.revokeAfterSends = 0;
  await expect(google.listContacts(rt)).rejects.toBeInstanceOf(GoogleAccessRevokedError);
  fake.revokeAfterSends = null;
  const before = fake.refreshCount;
  fake.expireAccessOnce = true;
  expect(await google.listContacts(rt)).toHaveLength(1);
  expect(fake.refreshCount).toBe(before + 1);
});

test('contacts : 403 API People désactivée → erreur ordinaire avec le message de Google, pas ContactsScopeMissingError', async () => {
  const rt = (await google.exchangeCode('c')).refreshToken;
  const message = 'People API has not been used in project 123 before or it is disabled.';
  const off = googleClient(googleConfigFrom({ clientId: 'i', clientSecret: 's', publicUrl: 'https://x.org/', fetch: (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith('https://people.googleapis.com')
      ? new Response(JSON.stringify({ error: { code: 403, message, status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }), { status: 403, headers: { 'content-type': 'application/json' } })
      : fake.fetch(input, init)) as typeof fetch })!);
  const err = await off.listContacts(rt).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(ContactsScopeMissingError);
  expect((err as Error).message).toContain(message);
});
