import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { RecapLine } from '../domain/club-recap.js';
import { safe, wrap } from './club-form-pdf.js';

/* Récapitulatif d'un club : A4 portrait, tableau Combattant / Inscrit / Au final. Origine pdf-lib en bas à gauche. */
const MM = 72 / 25.4;
const PAGE = { w: 210 * MM, h: 297 * MM };
const MARGIN = 15 * MM;
const BLACK = rgb(0, 0, 0);
const GREY_LINE = rgb(0.47, 0.47, 0.47);
const GREY_FILL = rgb(0.95, 0.95, 0.95);
const COLUMNS = [0.3, 0.35, 0.35];
const SIZE = 9;
const LEADING = 11;
const PAD = 1.5 * MM;
const HEAD_H = 7 * MM;

const frDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Garde `max` lignes au plus ; la dernière finit par « … » (rognée pour tenir dans `width`) si le texte est coupé. */
function clip(lines: string[], max: number, font: PDFFont, width: number): string[] {
  if (lines.length <= max) return lines;
  const out = lines.slice(0, max);
  let last = out[max - 1]!;
  while (last.length > 0 && font.widthOfTextAtSize(`${last}…`, SIZE) > width) last = last.slice(0, -1);
  out[max - 1] = `${last}…`;
  return out;
}

export interface ClubRecapInput { competition: { name: string; date: string }; club: string; generatedAt: Date; lines: RecapLine[] }

export async function buildClubRecapPdf({ competition, club, generatedAt, lines }: ClubRecapInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(await doc.embedFont(StandardFonts.Helvetica), `Récapitulatif des inscriptions — ${club}`));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.w - 2 * MARGIN;
  const xs = [MARGIN];
  for (const c of COLUMNS) xs.push(xs[xs.length - 1]! + width * c);
  const textW = (i: number) => xs[i + 1]! - xs[i]! - 2 * PAD;

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let top = PAGE.h - MARGIN;
  const text = (t: string, x: number, y: number, font: PDFFont, size = SIZE) => page.drawText(safe(font, t), { x, y, size, font, color: BLACK });

  const tableHead = () => {
    const h = HEAD_H;
    ['Combattant', 'Inscrit', 'Au final'].forEach((label, i) => {
      page.drawRectangle({ x: xs[i]!, y: top - h, width: xs[i + 1]! - xs[i]!, height: h, borderWidth: 0.7, borderColor: GREY_LINE, color: GREY_FILL });
      text(label, xs[i]! + PAD, top - h / 2 - 3, bold);
    });
    top -= h;
  };

  // En-tête du document, une seule fois.
  text('Récapitulatif des inscriptions', MARGIN, top - 16, bold, 16);
  top -= 16 + 6;
  const subtitle = `${competition.name} — ${frDate(competition.date)}`;
  for (const l of wrap(regular, 10, safe(regular, subtitle), width)) { text(l, MARGIN, top - 10, regular, 10); top -= 13; }
  for (const l of wrap(bold, 12, safe(bold, club), width)) { text(l, MARGIN, top - 12, bold, 12); top -= 15; }
  const date = generatedAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const time = generatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  text(`Créé le ${date} à ${time.replace(':', ' h ')}`, MARGIN, top - 9, regular, 9);
  top -= 9 + 8 * MM / 2;
  tableHead();

  for (const line of lines) {
    // « Changé » en gras, puis le motif entre parenthèses (replié sur le reste de la ligne).
    const reason = line.changed && line.reason ? wrap(regular, SIZE, safe(regular, `(${line.reason})`), textW(2) - bold.widthOfTextAtSize('Changé ', SIZE)) : [];
    // Une ligne ne dépasse jamais une page : au-delà, chaque colonne est tronquée et finit par « … ».
    const maxRows = Math.floor((PAGE.h - 2 * MARGIN - HEAD_H - 2 * PAD) / LEADING);
    const moved = line.session ? wrap(bold, SIZE, safe(bold, `Déplacé dans la session ${line.session}`), textW(2)) : [];
    // Au plus maxRows - 1 lignes de note (il reste toujours une ligne de « final ») ; la mention garde au moins une ligne.
    const budget = maxRows - 1;
    const reasonRows = line.changed ? Math.min(Math.max(1, reason.length), Math.max(1, budget - (moved.length ? 1 : 0))) : 0;
    const movedRows = Math.min(moved.length, Math.max(0, budget - reasonRows));
    const noteRows = reasonRows + movedRows;
    const name = clip(wrap(regular, SIZE, safe(regular, line.fighter), textW(0)), maxRows, regular, textW(0));
    const reg = clip(wrap(regular, SIZE, safe(regular, line.registered), textW(1)), maxRows, regular, textW(1));
    const fin = clip(wrap(regular, SIZE, safe(regular, line.final), textW(2)), Math.max(1, maxRows - noteRows), regular, textW(2));
    const rows = Math.max(name.length, reg.length, fin.length + noteRows);
    const h = rows * LEADING + 2 * PAD;
    if (top - h < MARGIN) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      top = PAGE.h - MARGIN;
      tableHead();
    }
    for (let i = 0; i < 3; i++) {
      page.drawRectangle({ x: xs[i]!, y: top - h, width: xs[i + 1]! - xs[i]!, height: h, borderWidth: 0.5, borderColor: GREY_LINE, ...(line.changed || line.session ? { color: GREY_FILL } : {}) });
    }
    const draw = (lines: string[], i: number, font: PDFFont, from = 0) =>
      lines.forEach((l, k) => text(l, xs[i]! + PAD, top - PAD - SIZE - (from + k) * LEADING + 2, font));
    draw(name, 0, regular);
    draw(reg, 1, regular);
    draw(fin, 2, regular);
    if (line.changed) {
      const y = (k: number) => top - PAD - SIZE - (fin.length + k) * LEADING + 2;
      text('Changé', xs[2]! + PAD, y(0), bold);
      clip(reason, reasonRows, regular, textW(2) - bold.widthOfTextAtSize('Changé ', SIZE)).forEach((l, k) =>
        text(l, xs[2]! + PAD + bold.widthOfTextAtSize('Changé ', SIZE), y(k), regular));
    }
    clip(moved, movedRows, bold, textW(2)).forEach((l, k) =>
      text(l, xs[2]! + PAD, top - PAD - SIZE - (fin.length + reasonRows + k) * LEADING + 2, bold));
    top -= h;
  }
  return doc.save();
}
