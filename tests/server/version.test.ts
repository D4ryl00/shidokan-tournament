import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { APP_VERSION } from '../../src/server/version.js';
import { tmpDbPath } from '../helpers/tmp-db.js';

test('version : celle de package.json, renvoyée par /api/health (route publique)', async () => {
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  expect(APP_VERSION).toBe(version);
  const app = await buildApp({ dbPath: tmpDbPath() });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ ok: true, version });
  } finally {
    await app.close();
  }
});
