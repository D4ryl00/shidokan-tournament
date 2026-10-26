import { beforeEach, expect, test } from 'vitest';
import { GOOGLE_SCOPES, GoogleAccessRevokedError, googleClient, googleConfigFrom, type GoogleClient } from '../../src/server/google/client.js';
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

test('adresse d’autorisation : le seul droit d’envoyer, accès durable, consentement redemandé, state', () => {
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
  expect(GOOGLE_SCOPES).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/gmail.send']);
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
