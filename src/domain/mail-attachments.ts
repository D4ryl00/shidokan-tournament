// Pièces jointes du mail aux clubs : règles communes au serveur et à l'écran (types, tailles, noms).

const MB = 1024 * 1024;

/** 10 fichiers ajoutés par compétition, 10 Mo chacun, 15 Mo en tout (Gmail refuse un mail de plus de 25 Mo une fois encodé). */
export const MAIL_ATTACHMENT_LIMITS = { count: 10, fileBytes: 10 * MB, totalBytes: 15 * MB, nameLength: 150 } as const;

/** Extensions acceptées et type annoncé dans le mail. Les exécutables et scripts (bloqués par Gmail) n'y sont pas. */
const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
};

/** Extension en minuscules, sans le point ('' sans extension). */
const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
};

/** Type MIME selon l'extension (casse ignorée) ; null si l'extension n'est pas acceptée. */
export function attachmentContentType(fileName: string): string | null {
  return Object.hasOwn(CONTENT_TYPES, extensionOf(fileName)) ? CONTENT_TYPES[extensionOf(fileName)]! : null;
}

/** Nom du fichier de l'ordinateur : sans chemin ni caractères de contrôle, espaces autour retirés, raccourci en gardant l'extension. */
export function cleanAttachmentName(raw: string): string {
  const name = (raw.split(/[/\\]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const max = MAIL_ATTACHMENT_LIMITS.nameLength;
  if (name.length <= max) return name;
  const ext = extensionOf(name);
  const suffix = ext && ext.length < 20 ? name.slice(name.length - ext.length - 1) : '';
  return name.slice(0, max - suffix.length) + suffix;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Premier refus pour un nouveau fichier (`fileName` déjà nettoyé), null s'il est accepté. `existing` : les fichiers déjà ajoutés à la
 * compétition (cochés ou non) ; `reserved` : les noms des fiches club.
 */
export function checkNewAttachment(file: { fileName: string; size: number }, existing: { fileName: string; size: number }[], reserved: string[]): string | null {
  const L = MAIL_ATTACHMENT_LIMITS;
  if (file.size <= 0) return 'Fichier vide.';
  if (!attachmentContentType(file.fileName)) {
    const ext = extensionOf(file.fileName);
    return `Type de fichier non accepté : ${ext ? `.${ext}` : '(aucune)'} (acceptés : PDF, images, documents, tableurs, présentations, texte)`;
  }
  if (file.size > L.fileBytes) return 'Fichier trop gros : 10 Mo au plus.';
  if (existing.length >= L.count) return 'Au plus 10 pièces jointes.';
  if (existing.reduce((sum, f) => sum + f.size, 0) + file.size > L.totalBytes) return 'Pièces jointes trop lourdes : 15 Mo au plus en tout.';
  if ([...existing.map((f) => f.fileName), ...reserved].some((n) => sameName(n, file.fileName))) return 'Une pièce jointe porte déjà ce nom.';
  return null;
}

/** Noms des fiches club jointes au mail (et téléchargées depuis l'onglet Fiche club). */
export const clubFormFileNames = (date: string): { pdf: string; ods: string } => ({ pdf: `fiche-club-${date}.pdf`, ods: `fiche-club-${date}.ods` });

/** Taille lisible : « 900 o », « 12 Ko », « 3,4 Mo ». */
export function formatBytes(n: number): string {
  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');
  if (n < 1024) return `${n} o`;
  if (n < MB) return `${fmt(n / 1024)} Ko`;
  return `${fmt(n / MB)} Mo`;
}
