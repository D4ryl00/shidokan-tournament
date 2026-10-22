import * as XLSX from 'xlsx';

export class UnreadableFileError extends Error {
  constructor(message = 'Fichier illisible : formats acceptés .xlsx, .ods, .csv') {
    super(message);
  }
}

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

function decodeText(buf: Buffer): string {
  const text = buf.toString('utf8');
  // Un octet invalide en UTF-8 devient U+FFFD : c'est alors probablement du Windows-1252.
  return text.includes('�') ? new TextDecoder('windows-1252').decode(buf) : text.replace(/^﻿/, '');
}

/** Lit .xlsx, .ods (et .xls) ou .csv (séparateur et encodage détectés) en tableaux 2D de cellules. */
export function readWorkbook(buf: Buffer): { sheets: { name: string; cells: unknown[][] }[] } {
  if (buf.length === 0) throw new UnreadableFileError('Le fichier est vide.');
  let wb: XLSX.WorkBook;
  try {
    if (startsWith(buf, ZIP) || startsWith(buf, OLE)) {
      wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
    } else {
      if (buf.subarray(0, 4096).includes(0)) throw new UnreadableFileError();
      wb = XLSX.read(decodeText(buf), { type: 'string', cellDates: false, raw: true });
    }
  } catch (e) {
    if (e instanceof UnreadableFileError) throw e;
    throw new UnreadableFileError();
  }
  const sheets = wb.SheetNames.map((name) => ({
    name,
    cells: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: null, blankrows: true }),
  }));
  if (sheets.length === 0) throw new UnreadableFileError();
  return { sheets };
}
