import { expect, test } from 'vitest';
import { ApiError } from '../../src/web/apiError.js';
import { isNetworkError, NETWORK_ERROR_TEXT, publicErrorText, publicRetry, publicRetryDelay, received } from '../../src/web/publicStatus.js';

test('erreur de réseau : fetch rejeté (message du navigateur, souvent en anglais) ou 502 / 503 / 504', () => {
  for (const e of [new TypeError('Failed to fetch'), new TypeError('Load failed'), new ApiError(502, 'Erreur 502'), new ApiError(503, 'Erreur 503'), new ApiError(504, 'Erreur 504')]) {
    expect(isNetworkError(e), e.message).toBe(true);
    expect(publicErrorText(e, false)).toBe(NETWORK_ERROR_TEXT);
  }
  expect(NETWORK_ERROR_TEXT).toBe('Impossible de joindre le serveur, nouvel essai…');
  expect(isNetworkError(new ApiError(500, 'Erreur 500'))).toBe(false);
  expect(isNetworkError(new ApiError(404, 'Compétition introuvable.'))).toBe(false);
});

test('rien à afficher tant que des données sont à l’écran ; sinon le message du serveur', () => {
  expect(publicErrorText(new TypeError('Load failed'), true)).toBeNull();
  expect(publicErrorText(new ApiError(500, 'Erreur 500'), true)).toBeNull();
  expect(publicErrorText(null, false)).toBeNull();
  expect(publicErrorText(new ApiError(500, 'Erreur interne.'), false)).toBe('Erreur interne.');
});

test('réessai : réseau seulement, attente croissante jusqu’à 30 s', () => {
  expect(publicRetry(50, new TypeError('Failed to fetch'))).toBe(true);
  expect(publicRetry(0, new ApiError(500, 'x'))).toBe(false);
  expect([0, 1, 2, 10].map(publicRetryDelay)).toEqual([1000, 2000, 4000, 30_000]);
});

test('heure des données : changée seulement quand des données nouvelles arrivent (pas après un 304)', () => {
  const t1 = new Date('2026-11-22T09:00:00Z');
  const t2 = new Date('2026-11-22T09:30:00Z');
  const a = { v: 1 };
  expect(received(null, undefined, t1)).toBeNull();
  const first = received(null, a, t1);
  expect(first).toEqual({ data: a, at: t1 });
  // Même objet (React Query garde l'objet quand rien n'a changé) : même heure.
  expect(received(first, a, t2)).toBe(first);
  expect(received(first, undefined, t2)).toBe(first);
  expect(received(first, { v: 2 }, t2)?.at).toBe(t2);
});
