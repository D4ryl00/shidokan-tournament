import * as XLSX from 'xlsx';

/** En-tête de l'export FFK jusqu'en 2025-2026 : Nom avant Prénom, « Discipline » = règlement. */
export const FFK_HEADER = ['Nom', 'Prenom', 'Numero', 'Entite rattachement', 'Genre', 'Type', 'Age', 'Categorie', 'Discipline'];
/**
 * En-tête de l'export FFK 2026-2027 : Prénom avant Nom, « Technique » (non lue) à la place de « Discipline » ; le règlement des
 * seniors est écrit dans l'âge (« Séniors shobu ippon kumité »).
 */
export const FFK_HEADER_2026 = ['Prénom', 'Nom', 'Numero', 'Entite rattachement', 'Genre', 'Type', 'Age', 'Categorie', 'Technique'];
export type FfkLine = (string | number | null)[];

/** Classeur au format de l'export FFK (un onglet par discipline), avec des données fictives. */
export function buildFfkWorkbook(
  sheets: Record<string, FfkLine[]>,
  { bookType = 'xlsx', header = FFK_HEADER }: { bookType?: 'xlsx' | 'ods'; header?: string[] } = {},
): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, lines] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...lines]), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}

export const BLANK: FfkLine = [null, null, null, null, null, null, null, null, null];
