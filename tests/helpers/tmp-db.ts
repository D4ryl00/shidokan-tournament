import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Dossiers temporaires créés par les tests : supprimés à la fin du processus (ils s'accumulaient sur le disque). */
const created: string[] = [];

/** Supprime les dossiers créés jusqu'ici (appelé en fin de fichier de test par tests/helpers/setup-tmp-cleanup.ts). */
export function cleanupTmpDirs(): void {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

// Filet de sécurité hors vitest ; sous le pool de workers de vitest ce hook ne s'exécute pas.
process.once('exit', cleanupTmpDirs);

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
