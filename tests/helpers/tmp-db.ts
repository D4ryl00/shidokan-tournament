import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Chemin d'une base SQLite dans un dossier temporaire neuf (dossier parent non créé). */
export function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shidokan-'));
  return path.join(dir, 'sous-dossier', 'test.sqlite');
}
