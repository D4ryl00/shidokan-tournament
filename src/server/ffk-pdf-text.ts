import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export interface PdfTextItem {
  x: number;
  text: string;
}

/** Une ligne de texte : `y` en points depuis le haut de la page, items triés par x. */
export interface PdfTextLine {
  page: number;
  y: number;
  items: PdfTextItem[];
}

export class UnreadablePdfError extends Error {
  readonly statusCode = 400;
  constructor(message = 'Ce fichier n’est pas un PDF lisible.', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UnreadablePdfError';
  }
}

/** pdfjs n'a pas pu être chargé sur ce serveur : seule la lecture du PDF est refusée, le reste du serveur tourne. */
export class PdfReaderUnavailableError extends Error {
  readonly statusCode = 503;
  /** Message montré tel quel à l'écran malgré le statut 500+. */
  readonly expose = true;
  constructor(options?: { cause?: unknown }) {
    super('La lecture des PDF n’est pas disponible sur ce serveur.', options);
    this.name = 'PdfReaderUnavailableError';
  }
}

/** Un « État des inscriptions » d'un club tient en quelques pages : au-delà, le fichier n'en est pas un (ou il est piégé). */
export const MAX_PDF_PAGES = 50;

/** Écart maximal (en points) entre deux items d’une même ligne. */
const Y_TOLERANCE = 2;

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<Pdfjs> | null = null;

/**
 * pdfjs chargé à la première lecture, pas au démarrage : sans le module natif facultatif (`@napi-rs/canvas`), son chargement peut
 * échouer (`DOMMatrix is not defined`) et ne doit refuser que l'import du PDF. Un échec n'est pas gardé : la lecture suivante réessaie.
 */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs').catch((cause: unknown) => {
    pdfjs = null;
    throw new PdfReaderUnavailableError({ cause });
  });
  return pdfjs;
}

/** Polices standard de pdfjs (sinon il se plaint à chaque lecture de ne pas les trouver) ; chemin de fichier, lu par Node. */
let fontsDir: string | null = null;
const standardFontDataUrl = () => (fontsDir ??= join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/');

/** Lit toutes les pages, dans l’ordre de lecture (page, puis y croissant). */
export async function extractPdfLines(data: Uint8Array): Promise<PdfTextLine[]> {
  const { getDocument } = await loadPdfjs();
  // pdfjs consomme (détache) le tampon : on lui donne une copie.
  const task = getDocument({ data: new Uint8Array(data), useSystemFonts: false, standardFontDataUrl: standardFontDataUrl() });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (cause) {
      throw new UnreadablePdfError(undefined, { cause });
    }
    if (doc.numPages > MAX_PDF_PAGES) throw new UnreadablePdfError('Ce PDF a trop de pages pour un état des inscriptions d’un club.');
    const lines: PdfTextLine[] = [];
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const height = page.getViewport({ scale: 1 }).height;
        const content = await page.getTextContent();
        const pageLines: PdfTextLine[] = [];
        for (const item of content.items) {
          if (!('str' in item) || item.str.trim() === '') continue;
          const y = height - (item.transform[5] as number);
          const x = item.transform[4] as number;
          let line = pageLines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE);
          if (!line) {
            line = { page: n, y, items: [] };
            pageLines.push(line);
          }
          line.items.push({ x, text: item.str });
        }
        for (const l of pageLines) l.items.sort((a, b) => a.x - b.x);
        pageLines.sort((a, b) => a.y - b.y);
        lines.push(...pageLines);
      }
    } catch (cause) {
      throw new UnreadablePdfError(undefined, { cause });
    }
    return lines;
  } finally {
    // Détruit la tâche de chargement, document compris, même quand l'ouverture a échoué.
    await task.destroy().catch(() => undefined);
  }
}
