import * as XLSX from 'xlsx';
import { CLUB_FORM_COLUMNS_ROW, CLUB_FORM_FIRST_ROW, CLUB_FORM_HEADER_FIRST_ROW, CLUB_FORM_LEGACY_COLUMNS } from '../../src/domain/club-form.js';

/**
 * Remplit un modèle de fiche club (.ods) comme le ferait un coach, et renvoie le fichier .ods rempli.
 * `legacy` (défaut) : en-tête du tableau réécrit à l'ancien format, pour vérifier que les fiches déjà renvoyées restent lisibles.
 */
export function fillClubForm(template: Buffer, header: (string | null)[], lines: (string | number | null)[][], format: 'legacy' | 'new' = 'legacy'): Buffer {
  const wb = XLSX.read(template, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  header.forEach((v, i) => XLSX.utils.sheet_add_aoa(ws, [[v]], { origin: `B${CLUB_FORM_HEADER_FIRST_ROW + i}` }));
  if (format === 'legacy') XLSX.utils.sheet_add_aoa(ws, [[...CLUB_FORM_LEGACY_COLUMNS, null, null, null]], { origin: `A${CLUB_FORM_COLUMNS_ROW}` });
  XLSX.utils.sheet_add_aoa(ws, lines, { origin: `A${CLUB_FORM_FIRST_ROW}` });
  return XLSX.write(wb, { type: 'buffer', bookType: 'ods' }) as Buffer;
}
