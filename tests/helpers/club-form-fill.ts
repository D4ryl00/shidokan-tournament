import * as XLSX from 'xlsx';
import { CLUB_FORM_FIRST_ROW, CLUB_FORM_HEADER_FIRST_ROW } from '../../src/domain/club-form.js';

/** Remplit un modèle de fiche club (.ods) comme le ferait un coach, et renvoie le fichier .ods rempli. */
export function fillClubForm(template: Buffer, header: (string | null)[], lines: (string | number | null)[][]): Buffer {
  const wb = XLSX.read(template, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  header.forEach((v, i) => XLSX.utils.sheet_add_aoa(ws, [[v]], { origin: `B${CLUB_FORM_HEADER_FIRST_ROW + i}` }));
  XLSX.utils.sheet_add_aoa(ws, lines, { origin: `A${CLUB_FORM_FIRST_ROW}` });
  return XLSX.write(wb, { type: 'buffer', bookType: 'ods' }) as Buffer;
}
