import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Dossiers temporaires créés par les tests : supprimés à la fin du processus (ils s'accumulaient sur le disque). */
const created: string[] = [];
process.once('exit', () => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

/** Nouveau dossier temporaire, supprimé à la fin des tests. */
export function tmpDir(prefix = 'shidokan-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Chemin d'une base SQLite dans un dossier temporaire neuf (dossier parent non créé). */
export function tmpDbPath(): string {
  return path.join(tmpDir(), 'sous-dossier', 'test.sqlite');
}
