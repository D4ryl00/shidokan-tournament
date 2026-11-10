import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

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
  constructor() {
    super('Ce fichier n’est pas un PDF lisible.');
    this.name = 'UnreadablePdfError';
  }
}

/** Écart maximal (en points) entre deux items d’une même ligne. */
const Y_TOLERANCE = 2;

/** Lit toutes les pages, dans l’ordre de lecture (page, puis y croissant). */
export async function extractPdfLines(data: Uint8Array): Promise<PdfTextLine[]> {
  try {
    // pdfjs consomme (détache) le tampon : on lui donne une copie.
    const doc = await getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise;
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
    } finally {
      await doc.destroy();
    }
    return lines;
  } catch {
    throw new UnreadablePdfError();
  }
}
