import { MAIL_IMAGE_LIMITS } from '../../../domain/mail-images.js';

const FORMAT_REFUSED = 'Format d’image non accepté : JPEG, PNG, WebP ou GIF.';
const TOO_HEAVY = 'Image trop lourde : 2 Mo au plus.';
const UNREADABLE = 'Image illisible.';

/** Format de l'image réduite : le WebP devient JPEG, ou PNG s'il a de la transparence ; JPEG et PNG gardent leur format. */
export function reducedOutputType(type: string, hasAlpha: boolean): 'image/jpeg' | 'image/png' {
  if (type === 'image/png') return 'image/png';
  if (type === 'image/webp') return hasAlpha ? 'image/png' : 'image/jpeg';
  return 'image/jpeg';
}

/** Ce que le collage fait perdre, d'après le HTML collé (simple signal : le vrai filtrage reste dans l'éditeur et le serveur). */
export function pastedLosses(html: string): string[] {
  const losses: string[] = [];
  if (/<table\b/i.test(html)) losses.push('tableau');
  const external = [...html.matchAll(/<img\b[^>]*>/gi)].some((tag) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]);
    return !(src?.[1] ?? src?.[2] ?? src?.[3] ?? '').startsWith('/api/mail-images/');
  });
  if (external) losses.push('image externe');
  return losses;
}

/** Vrai si le HTML collé n'est qu'une image, sans texte (« Copier l'image » depuis un site, Gmail ou Word) : le fichier du presse-papiers est alors l'image voulue. */
export function pastedOnlyAnImage(html: string): boolean {
  if (!/<img\b/i.test(html)) return false;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:"[^"]*"|'[^']*'|[^>"'])*>/g, '')
    .replace(/&nbsp;|&#160;|\u00a0/gi, ' ');
  return text.trim() === '';
}

/** Vrai si un JPEG porte un segment APP1 (Exif ou XMP : appareil, date, parfois position GPS). Lit les segments jusqu'au début de l'image. */
export function jpegCarriesMetadata(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let at = 2;
  while (at + 3 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    if (marker === 0xe1) return true;
    if (marker === 0xda) return false; // début de l'image
    at += marker === 0xff ? 1 : 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
  }
  return false;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

function typeOf(file: File): string {
  if (file.type) return file.type;
  return BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Dessine l'image réduite (1200 px de large au plus) ; fond blanc pour le JPEG, qui n'a pas de transparence. */
function drawn(bitmap: ImageBitmap, width: number, height: number, opaque: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  if (opaque) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}

/**
 * Prépare une image à envoyer : GIF tel quel, WebP converti, JPEG et PNG réduits à 1200 px au plus et 2 Mo au plus.
 * Un JPEG qui porte des métadonnées est réencodé même petit : une photo ne part pas avec sa position GPS (l'orientation est déjà appliquée par `createImageBitmap`).
 * Lève une erreur en français pour un format refusé (SVG compris) ou une image trop lourde.
 */
export async function prepareImage(file: File): Promise<Blob> {
  const type = typeOf(file);
  if (!ACCEPTED.includes(type)) throw new Error(FORMAT_REFUSED);
  const max = MAIL_IMAGE_LIMITS.fileBytes;
  if (type === 'image/gif') {
    if (file.size > max) throw new Error(TOO_HEAVY);
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(UNREADABLE);
  }
  try {
    const fits = bitmap.width <= MAIL_IMAGE_LIMITS.maxWidth && file.size <= max;
    if (type !== 'image/webp' && fits && !(type === 'image/jpeg' && jpegCarriesMetadata(new Uint8Array(await file.arrayBuffer())))) return file;
    const width = Math.min(bitmap.width, MAIL_IMAGE_LIMITS.maxWidth);
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    let output = reducedOutputType(type, type !== 'image/jpeg' && hasTransparency(drawn(bitmap, width, height, false)));
    if (output === 'image/png') {
      const png = await encode(drawn(bitmap, width, height, false), 'image/png');
      if (png && png.size <= max) return png;
      output = 'image/jpeg'; // PNG trop lourd : repli en JPEG
    }
    const canvas = drawn(bitmap, width, height, true);
    for (const quality of [0.85, 0.7, 0.5]) {
      const jpeg = await encode(canvas, 'image/jpeg', quality);
      if (jpeg && jpeg.size <= max) return jpeg;
    }
    throw new Error(TOO_HEAVY);
  } finally {
    bitmap.close();
  }
}
