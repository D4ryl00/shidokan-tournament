import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

/**
 * Journal en ajout seul (spec §8) : aucun code ne modifie ni ne supprime une entrée, hors purge de conservation
 * (`repositories/retention.ts`), remplacement par un paquet synchronisé (`sync/package.ts`) et suppression de la compétition
 * (cascade de la clé étrangère : aucun code). Ce test lit les sources.
 */
const ALLOWED = ['src/server/repositories/retention.ts', 'src/server/sync/package.ts'];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });

/** Modification ou suppression qui nomme la table : en SQL, ou par drizzle (`db.update(journalEntries)`, `db.delete(journalEntries)`). */
const DIRECT = [
  /\bupdate\s+(?:or\s+\w+\s+)?["'`]?journal_entries\b/i,
  /\bdelete\s+from\s+["'`]?journal_entries\b/i,
  /\breplace\s+into\s+["'`]?journal_entries\b/i,
  /\b(?:update|delete)\(\s*journalEntries\b/,
];
/** Modification ou suppression sur une table choisie à l'exécution (`delete from ${table}`) : à surveiller dans un fichier qui nomme la table. */
const DYNAMIC = /\b(?:update|delete\s+from)\s+["'`]?\$\{/i;
const NAMES_TABLE = /journal_entries|journalEntries|PACKAGE_TABLES/;

function scan(): { file: string; line: string }[] {
  const found: { file: string; line: string }[] = [];
  for (const file of files('src')) {
    const text = readFileSync(file, 'utf8');
    const watchDynamic = NAMES_TABLE.test(text);
    text.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (DIRECT.some((re) => re.test(line)) || (watchDynamic && DYNAMIC.test(line))) found.push({ file: file.split(path.sep).join('/'), line: `${i + 1}: ${t.slice(0, 140)}` });
    });
  }
  return found;
}

test('journal en ajout seul : aucune modification ni suppression d’entrée hors purge de conservation et paquet synchronisé', () => {
  const found = scan();
  expect(found.filter((f) => !ALLOWED.includes(f.file))).toEqual([]);
  // Le test voit bien les chemins permis (sinon il ne surveillerait plus rien).
  expect([...new Set(found.map((f) => f.file))].sort()).toEqual(ALLOWED);
});
