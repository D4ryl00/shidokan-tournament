import { afterAll } from 'vitest';
import { cleanupTmpDirs } from './tmp-db.js';

// Les workers vitest ne déclenchent pas le hook « exit » : on nettoie à la fin de chaque fichier de test.
afterAll(() => cleanupTmpDirs());
