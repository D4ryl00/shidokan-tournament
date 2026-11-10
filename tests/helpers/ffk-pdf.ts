import { PDFDocument, StandardFonts } from 'pdf-lib';

export interface FakeFfkPdf {
  competition: string;
  entity: string;
  categories: { title: string; status?: 'En cours' | 'Inscrits'; fighters: string[] }[];
  /** Combattants par page (défaut 40). */
  rowsPerPage?: number;
  /** Pied de page collé : « - Page4 » au lieu de « - Page 4 ». */
  footerGlued?: boolean;
}

const PAGE_W = 595;
const PAGE_H = 842;
const ROW_H = 17;

/** Fabrique un PDF imitant « État des inscriptions » de la FFK (noms inventés). */
export async function buildFfkPdf(spec: FakeFfkPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const rowsPerPage = spec.rowsPerPage ?? 40;
  let pageNo = 0;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let top = 0;
  /** Écrit un texte à `x`, `y` points depuis le haut de la page. */
  const text = (s: string, x: number, y: number, size = 9) =>
    page.drawText(s, { x, y: PAGE_H - y, size, font });
  const footer = () => {
    const sep = spec.footerGlued ? '' : ' ';
    text(`10/11/2026 - Page${sep}${pageNo}`, 240, PAGE_H - 25);
  };
  const newPage = (withEntity: boolean) => {
    if (pageNo > 0) page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNo++;
    top = 50;
    if (withEntity) {
      text(spec.entity, 40, top, 10);
      top += 30;
    }
    footer();
  };

  // Page 1 : couverture.
  newPage(false);
  const total = spec.categories.reduce((n, c) => n + c.fighters.length, 0);
  text('ÉTAT DES INSCRIPTIONS', 200, top, 14);
  text(spec.competition, 40, top + 30, 11);
  text(`Inscrits : ${total}`, 40, top + 50);
  text(spec.entity, 40, top + 70);

  // Pages suivantes : une ligne par combattant, en-tête de tableau non répété.
  newPage(true);
  let rowsOnPage = 0;
  let index = 0;
  for (const cat of spec.categories) {
    if (top > PAGE_H - 140) newPage(true), (rowsOnPage = 0);
    text(cat.title, 40, top, 11);
    top += 18;
    if (cat.fighters.length === 0) {
      text('Aucune inscription', 40, top);
      top += 24;
      continue;
    }
    text(cat.status ?? 'Inscrits', 40, top);
    top += 16;
    text('N° Licencié', 40, top, 8);
    text('Nom Prénom', 120, top, 8);
    text('Ligue régionale', 360, top, 8);
    text('Rattachement', 520, top, 8);
    top += 16;
    for (const name of cat.fighters) {
      if (rowsOnPage >= rowsPerPage || top > PAGE_H - 60) {
        newPage(true);
        rowsOnPage = 0;
      }
      index++;
      text(`1000000${index}A`, 40, top);
      text(name, 120, top);
      text('LIGUE REGIONALE TEST', 360, top, 5);
      text(spec.entity.replace(/^\d+\s+/, ''), 520, top);
      text('COTE TEST DE', 360, top + 5.5, 5);
      text('KARATE ET DA', 360, top + 11, 5);
      top += ROW_H + 6;
      rowsOnPage++;
    }
    top += 10;
  }
  return pdf.save();
}
