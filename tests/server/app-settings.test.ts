import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../src/domain/app-settings.js';
import { buildApp } from '../../src/server/app.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp({ dbPath: tmpDbPath() });
});
afterEach(async () => app.close());

const get = async () => (await app.inject({ method: 'GET', url: '/api/app-settings' })).json();
const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/api/app-settings', payload });
const SMTP = { host: 'smtp.gmail.com', port: 465, security: 'tls', user: 'orga@gmail.com', password: 'abcd efgh ijkl mnop', fromName: 'Shidokan France', fromEmail: 'orga@gmail.com' };

test('valeurs par défaut (textes exacts)', async () => {
  const s = await get();
  expect(s).toMatchObject({ smtp: null, privacyContact: '', retentionMonths: 13, directoryInactiveYears: 3 });
  expect(s.privacyNotice).toBe(
    'Les informations saisies sur cette page sont traitées par Shidokan France pour organiser la compétition (inscriptions, catégories, tableaux). Le poids, le grade et les coordonnées du coach sont effacés 13 mois après la compétition ; les résultats (nom, club, catégorie, classement) sont conservés comme archive sportive. Pour toute question, ou pour exercer vos droits sur ces données : {contact}.',
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
