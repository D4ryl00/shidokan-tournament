import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, openDb } from '../../src/server/db/client.js';
import { tmpDir } from './tmp-db.js';

/** Base au niveau de migration `upTo` (index du journal), comme une base créée par une version antérieure de l'app. */
export function olderDb(upTo: number): string {
  const dir = tmpDir('ancienne-');
  const src = path.resolve('drizzle');
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(fs.readFileSync(path.join(src, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
  const kept = journal.entries.filter((e) => e.idx <= upTo);
  for (const e of kept) fs.copyFileSync(path.join(src, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: kept }));
  const file = path.join(dir, 'ancienne.sqlite');
  process.env.MIGRATIONS_DIR = dir;
  try {
    closeDb(openDb(file));
  } finally {
    delete process.env.MIGRATIONS_DIR;
  }
  return file;
}
