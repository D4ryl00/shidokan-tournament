import JSZip from 'jszip';

export interface OdsCell {
  value: string | number | null;
  bold?: boolean;
  /** Format texte : le tableur garde « +84 », « 32 » ou « 06… » tels quels. */
  text?: boolean;
  /** Nom d'une liste déclarée dans OdsSheet.validations. */
  validation?: string;
}
export interface OdsSheet {
  name: string;
  rows: OdsCell[][];
  columnWidthsCm?: number[];
  validations?: Record<string, string[]>;
}

const MIME = 'application/vnd.oasis.opendocument.spreadsheet';
const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
].join(' ');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function validationName(sheet: number, list: string) {
  return `val_${sheet}_${list.replace(/[^A-Za-z0-9]/g, '_')}`;
}

function cellXml(cell: OdsCell, sheetIndex: number): string {
  const attrs: string[] = [];
  if (cell.bold) attrs.push('table:style-name="bold"');
  else if (cell.text) attrs.push('table:style-name="txt"');
  if (cell.validation) attrs.push(`table:content-validation-name="${validationName(sheetIndex, cell.validation)}"`);
  if (cell.value === null || cell.value === '') return `<table:table-cell ${attrs.join(' ')}/>`;
  if (typeof cell.value === 'number') {
    return `<table:table-cell ${attrs.join(' ')} office:value-type="float" office:value="${cell.value}"><text:p>${cell.value}</text:p></table:table-cell>`;
  }
  return `<table:table-cell ${attrs.join(' ')} office:value-type="string"><text:p>${esc(cell.value)}</text:p></table:table-cell>`;
}

function contentXml(sheets: OdsSheet[]): string {
  const columnStyles = new Map<number, string>();
  sheets.forEach((s) => s.columnWidthsCm?.forEach((w) => columnStyles.set(w, `co_${String(w).replace('.', '_')}`)));
  const styles = [
    '<style:style style:name="bold" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style>',
    '<number:text-style style:name="N_TXT"><number:text-content/></number:text-style>',
    '<style:style style:name="txt" style:family="table-cell" style:data-style-name="N_TXT"/>',
    ...[...columnStyles].map(
      ([w, name]) => `<style:style style:name="${name}" style:family="table-column"><style:table-column-properties style:column-width="${w}cm"/></style:style>`,
    ),
  ];
  const validations = sheets.flatMap((s, i) =>
    Object.entries(s.validations ?? {}).map(([list, values]) => {
      const condition = `of:cell-content-is-in-list(${values.map((v) => `"${v.replace(/"/g, '""')}"`).join(';')})`;
      return `<table:content-validation table:name="${validationName(i, list)}" table:condition="${esc(condition)}" table:allow-empty-cell="true" table:display-list="unsorted"/>`;
    }),
  );
  const tables = sheets.map((s, i) => {
    const columns = (s.columnWidthsCm ?? []).map((w) => `<table:table-column table:style-name="${columnStyles.get(w)}"/>`).join('');
    const rows = s.rows.map((r) => `<table:table-row>${r.map((c) => cellXml(c, i)).join('')}</table:table-row>`).join('');
    return `<table:table table:name="${esc(s.name)}">${columns}${rows || '<table:table-row><table:table-cell/></table:table-row>'}</table:table>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2"><office:automatic-styles>${styles.join('')}</office:automatic-styles><office:body><office:spreadsheet>${
    validations.length ? `<table:content-validations>${validations.join('')}</table:content-validations>` : ''
  }${tables.join('')}</office:spreadsheet></office:body></office:document-content>`;
}

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${MIME}"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.2"><office:styles/></office:document-styles>`;

/** Classeur OpenDocument minimal : mimetype non compressé en premier, puis manifeste, contenu et styles. */
export async function writeOds(sheets: OdsSheet[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', MIME, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', MANIFEST);
  zip.file('content.xml', contentXml(sheets));
  zip.file('styles.xml', STYLES);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: MIME });
}
