import JSZip from 'jszip';

/** Présentations de cellule (fiche club) : titre encadré, en-têtes grisés, cases à remplir bordées, notes. */
export type OdsCellStyle = 'title' | 'subtitle' | 'label' | 'header' | 'input' | 'note';

export interface OdsCell {
  value: string | number | null;
  bold?: boolean;
  /** Format texte : le tableur garde « +84 », « 32 » ou « 06… » tels quels. */
  text?: boolean;
  /** Nom d'une liste déclarée dans OdsSheet.validations. */
  validation?: string;
  style?: OdsCellStyle;
  /** Fusionne la cellule avec les suivantes de la ligne. */
  colSpan?: number;
  /** Place l'image de la feuille (OdsSheet.image) dans cette cellule. */
  logo?: boolean;
}
export interface OdsSheet {
  name: string;
  rows: OdsCell[][];
  columnWidthsCm?: number[];
  validations?: Record<string, string[]>;
  /** Hauteur de certaines lignes (index 0-based). */
  rowHeightsCm?: Record<number, number>;
  /** Hauteur par défaut des lignes à partir de l'index donné. */
  defaultRowHeightCm?: { from: number; heightCm: number };
  image?: { data: Buffer; widthCm: number; heightCm: number };
  /** Impression A4 paysage, ajustée à une page en largeur ; `repeatRow` : ligne d'en-tête répétée sur chaque page. */
  print?: { repeatRow?: number };
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
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
].join(' ');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BORDER = 'fo:border="0.75pt solid #555555"';
const MIDDLE = 'style:vertical-align="middle"';
const CELL_STYLES: Record<OdsCellStyle, string> = {
  title: `<style:table-cell-properties fo:border="2.25pt solid #000000" ${MIDDLE}/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="18pt" fo:font-weight="bold"/>`,
  subtitle: `<style:table-cell-properties ${MIDDLE}/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="11pt"/>`,
  label: `<style:table-cell-properties ${BORDER} fo:background-color="#f2f2f2" fo:wrap-option="wrap" ${MIDDLE}/><style:text-properties fo:font-size="9pt" fo:font-weight="bold"/>`,
  header: `<style:table-cell-properties ${BORDER} fo:background-color="#f2f2f2" fo:wrap-option="wrap" ${MIDDLE}/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt" fo:font-weight="bold"/>`,
  input: `<style:table-cell-properties ${BORDER} ${MIDDLE}/>`,
  note: `<style:table-cell-properties fo:wrap-option="wrap" ${MIDDLE}/><style:text-properties fo:font-size="9pt" fo:font-style="italic"/>`,
};

function validationName(sheet: number, list: string) {
  return `val_${sheet}_${list.replace(/[^A-Za-z0-9]/g, '_')}`;
}

function cellXml(cell: OdsCell, sheetIndex: number, sheet: OdsSheet): string {
  const attrs: string[] = [];
  // Les cases à remplir gardent le format texte (« +84 », « 06… ») en plus de leur présentation.
  if (cell.style) attrs.push(`table:style-name="ce_${cell.style}${cell.text ? '_txt' : ''}"`);
  else if (cell.bold) attrs.push('table:style-name="bold"');
  else if (cell.text) attrs.push('table:style-name="txt"');
  if (cell.validation) attrs.push(`table:content-validation-name="${validationName(sheetIndex, cell.validation)}"`);
  if (cell.colSpan && cell.colSpan > 1) attrs.push(`table:number-columns-spanned="${cell.colSpan}" table:number-rows-spanned="1"`);
  const covered = cell.colSpan && cell.colSpan > 1 ? '<table:covered-table-cell/>'.repeat(cell.colSpan - 1) : '';
  const logo =
    cell.logo && sheet.image
      ? `<draw:frame draw:z-index="0" draw:name="Logo" svg:width="${sheet.image.widthCm}cm" svg:height="${sheet.image.heightCm}cm" svg:x="0.1cm" svg:y="0.1cm"><draw:image xlink:href="Pictures/logo.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`
      : '';
  if (cell.value === null || cell.value === '') return `<table:table-cell ${attrs.join(' ')}>${logo}</table:table-cell>${covered}`;
  if (typeof cell.value === 'number') {
    return `<table:table-cell ${attrs.join(' ')} office:value-type="float" office:value="${cell.value}">${logo}<text:p>${cell.value}</text:p></table:table-cell>${covered}`;
  }
  return `<table:table-cell ${attrs.join(' ')} office:value-type="string">${logo}<text:p>${esc(cell.value)}</text:p></table:table-cell>${covered}`;
}

const cm = (n: number) => String(n).replace('.', '_');

function contentXml(sheets: OdsSheet[]): string {
  const columnStyles = new Map<number, string>();
  const rowStyles = new Map<number, string>();
  sheets.forEach((s) => {
    s.columnWidthsCm?.forEach((w) => columnStyles.set(w, `co_${cm(w)}`));
    Object.values(s.rowHeightsCm ?? {}).forEach((h) => rowStyles.set(h, `ro_${cm(h)}`));
    if (s.defaultRowHeightCm) rowStyles.set(s.defaultRowHeightCm.heightCm, `ro_${cm(s.defaultRowHeightCm.heightCm)}`);
  });
  const styles = [
    '<style:style style:name="ta1" style:family="table" style:master-page-name="Fiche"><style:table-properties table:display="true"/></style:style>',
    '<style:style style:name="bold" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style>',
    '<number:text-style style:name="N_TXT"><number:text-content/></number:text-style>',
    '<style:style style:name="txt" style:family="table-cell" style:data-style-name="N_TXT"/>',
    ...Object.entries(CELL_STYLES).flatMap(([name, props]) => [
      `<style:style style:name="ce_${name}" style:family="table-cell">${props}</style:style>`,
      `<style:style style:name="ce_${name}_txt" style:family="table-cell" style:data-style-name="N_TXT">${props}</style:style>`,
    ]),
    ...[...columnStyles].map(
      ([w, name]) => `<style:style style:name="${name}" style:family="table-column"><style:table-column-properties style:column-width="${w}cm"/></style:style>`,
    ),
    ...[...rowStyles].map(
      ([h, name]) => `<style:style style:name="${name}" style:family="table-row"><style:table-row-properties style:row-height="${h}cm" style:use-optimal-row-height="false"/></style:style>`,
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
    const rowXml = (r: OdsCell[], index: number) => {
      const h = s.rowHeightsCm?.[index] ?? (s.defaultRowHeightCm && index >= s.defaultRowHeightCm.from ? s.defaultRowHeightCm.heightCm : undefined);
      const style = h !== undefined ? ` table:style-name="${rowStyles.get(h)}"` : '';
      return `<table:table-row${style}>${r.map((c) => cellXml(c, i, s)).join('')}</table:table-row>`;
    };
    const rows = s.rows
      .map((r, index) => (s.print?.repeatRow === index ? `<table:table-header-rows>${rowXml(r, index)}</table:table-header-rows>` : rowXml(r, index)))
      .join('');
    const tableStyle = s.print ? ' table:style-name="ta1"' : '';
    return `<table:table table:name="${esc(s.name)}"${tableStyle}>${columns}${rows || '<table:table-row><table:table-cell/></table:table-row>'}</table:table>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.2"><office:automatic-styles>${styles.join('')}</office:automatic-styles><office:body><office:spreadsheet>${
    validations.length ? `<table:content-validations>${validations.join('')}</table:content-validations>` : ''
  }${tables.join('')}</office:spreadsheet></office:body></office:document-content>`;
}

function manifest(withImage: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${MIME}"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>${
    withImage ? '\n<manifest:file-entry manifest:full-path="Pictures/logo.png" manifest:media-type="image/png"/>' : ''
  }
</manifest:manifest>`;
}

/** Page A4 paysage, marges 1 cm, ajustée à une page en largeur (feuilles avec `print`). */
const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.2"><office:styles/><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="29.7cm" fo:page-height="21cm" style:print-orientation="landscape" fo:margin-top="1cm" fo:margin-bottom="1cm" fo:margin-left="1cm" fo:margin-right="1cm" style:scale-to-X="1" style:scale-to-Y="0"/><style:header-style/><style:footer-style/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Fiche" style:page-layout-name="pm1"><style:header style:display="false"/><style:footer style:display="false"/></style:master-page></office:master-styles></office:document-styles>`;

/** Classeur OpenDocument : mimetype non compressé en premier, puis manifeste, contenu, styles et image éventuelle. */
export async function writeOds(sheets: OdsSheet[]): Promise<Buffer> {
  const image = sheets.find((s) => s.image)?.image;
  const zip = new JSZip();
  zip.file('mimetype', MIME, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', manifest(!!image));
  zip.file('content.xml', contentXml(sheets));
  zip.file('styles.xml', STYLES);
  if (image) zip.file('Pictures/logo.png', image.data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: MIME });
}
