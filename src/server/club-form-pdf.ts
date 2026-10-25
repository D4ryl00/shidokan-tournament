import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { ageBandAbbreviations } from '../domain/club-form.js';
import type { Competition } from '../domain/competition.js';
import type { CategoryGrid } from '../domain/types.js';
import { closedSummary, offeredAgeBands } from '../domain/closed-categories.js';
import { logoPng } from './club-form-template.js';

/*
 * Fiche de pré-inscription papier : une page A4 paysage, dessinée au point près (1 mm = 2,835 pt),
 * identique quel que soit le navigateur ou l'imprimante. Coordonnées pdf-lib : origine en bas à gauche.
 */
const MM = 72 / 25.4;
const PAGE = { w: 297 * MM, h: 210 * MM };
const MARGIN = 10 * MM;
const ROWS = 10;
const BLACK = rgb(0, 0, 0);
const GREY_LINE = rgb(0.47, 0.47, 0.47);
const GREY_FILL = rgb(0.95, 0.95, 0.95);
const COLUMNS = [10.5, 9, 4.5, 18.5, 5.5, 15.5, 6, 6.5, 10.5, 13.5];

const frDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont }

/** Texte encodable par les polices standard (WinAnsi) : un caractère hors jeu devient « ? ». */
function safe(font: PDFFont, s: string): string {
  const ok = new Set(font.getCharacterSet());
  return [...s].map((c) => (ok.has(c.codePointAt(0)!) ? c : '?')).join('');
}

/** Découpe un texte en lignes de largeur maximale `width`. */
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function rect(page: PDFPage, x: number, y: number, w: number, h: number, opts: { border?: number; color?: ReturnType<typeof rgb>; fill?: ReturnType<typeof rgb> } = {}) {
  page.drawRectangle({ x, y, width: w, height: h, borderWidth: opts.border ?? 0.7, borderColor: opts.color ?? GREY_LINE, ...(opts.fill ? { color: opts.fill } : {}) });
}

/** Une suite « ☐ libellé » sur une ligne, à partir de (x, y) — y = ligne de base du texte. */
function checks(page: PDFPage, f: Fonts, x: number, y: number, labels: string[], size = 8.5, box = 2.8 * MM): number {
  let cx = x;
  for (const label of labels) {
    rect(page, cx, y - 0.4 * MM, box, box, { color: BLACK, border: 0.8 });
    cx += box + 0.8 * MM;
    page.drawText(safe(f.regular, label), { x: cx, y, size, font: f.regular, color: BLACK });
    cx += f.regular.widthOfTextAtSize(safe(f.regular, label), size) + 2 * MM;
  }
  return cx;
}

/** Texte centré (plusieurs lignes) dans une case d'en-tête. */
function centered(page: PDFPage, font: PDFFont, size: number, text: string, x: number, y: number, w: number, h: number, align: 'middle' | 'bottom' = 'middle') {
  const lines = wrap(font, size, safe(font, text), w - 2 * MM);
  const lh = size * 1.15;
  const block = lines.length * lh;
  let top = align === 'middle' ? y + (h + block) / 2 - size * 0.85 : y + block - size * 0.85 + 1.2 * MM;
  for (const l of lines) {
    page.drawText(l, { x: x + (w - font.widthOfTextAtSize(l, size)) / 2, y: top, size, font, color: BLACK });
    top -= lh;
  }
}

/** Fiche papier vierge (PDF) d'une compétition : tranches d'âge proposées aux clubs seulement. */
export async function buildClubFormPdf(competition: Competition, grid: CategoryGrid, closed: ReadonlySet<string>): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Fiche de pré-inscription — ${competition.name}`);
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const left = MARGIN;
  const width = PAGE.w - 2 * MARGIN;
  let top = PAGE.h - MARGIN;

  // En-tête : logos aux deux coins, titre encadré
  const logoSize = 18 * MM;
  const png = logoPng();
  if (png) {
    const logo = await doc.embedPng(png);
    page.drawImage(logo, { x: left, y: top - logoSize, width: logoSize, height: logoSize });
    page.drawImage(logo, { x: left + width - logoSize, y: top - logoSize, width: logoSize, height: logoSize });
  }
  const titleX = left + logoSize + 4 * MM;
  const titleW = width - 2 * (logoSize + 4 * MM);
  const subtitle = [competition.name, frDate(competition.date), competition.location].filter(Boolean).join(' — ');
  const subLines = wrap(f.regular, 9, safe(f.regular, subtitle), titleW - 6 * MM).slice(0, 2);
  const titleH = Math.max(18 * MM, 15 * 1.2 + subLines.length * 11 + 3 * MM);
  page.drawRectangle({ x: titleX, y: top - titleH, width: titleW, height: titleH, borderWidth: 2.2, borderColor: BLACK });
  const titleText = 'FICHE DE PRÉ-INSCRIPTION';
  const blockH = 15 + subLines.length * 11;
  let ty = top - (titleH - blockH) / 2 - 13;
  page.drawText(titleText, { x: titleX + (titleW - f.bold.widthOfTextAtSize(titleText, 15)) / 2, y: ty, size: 15, font: f.bold });
  for (const l of subLines) {
    ty -= 12;
    page.drawText(l, { x: titleX + (titleW - f.regular.widthOfTextAtSize(l, 9)) / 2, y: ty, size: 9, font: f.regular });
  }
  top -= Math.max(logoSize, titleH) + 3 * MM;

  // Club et coach
  const gap = 3 * MM;
  const fr = (width - 2 * gap) / 3.3;
  const colX = [left, left + 1.3 * fr + gap, left + 2.3 * fr + 2 * gap];
  const colW = [1.3 * fr, fr, fr];
  const boxH = 7 * MM;
  const field = (x: number, y: number, w: number, label: string) => {
    rect(page, x, y - boxH, w, boxH);
    page.drawText(label, { x: x + 2 * MM, y: y - boxH / 2 - 3, size: 9.5, font: f.bold });
  };
  field(colX[0]!, top, colW[0]!, 'Club :');
  field(colX[1]!, top, colW[1]!, 'Coach :');
  field(colX[2]!, top, colW[2]!, 'Téléphone :');
  top -= boxH + 1.5 * MM;
  field(colX[0]!, top, colW[0]!, 'E-mail :');
  const accept = 'Le coach accepte d’avance les reclassements de ses combattants :';
  field(colX[1]!, top, colW[1]! + gap + colW[2]!, accept);
  checks(page, f, colX[1]! + 2 * MM + f.bold.widthOfTextAtSize(accept, 9.5) + 2 * MM, top - boxH / 2 - 3, ['Oui', 'Non'], 9.5);
  top -= boxH + 3 * MM;

  // Catégories non ouvertes : un encadré sous l'en-tête du club (rien si tout est ouvert).
  const summary = closedSummary(grid, closed);
  if (summary.length) {
    const lead = 'Non ouvert à cette compétition : ';
    // Coupé en police normale : on retire la largeur gagnée par le début en gras.
    const boldExtra = f.bold.widthOfTextAtSize(lead, 8.5) - f.regular.widthOfTextAtSize(lead, 8.5);
    const lines = wrap(f.regular, 8.5, safe(f.regular, `${lead}${summary.join(' · ')}`), width - 4 * MM - boldExtra);
    const h = lines.length * 10.5 + 2.5 * MM;
    rect(page, left, top - h, width, h, { border: 1.2 });
    let ly = top - 1.25 * MM - 8;
    lines.forEach((l, i) => {
      // Le début (« Non ouvert à cette compétition : ») en gras, le reste normal.
      if (i === 0 && l.startsWith(lead)) {
        page.drawText(lead, { x: left + 2 * MM, y: ly, size: 8.5, font: f.bold });
        page.drawText(l.slice(lead.length), { x: left + 2 * MM + f.bold.widthOfTextAtSize(lead, 8.5), y: ly, size: 8.5, font: f.regular });
      } else page.drawText(l, { x: left + 2 * MM, y: ly, size: 8.5, font: f.regular });
      ly -= 10.5;
    });
    top -= h + 2 * MM;
  }

  // Tableau : en-tête sur deux rangées, 10 lignes
  const xs: number[] = [left];
  for (const p of COLUMNS) xs.push(xs[xs.length - 1]! + (width * p) / 100);
  const cw = (i: number) => xs[i + 1]! - xs[i]!;
  const h1 = 9 * MM;
  const h2 = 6.5 * MM;
  const both = new Set([0, 1, 2, 4, 6]);
  const head1 = ['Nom', 'Prénom', 'Sexe', 'Catégorie d’âge', 'Poids actuel (kg)', 'Disciplines', 'Grade (si kata)', 'Règlement', 'Si reclassement', 'Shobu : si reclassement, garder en priorité'];
  const head2: Record<number, string> = {
    3: 'une seule case', 5: 'kata et/ou une discipline de combat', 7: 'combat', 8: 'autres disciplines, numéroter 1, 2', 9: 'une seule case',
  };
  for (let i = 0; i < COLUMNS.length; i++) {
    const h = both.has(i) ? h1 + h2 : h1;
    rect(page, xs[i]!, top - h, cw(i), h, { fill: GREY_FILL, color: rgb(0.2, 0.2, 0.2), border: 0.85 });
    centered(page, f.bold, 8.5, head1[i]!, xs[i]!, top - h, cw(i), h, both.has(i) ? 'bottom' : 'middle');
    if (!both.has(i)) {
      rect(page, xs[i]!, top - h1 - h2, cw(i), h2, { fill: GREY_FILL, color: rgb(0.2, 0.2, 0.2), border: 0.85 });
      centered(page, f.italic, 7, head2[i]!, xs[i]!, top - h1 - h2, cw(i), h2);
    }
  }
  top -= h1 + h2;

  const bands = offeredAgeBands(grid, closed);
  const abbreviations = ageBandAbbreviations(bands);
  const ageRows = bands.length > 12 ? 3 : 2;
  const ageCols = Math.max(1, Math.ceil(bands.length / ageRows));

  // Bas de page : légende, priorité shobu, numéro de page à remplir (calculé d'abord : les lignes prennent la place qui reste).
  const legend = bands
    .map((b) => {
      const abbr = abbreviations.get(b.code)!;
      const ages = b.maxAge === null ? `${b.minAge}+` : `${b.minAge}-${b.maxAge}`;
      return /^V\d$/.test(abbr) ? `${abbr} (${ages})` : `${abbr} ${b.label.toLowerCase()} (${ages})`;
    })
    .join(' · ');
  const pageLabel = 'Page …… / ……';
  const footW = width - f.bold.widthOfTextAtSize(pageLabel, 8) - 6 * MM;
  const foot = [
    ...wrap(f.regular, 8, safe(f.regular, `Âges : ${legend}.`), footW),
    ...wrap(f.regular, 8, 'Shobu, garder en priorité : « les règles shobu » = changer de discipline plutôt que passer en jiyu ; « la discipline » = passer en jiyu plutôt que changer de discipline. Boxing = shido-boxing, Mix = shido-mix martial.', footW),
  ];
  // Toujours une seule page : les lignes rapetissent si l'encadré des catégories non ouvertes prend de la place.
  const rowH = Math.min(11.5 * MM, (top - MARGIN - 1.5 * MM - foot.length * 9.6) / ROWS);
  for (let r = 0; r < ROWS; r++) {
    const y = top - rowH;
    for (let i = 0; i < COLUMNS.length; i++) rect(page, xs[i]!, y, cw(i), rowH);
    const line1 = y + rowH / 2 + 1.2 * MM;
    const line2 = y + rowH / 2 - 3.2 * MM;
    const pad = 1.2 * MM;
    checks(page, f, xs[2]! + pad, line1, ['F']);
    checks(page, f, xs[2]! + pad, line2, ['M']);
    // Catégories d'âge : une grille de cases
    const ageSize = ageRows > 2 ? 7 : 8;
    const ageBox = ageRows > 2 ? 2.4 * MM : 2.8 * MM;
    const ageStep = (rowH - 1.5 * MM) / ageRows;
    bands.forEach((b, k) => {
      const col = k % ageCols;
      const row = Math.floor(k / ageCols);
      const ax = xs[3]! + pad + (col * (cw(3) - 2 * pad)) / ageCols;
      const ay = y + rowH - 0.75 * MM - (row + 1) * ageStep + (ageStep - ageSize) / 2 + 0.6;
      checks(page, f, ax, ay, [abbreviations.get(b.code)!], ageSize, ageBox);
    });
    checks(page, f, xs[5]! + pad, line1, ['Karaté', 'Boxing', 'Mix']);
    checks(page, f, xs[5]! + pad, line2, ['Triathlon', 'Kata']);
    checks(page, f, xs[7]! + pad, line1, ['Jiyu']);
    checks(page, f, xs[7]! + pad, line2, ['Shobu']);
    checks(page, f, xs[8]! + pad, line1, ['Karaté', 'Box.'], 8.5, 3.6 * MM);
    checks(page, f, xs[8]! + pad, line2, ['Mix'], 8.5, 3.6 * MM);
    checks(page, f, xs[9]! + pad, line1, ['1. les règles shobu']);
    checks(page, f, xs[9]! + pad, line2, ['2. la discipline']);
    top = y;
  }

  let fy = top - 1.5 * MM - 8;
  for (const l of foot) {
    page.drawText(l, { x: left, y: fy, size: 8, font: f.regular });
    fy -= 9.6;
  }
  page.drawText(pageLabel, { x: left + width - f.bold.widthOfTextAtSize(pageLabel, 8), y: fy + 9.6, size: 8, font: f.bold });

  return Buffer.from(await doc.save());
}
