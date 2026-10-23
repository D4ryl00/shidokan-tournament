import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD = 10;
const PARAMS = { N: 16384, r: 8, p: 1 };
const LENGTH = 64;

/** Empreinte lente d'un mot de passe : `scrypt$<sel>$<empreinte>` (base64). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, LENGTH, PARAMS).toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, PARAMS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Empreinte de comparaison quand le compte n'existe pas (même durée de vérification). */
export const DUMMY_HASH = hashPassword('compte-inexistant');
