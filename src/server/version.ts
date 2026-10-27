import fs from 'node:fs';
import path from 'node:path';

/**
 * Version de l'application : celle de package.json, que la CI fixe au numéro calculé par semantic-release avant de construire
 * l'image (workflow docker.yml). Hors CI, package.json porte `0.0.0-dev`.
 */
export const APP_VERSION = (() => {
  try {
    return (JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'inconnue';
  }
})();
