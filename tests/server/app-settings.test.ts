import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { CONTACTS_SCOPE, DEFAULT_APP_SETTINGS, hasContactsScope, PREVIOUS_DEFAULT_PRIVACY_NOTICES } from '../../src/domain/app-settings.js';
import { rulesView } from '../../src/domain/replacement/rules.js';
import { defaultSettings } from '../../src/domain/settings.js';
import { openDb, closeDb } from '../../src/server/db/client.js';
import { appSettings } from '../../src/server/db/schema.js';
import { getAppSettings } from '../../src/server/repositories/app-settings.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp({ clubServices: true, dbPath: tmpDbPath() });
});
afterEach(async () => app.close());

const get = async () => (await app.inject({ method: 'GET', url: '/api/app-settings' })).json();
const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/api/app-settings', payload });
const SMTP = { host: 'smtp.gmail.com', port: 465, security: 'tls', user: 'orga@gmail.com', password: 'abcd efgh ijkl mnop', fromName: 'Shidokan France', fromEmail: 'orga@gmail.com' };

test('valeurs par défaut (textes exacts)', async () => {
  const s = await get();
  expect(s).toMatchObject({ smtp: null, privacyContact: '', retentionMonths: 13, directoryInactiveYears: 3 });
  expect(s.privacyNotice).toBe(
    'Les informations saisies sur cette page sont traitées par Shidokan France pour organiser la compétition (inscriptions, catégories, tableaux). Le poids, le grade et les coordonnées du coach sont effacés 13 mois après la compétition ; les résultats (nom, club, catégorie, classement) sont conservés comme archive sportive. Les tableaux et les résultats (nom, prénom, club, catégorie, résultats des combats) sont publiés sur le site des compétitions ; l’organisateur masque le nom d’un combattant sur simple demande. Pour toute question, ou pour exercer vos droits sur ces données : {contact}.',
  );
  expect(s.invitationMail.subject).toBe('Inscriptions — {competition}');
  expect(s.invitationMail.body).toBe(DEFAULT_APP_SETTINGS.invitationMail.body);
  expect(s.invitationMail.body).toContain('{lien}');
});

test('enregistrement partiel', async () => {
  expect((await patch({ privacyContact: 'rgpd@shidokanfrance.com' })).statusCode).toBe(200);
  expect((await patch({ retentionMonths: 24 })).statusCode).toBe(200);
  expect(await get()).toMatchObject({ privacyContact: 'rgpd@shidokanfrance.com', retentionMonths: 24, directoryInactiveYears: 3 });
});

test('le mot de passe SMTP n’est jamais renvoyé ; absent = gardé ; vide = effacé', async () => {
  const res = await patch({ smtp: SMTP });
  expect(res.body).not.toContain('abcd efgh');
  expect((await get()).smtp).toEqual({ ...SMTP, password: undefined, hasPassword: true });
  await patch({ smtp: { ...SMTP, password: null, fromName: 'Shidokan' } });
  expect((await get()).smtp).toMatchObject({ fromName: 'Shidokan', hasPassword: true });
  await patch({ smtp: { ...SMTP, password: '' } });
  expect((await get()).smtp.hasPassword).toBe(false);
});

test('bornes : délais ≥ 1, port 1..65535', async () => {
  expect((await patch({ retentionMonths: 0 })).statusCode).toBe(400);
  expect((await patch({ directoryInactiveYears: 0 })).statusCode).toBe(400);
  expect((await patch({ smtp: { ...SMTP, port: 70000 } })).statusCode).toBe(400);
});

test('règles de réaffectation par défaut : celles d’une compétition neuve, modifiables, sans toucher aux autres réglages', async () => {
  const def = rulesView(defaultSettings());
  expect((await get()).defaultReplacementRules).toEqual(def);
  const next = { ...def, cutAfter: 'ageUp', on: { ...def.on, mixSexes: true } };
  expect((await patch({ defaultReplacementRules: next })).statusCode).toBe(200);
  expect((await get()).defaultReplacementRules).toEqual(next);
  expect((await get()).retentionMonths).toBe(13);
  expect((await patch({ defaultReplacementRules: { ...def, order: [...def.order].reverse() } })).statusCode).toBe(400);
  expect((await patch({ defaultReplacementRules: { ...def, on: { ...def.on, return: false } } })).statusCode).toBe(400);
});

test('mode d’envoi : SMTP par défaut, pas de compte Google, Google indisponible sans configuration', async () => {
  expect(await get()).toMatchObject({ mailMode: 'smtp', google: null, googleAvailable: false });
});

test('mode Google ou nom d’expéditeur Google sans compte connecté → 400 « Connectez d’abord un compte Google. »', async () => {
  for (const payload of [{ mailMode: 'google' }, { googleFromName: 'X' }]) {
    const r = await patch(payload);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('Connectez d’abord un compte Google.');
  }
  expect(await get()).toMatchObject({ mailMode: 'smtp', google: null });
});

test('un réglage smtp enregistré avant (sans mode) se lit comme du SMTP', async () => {
  await patch({ smtp: SMTP });
  const s = await get();
  expect(s.mailMode).toBe('smtp');
  expect(s.smtp.host).toBe('smtp.gmail.com');
  expect(s).not.toHaveProperty('googleFromName');
});

test('état des contacts Google : défaut, jamais envoyé à l’écran, refusé en modification', async () => {
  const dbPath = tmpDbPath();
  const own = await buildApp({ clubServices: true, dbPath });
  try {
    expect(((await own.inject({ method: 'GET', url: '/api/app-settings' })).json() as Record<string, unknown>).googleContacts).toBeUndefined();
    expect((await own.inject({ method: 'PATCH', url: '/api/app-settings', payload: { googleContacts: { account: 'x', label: null, pending: [] } } })).statusCode).toBe(400);
  } finally {
    await own.close();
  }
  const db = openDb(dbPath);
  try {
    expect(getAppSettings(db).googleContacts).toEqual({ account: null, label: null, pending: [] });
  } finally {
    closeDb(db);
  }
  expect(hasContactsScope(null)).toBe(false);
  expect(hasContactsScope({})).toBe(false);
  expect(hasContactsScope({ scopes: [CONTACTS_SCOPE] })).toBe(true);
});

test('le message aux clubs est filtré à l’enregistrement ; un message vide est refusé', async () => {
  const ok = await patch({ invitationMail: { subject: 'S', body: '<p>Bonjour</p><script>x()</script><img src="https://e.fr/a.png">', format: 'html' } });
  expect(ok.statusCode).toBe(200);
  const saved = (await get()).invitationMail;
  expect(saved.body).toBe('<p>Bonjour</p>');
  expect(saved.format).toBe('html');
  const empty = await patch({ invitationMail: { subject: 'S', body: '<p></p>', format: 'html' } });
  expect(empty.statusCode).toBe(400);
  expect(empty.json().error).toBe('Le message est vide.');
  expect((await get()).invitationMail.body).toBe('<p>Bonjour</p>');
});

test('le message d’une compétition est filtré de la même façon', async () => {
  const id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe filtre', date: '2026-11-22' } })).json().id as string;
  const url = `/api/competitions/${id}`;
  const ok = await app.inject({ method: 'PATCH', url, payload: { settings: { invitationMail: { subject: 'S', body: '<p>Salut</p><script>x()</script>', format: 'html' } } } });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().settings.invitationMail.body).toBe('<p>Salut</p>');
  const empty = await app.inject({ method: 'PATCH', url, payload: { settings: { invitationMail: { subject: 'S', body: '<p></p>', format: 'html' } } } });
  expect(empty.statusCode).toBe(400);
  expect(empty.json().error).toBe('Le message est vide.');
  const cleared = await app.inject({ method: 'PATCH', url, payload: { settings: { invitationMail: null } } });
  expect(cleared.statusCode).toBe(200);
});

test('message d’une compétition : remplacé en entier, filtré tel qu’il sera gardé, ni partiel ni format collant', async () => {
  const id = (await app.inject({ method: 'POST', url: '/api/competitions', payload: { name: 'Coupe remplace', date: '2026-11-22' } })).json().id as string;
  const url = `/api/competitions/${id}`;
  const patchMail = (invitationMail: unknown) => app.inject({ method: 'PATCH', url, payload: { settings: { invitationMail } } });
  const stored = async () => (await app.inject({ method: 'GET', url })).json().settings.invitationMail;
  const rich = { subject: 'S', body: '<p>ok</p>', format: 'html' };
  expect((await patchMail(rich)).statusCode).toBe(200);

  // Partiel : il ne fusionne pas avec l'ancien message, le script n'entre pas.
  const partial = await patchMail({ body: '<p>ok2</p><script>x()</script>', format: 'html' });
  expect(partial.statusCode).toBe(400);
  expect(await stored()).toEqual(rich);

  // Texte sur un message mis en forme : il reste du texte.
  expect((await patchMail({ subject: 'T', body: 'a < b <b>c</b>' })).statusCode).toBe(200);
  expect(await stored()).toEqual({ subject: 'T', body: 'a < b <b>c</b>' });

  // Texte de plus de 5000 caractères : refusé par la validation, avec le chemin des réglages.
  const long = await patchMail({ subject: 'T', body: 'x'.repeat(5001) });
  expect(long.statusCode).toBe(400);
  expect(JSON.stringify(long.json())).toContain('5000');
  expect((await stored()).body).toBe('a < b <b>c</b>');

  // Un autre réglage ne touche pas au message.
  expect((await patchMail(rich)).statusCode).toBe(200);
  expect((await app.inject({ method: 'PATCH', url, payload: { settings: { repechage: true } } })).statusCode).toBe(200);
  expect(await stored()).toEqual(rich);
});

test('old default privacy notice is replaced, a custom one is kept', async () => {
  const db = openDb(tmpDbPath());
  const store = (text: string) => db.insert(appSettings).values({ key: 'privacyNotice', valueJson: JSON.stringify(text) }).onConflictDoUpdate({ target: appSettings.key, set: { valueJson: JSON.stringify(text) } }).run();
  store(PREVIOUS_DEFAULT_PRIVACY_NOTICES[0]!);
  expect(getAppSettings(db).privacyNotice).toBe(DEFAULT_APP_SETTINGS.privacyNotice);
  expect(DEFAULT_APP_SETTINGS.privacyNotice).toContain('publiés');
  store('Ma mention : {contact}.');
  expect(getAppSettings(db).privacyNotice).toBe('Ma mention : {contact}.');
  closeDb(db);
});
