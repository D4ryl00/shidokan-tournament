/** Limites des images d'un message aux clubs (complétées avec le stockage, tâche 3). */
export const MAIL_IMAGE_LIMITS = {
  /** Images distinctes par message. */
  maxPerMessage: 10,
  /** Largeur maximale après réduction, en pixels. */
  maxWidth: 1200,
  /** Poids maximal d'une image après réduction, en octets. */
  maxBytes: 2 * 1024 * 1024,
  /** Largeurs d'affichage proposées, en pixels. */
  displayWidths: [200, 400, 600],
  /** Poids maximal d'un mail (images + fiches + pièces) ; Gmail refuse au-delà de 25 Mo une fois encodé (facteur ~1,37). */
  maxMailBytes: 18 * 1024 * 1024,
} as const;

const IMAGE_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']\/api\/mail-images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi;

/** Identifiants des images citées par un message HTML, sans doublon, dans l'ordre. */
export function mailImageIdsIn(html: string): string[] {
  return [...new Set([...html.matchAll(IMAGE_SRC)].map((m) => m[1]!.toLowerCase()))];
}
