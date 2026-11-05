/** Limites des images d'un message aux clubs. */
export const MAIL_IMAGE_LIMITS = {
  /** Largeur maximale après réduction, en pixels. */
  maxWidth: 1200,
  /** Poids maximal d'une image après réduction, en octets. */
  fileBytes: 2 * 1024 * 1024,
  /** Images distinctes par message. */
  perMessage: 10,
  /** Largeurs d'affichage proposées, en pixels. */
  widths: { small: 200, medium: 400, full: 600 },
  /** Poids maximal d'un mail (images + fiches + pièces) ; Gmail refuse au-delà de 25 Mo une fois encodé (facteur ~1,37). */
  maxMailBytes: 18 * 1024 * 1024,
} as const;

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGE_SRC = new RegExp(`^/api/mail-images/(${ID})$`, 'i');
/** Une balise `<img …>` : les `>` entre guillemets ne la ferment pas. */
const IMG_TAG = /<img\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
/** Un attribut : nom, puis valeur entre guillemets, entre apostrophes ou nue. */
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Adresse relative d'une image stockée. */
export const mailImageUrl = (id: string): string => `/api/mail-images/${id}`;

/** Identifiant de l'image qu'une adresse `src` désigne, ou null si ce n'est pas exactement l'adresse d'une image du message. */
export function mailImageIdOfSrc(src: string): string | null {
  return IMAGE_SRC.exec(src)?.[1]?.toLowerCase() ?? null;
}

/** Identifiants des images citées par un message HTML (attribut `src` des balises `<img>` seulement), sans doublon, dans l'ordre. */
export function mailImageIdsIn(html: string): string[] {
  const ids: string[] = [];
  for (const tag of html.matchAll(IMG_TAG)) {
    for (const [, name, double, single, bare] of tag[1]!.matchAll(ATTRIBUTE)) {
      if (name!.toLowerCase() !== 'src') continue;
      const id = mailImageIdOfSrc(double ?? single ?? bare ?? '');
      if (id) ids.push(id);
      break; // seul le premier `src` compte, comme dans un navigateur
    }
  }
  return [...new Set(ids)];
}

/** Type d'une image reconnu à ses premiers octets (JPEG, PNG, GIF) ; null pour le reste (SVG, WebP, texte renommé…). */
export function detectImageType(data: Uint8Array): 'image/jpeg' | 'image/png' | 'image/gif' | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0x47, 0x49, 0x46, 0x38) && (data[4] === 0x37 || data[4] === 0x39) && data[5] === 0x61) return 'image/gif';
  return null;
}

/** Dimensions après réduction à la largeur maximale, proportions gardées ; une image assez étroite n'est pas touchée. */
export function reducedSize(width: number, height: number): { width: number; height: number } {
  if (width <= MAIL_IMAGE_LIMITS.maxWidth) return { width, height };
  return { width: MAIL_IMAGE_LIMITS.maxWidth, height: Math.max(1, Math.round((height * MAIL_IMAGE_LIMITS.maxWidth) / width)) };
}
