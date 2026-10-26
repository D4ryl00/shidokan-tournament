import { afterEach, beforeEach, expect, test } from 'vitest';
import { closeDb, openDb, type AppDb } from '../../src/server/db/client.js';
import { googleClient, googleConfigFrom, type GoogleClient } from '../../src/server/google/client.js';
import { googleKeepAliveTick } from '../../src/server/google/keepalive.js';
import { getAppSettings, setGoogleSender } from '../../src/server/repositories/app-settings.js';
import { fakeGoogle, type FakeGoogle } from '../helpers/fake-google.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let db: AppDb;
let fake: FakeGoogle;
let google: GoogleClient;
const NOW = new Date('2027-06-01T08:00:00.000Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();
const connect = (lastRefreshAt: string | null, status: 'ok' | 'reconnect' = 'ok') =>
  setGoogleSender(db, { email: 'orga@gmail.com', fromName: 'X', refreshToken: 'rt-a', status, lastRefreshAt }, 'google');

beforeEach(() => {
  db = openDb(tmpDbPath());
  fake = fakeGoogle();
  google = googleClient(googleConfigFrom({ clientId: 'i', clientSecret: 's', publicUrl: 'https://x.org', fetch: fake.fetch })!);
});
afterEach(() => closeDb(db));

test('rien à faire : pas de compte, accès renouvelé il y a moins de 30 jours, ou déjà « à reconnecter »', async () => {
  expect(await googleKeepAliveTick(db, google, NOW)).toBe('skipped');
  connect(daysBefore(29));
  expect(await googleKeepAliveTick(db, google, NOW)).toBe('skipped');
  connect(daysBefore(40), 'reconnect');
  expect(await googleKeepAliveTick(db, google, NOW)).toBe('skipped');
  expect(fake.refreshCount).toBe(0);
});

test('plus de 30 jours (ou jamais) : accès renouvelé, date notée', async () => {
  connect(daysBefore(31));
  expect(await googleKeepAliveTick(db, google, NOW)).toBe('refreshed');
  expect(fake.refreshCount).toBe(1);
  expect(getAppSettings(db).google).toMatchObject({ status: 'ok', lastRefreshAt: NOW.toISOString() });
  connect(null);
  expect(await googleKeepAliveTick(db, google, NOW)).toBe('refreshed');
});

test('accès retiré chez Google : état « à reconnecter »', async () => {
  connect(daysBefore(31));
  fake.revoked.push('rt-a');
  expect(await googleKeepAliveTick(db, google, NOW)).toBe('revoked');
  expect(getAppSettings(db).google).toMatchObject({ status: 'reconnect', lastRefreshAt: daysBefore(31) });
});

test('réseau coupé : échec sans changer l’état ni la date (nouvel essai le lendemain)', async () => {
  connect(daysBefore(31));
  fake.networkDown = true;
  expect(await googleKeepAliveTick(db, google, NOW)).toBe('failed');
  expect(getAppSettings(db).google).toMatchObject({ status: 'ok', lastRefreshAt: daysBefore(31) });
});
