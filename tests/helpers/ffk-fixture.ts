import * as XLSX from 'xlsx';

export const FFK_HEADER = ['Nom', 'Prenom', 'Numero', 'Entite rattachement', 'Genre', 'Type', 'Age', 'Categorie', 'Discipline'];
export type FfkLine = (string | number | null)[];

/** Classeur au format de l'export FFK (un onglet par discipline), avec des données fictives. */
export function buildFfkWorkbook(sheets: Record<string, FfkLine[]>, bookType: 'xlsx' | 'ods' = 'xlsx'): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, lines] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([FFK_HEADER, ...lines]), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}

export const BLANK: FfkLine = [null, null, null, null, null, null, null, null, null];
