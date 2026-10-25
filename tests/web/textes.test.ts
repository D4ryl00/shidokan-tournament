import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const ROOTS = ['src/web', 'src/server', 'src/domain'];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });

/**
 * Un mot suivi de « (s) » ; sont écartés les appels de fonction sur une variable `s` : méthode (`.includes(s)`), argument
 * (`get(pool(s))`), nom en camelCase (`setWinner(s)`) ou appel suivi d'une comparaison (`pool(s) >= 0`).
 */
const PLURAL = /(?<![.(\p{L}])(\p{L}+)\(s\)(?!\s*(?:===|!==|>=|<=|=>))/gu;
const isText = (word: string) => !/[A-Z]/.test(word.slice(1));

test('aucun « (s) » dans un texte', () => {
  const found: string[] = [];
  for (const file of ROOTS.flatMap(files)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if ([...line.matchAll(PLURAL)].some((m) => isText(m[1]!))) found.push(`${file}:${i + 1}: ${t.slice(0, 120)}`);
    });
  }
  expect(found).toEqual([]);
});
