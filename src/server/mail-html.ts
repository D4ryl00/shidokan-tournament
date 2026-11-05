import sanitizeHtml from 'sanitize-html';
import { parseDocument } from 'htmlparser2';
import { Element, Text, type ChildNode, type ParentNode } from 'domhandler';
import { MAIL_IMAGE_LIMITS, mailImageIdOfSrc, mailImageIdsIn } from '../domain/mail-images.js';
import { mailLinkAllowed, renderTemplate, type MailValues } from '../domain/mail-template.js';
import type { MailTemplate } from '../domain/mail-template-schema.js';

/** Refus d'un message : répond 400 avec un texte fait pour l'écran. */
export class MailHtmlError extends Error {
  readonly statusCode = 400;
}

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'mark', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'img'];
const IMAGE_PATH = /^\/api\/mail-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i,
  /^hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+%?\s*)?\)$/i,
  /^hsla?\(\s*[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%\s*(\/\s*[\d.]+%?\s*)?\)$/i,
  // Un mot seul : une couleur nommée de CSS (red, navy…), comme en colle Word ; un mot inconnu est simplement ignoré par la messagerie.
  /^[a-z]+$/i,
];
const ALLOWED_STYLES: Record<string, RegExp[]> = { 'text-align': [/^(left|center|right)$/], color: COLOR, 'background-color': COLOR };
const STYLED_TAGS = ['p', 'h1', 'h2', 'h3', 'span', 'mark'];
/** Balises courantes (Gmail, éditeurs de pages) rendues par la balise permise la plus proche, sans perdre leurs lignes : ce n'est pas un retrait. */
const RENAMED_TAGS = new Map([['div', 'p'], ['h4', 'h3'], ['h5', 'h3'], ['h6', 'h3']]);
const FONT_PROPERTIES = new Set(['font', 'font-size', 'font-family']);
const TABLE_TAGS = new Set(['tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup', 'col']);

const imageAllowed = (src: string) => IMAGE_PATH.test(src);

function walk(nodes: ChildNode[], visit: (el: Element) => void): void {
  for (const n of nodes) {
    if (n instanceof Element) {
      visit(n);
      walk(n.children, visit);
    }
  }
}

/** Libellés des déclarations de style que le filtre retire d'un élément, selon la balise qu'il devient. */
function styleLosses(tag: string, style: string | undefined): string[] {
  return (style ?? '')
    .split(';')
    .filter((d) => d.trim())
    .flatMap((d) => {
      const colon = d.indexOf(':');
      const prop = (colon < 0 ? d : d.slice(0, colon)).trim();
      const value = colon < 0 ? '' : d.slice(colon + 1).replace(/!important\s*$/i, '').trim();
      const kept = STYLED_TAGS.includes(tag) && Object.hasOwn(ALLOWED_STYLES, prop) && ALLOWED_STYLES[prop]!.some((re) => re.test(value));
      if (kept) return [];
      return [FONT_PROPERTIES.has(prop.toLowerCase()) ? 'taille ou police' : 'style non permis'];
    });
}

/** Ce que le filtre va retirer, en libellés lisibles et sans doublon. */
function removedIn(html: string): string[] {
  const removed = new Set<string>();
  walk(parseDocument(html).children, (el) => {
    const name = RENAMED_TAGS.get(el.name.toLowerCase()) ?? el.name.toLowerCase();
    if (ALLOWED_TAGS.includes(name)) for (const label of styleLosses(name, el.attribs.style)) removed.add(label);
    if (name === 'img') {
      if (!imageAllowed(el.attribs.src ?? '')) removed.add('image externe');
    } else if (name === 'a') {
      if (el.attribs.href !== undefined && !mailLinkAllowed(el.attribs.href)) removed.add('lien non autorisé');
    } else if (!ALLOWED_TAGS.includes(name)) {
      removed.add(`« ${TABLE_TAGS.has(name) ? 'table' : name} »`);
    }
  });
  return [...removed];
}

function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'width', 'alt'],
      ...Object.fromEntries(STYLED_TAGS.map((tag) => [tag, ['style']])),
      mark: ['style', 'data-color'],
    },
    allowedStyles: { '*': ALLOWED_STYLES },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'noscript'],
    // Les adresses relatives passent le contrôle des schémas : on les refuse ici.
    transformTags: {
      ...Object.fromEntries([...RENAMED_TAGS].map(([from, to]) => [from, sanitizeHtml.simpleTransform(to, {})])),
      a: (tagName, attribs) => {
        const out = { ...attribs };
        if (out.href !== undefined && !mailLinkAllowed(out.href)) delete out.href;
        if (out.target !== undefined && out.target !== '_blank') delete out.target;
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => {
        const out = { ...attribs };
        if (out.width !== undefined && !/^\d{1,4}$/.test(out.width)) delete out.width;
        return { tagName, attribs: out };
      },
      mark: (tagName, attribs) => {
        const out = { ...attribs };
        if (out['data-color'] !== undefined && !COLOR.some((re) => re.test(out['data-color']!))) delete out['data-color'];
        return { tagName, attribs: out };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !imageAllowed(frame.attribs.src ?? ''),
  });
}

// --- Version texte et rendu -------------------------------------------------------------------------------------

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'li']);
const isTag = (n: ChildNode, ...names: string[]): n is Element => n instanceof Element && names.includes(n.name);

function inlineText(nodes: ChildNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n instanceof Text) out += n.data;
    else if (n instanceof Element) {
      if (n.name === 'br') out += '\n';
      else if (n.name === 'img') continue;
      else if (n.name === 'a') {
        const label = inlineText(n.children);
        const href = n.attribs.href ?? '';
        out += !href || label.trim() === href || `mailto:${label.trim()}` === href ? label : `${label} (${href})`;
      } else out += inlineText(n.children);
    }
  }
  return out;
}

const tidy = (s: string) => s.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();

/** Blocs de texte d'une suite de nœuds : un paragraphe, un titre, une liste ou une citation chacun. */
function textBlocks(nodes: ChildNode[]): string[] {
  const blocks: string[] = [];
  let inline: ChildNode[] = [];
  const flush = () => {
    const t = tidy(inlineText(inline));
    if (t) blocks.push(t);
    inline = [];
  };
  for (const n of nodes) {
    if (!(n instanceof Element) || !BLOCK_TAGS.has(n.name)) {
      inline.push(n);
      continue;
    }
    flush();
    if (n.name === 'ul' || n.name === 'ol') {
      const items = n.children.filter((c): c is Element => isTag(c, 'li')).map((li) => textBlocks(li.children).join(' ')).filter(Boolean);
      if (items.length) blocks.push(items.map((t, i) => `${n.name === 'ol' ? `${i + 1}.` : '-'} ${t}`).join('\n'));
    } else if (n.name === 'blockquote') {
      const inner = textBlocks(n.children);
      if (inner.length) blocks.push(inner.map((b) => b.split('\n').map((l) => `> ${l}`).join('\n')).join('\n>\n'));
    } else {
      const t = tidy(inlineText(n.children));
      if (t) blocks.push(t);
    }
  }
  flush();
  return blocks;
}

const textOf = (nodes: ChildNode[]) => textBlocks(nodes).join('\n\n');

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function serialize(nodes: ChildNode[]): string {
  return nodes
    .map((n) => {
      if (n instanceof Text) return escapeText(n.data);
      if (!(n instanceof Element)) return '';
      const attrs = Object.entries(n.attribs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
      return n.name === 'br' || n.name === 'img' ? `<${n.name}${attrs}>` : `<${n.name}${attrs}>${serialize(n.children)}</${n.name}>`;
    })
    .join('');
}

/** Retire les `div` qui contiennent des blocs : de simples conteneurs (Gmail en met partout) ; dit si quelque chose a changé. */
function unwrapContainerDivs(parent: ParentNode): boolean {
  let changed = false;
  parent.children = parent.children.flatMap((n) => {
    if (!(n instanceof Element)) return [n];
    changed = unwrapContainerDivs(n) || changed;
    if (n.name !== 'div' || !n.children.some((c) => c instanceof Element && (RENAMED_TAGS.has(c.name) || BLOCK_TAGS.has(c.name)))) return [n];
    changed = true;
    return n.children;
  });
  parent.children.forEach((c) => (c.parent = parent));
  return changed;
}

/** Filtre sans `div` conteneur : devenu `p`, il mettrait un paragraphe dans un paragraphe, que le navigateur rouvre avec des lignes vides. */
function sanitizeBlocks(html: string): string {
  const doc = parseDocument(html);
  return sanitize(unwrapContainerDivs(doc) ? serialize(doc.children) : html);
}

/** Filtre un message : ne garde que ce que l'éditeur sait produire. `removed` dit ce qui a été retiré de l'entrée. */
export function cleanMailHtml(html: string): { html: string; removed: string[]; text: string; imageIds: string[] } {
  const clean = sanitizeBlocks(html);
  return { html: clean, removed: removedIn(html), text: textOf(parseDocument(clean).children), imageIds: mailImageIdsIn(clean) };
}

/** Filtre un message à l'enregistrement. Un message en texte brut (sans `format`) est gardé tel quel. */
export function cleanTemplate(t: MailTemplate): MailTemplate {
  if (t.format !== 'html') return t;
  const { html, text, imageIds } = cleanMailHtml(t.body);
  if (!text.trim() && !imageIds.length) throw new MailHtmlError('Le message est vide.');
  if (imageIds.length > MAIL_IMAGE_LIMITS.perMessage) throw new MailHtmlError(`Au plus ${MAIL_IMAGE_LIMITS.perMessage} images par message.`);
  return { ...t, body: html };
}

const DEFAULT_STYLES: Record<string, string> = {
  h1: 'font-size: 24px; margin: 16px 0 8px',
  h2: 'font-size: 20px; margin: 14px 0 8px',
  h3: 'font-size: 16px; margin: 12px 0 8px',
  blockquote: 'border-left: 4px solid #cccccc; margin: 8px 0; padding: 4px 12px; color: #555555',
  mark: 'background-color: #ffe066',
  img: 'max-width: 100%; height: auto',
};

/** Style d'un élément : ses propres déclarations d'abord, les valeurs par défaut pour ce qui manque. */
function withDefaults(own: string | undefined, defaults: string): string {
  const prop = (d: string) => d.split(':')[0]!.trim().toLowerCase();
  const have = new Set((own ?? '').split(';').map(prop).filter(Boolean));
  const added = defaults.split(';').map((d) => d.trim()).filter((d) => d && !have.has(prop(d)));
  return [...(own ?? '').split(';').map((d) => d.trim()).filter(Boolean), ...added].join('; ');
}

const VARIABLE = /(\{[a-z_]+\})/;

function anchor(url: string): Element {
  return new Element('a', { href: url }, [new Text(url)]);
}

/** Remplace les variables dans les nœuds texte et dans `href` ; `{lien}` hors d'un lien devient un lien. */
function fill(parent: ParentNode, values: MailValues, inLink: boolean): void {
  const next: ChildNode[] = [];
  for (const n of parent.children) {
    if (n instanceof Text) {
      for (const part of n.data.split(VARIABLE)) {
        if (part === '{lien}' && !inLink) next.push(anchor(values.lien));
        else if (part) next.push(new Text(renderTemplate(part, values)));
      }
    } else {
      if (n instanceof Element) {
        if (n.attribs.href !== undefined) n.attribs.href = renderTemplate(n.attribs.href, values);
        fill(n, values, inLink || n.name === 'a');
      }
      next.push(n);
    }
  }
  parent.children = next;
  next.forEach((c) => (c.parent = parent));
}

/** Retire les `a` sans adresse (une adresse refusée par le filtre) en gardant leur contenu. */
function unwrapBareLinks(parent: ParentNode): void {
  parent.children = parent.children.flatMap((n) => {
    if (!(n instanceof Element)) return [n];
    unwrapBareLinks(n);
    return n.name === 'a' && !n.attribs.href ? n.children : [n];
  });
  parent.children.forEach((c) => (c.parent = parent));
}

function style(parent: ParentNode, imageSrc?: (id: string) => string): void {
  for (const n of parent.children) {
    if (!(n instanceof Element)) continue;
    style(n, imageSrc);
    const inItem = n.name === 'p' && n.parent instanceof Element && n.parent.name === 'li';
    const defaults = inItem ? 'margin: 0' : DEFAULT_STYLES[n.name];
    if (defaults) n.attribs.style = withDefaults(n.attribs.style, defaults);
    if (n.name === 'img' && imageSrc) {
      const id = mailImageIdOfSrc(n.attribs.src ?? '');
      if (id) n.attribs.src = imageSrc(id);
    }
    if (n.name === 'p' && !n.children.some((c) => c instanceof Element || (c instanceof Text && c.data.trim()))) n.children = [new Text(' ')];
  }
}

/**
 * Version HTML et texte d'un message pour un club : variables remplacées (valeurs échappées), styles écrits sur les éléments
 * (les messageries ignorent les feuilles de style), images adressées par `imageSrc`.
 */
export function renderMailHtml(html: string, values: MailValues, imageSrc?: (id: string) => string): { html: string; text: string } {
  const doc = parseDocument(cleanMailHtml(html).html);
  // Avant `fill` : `{lien}` dans un lien à l'adresse refusée n'est plus « dans un lien », il devient le lien personnel.
  unwrapBareLinks(doc);
  fill(doc, values, false);
  const text = textOf(doc.children);
  style(doc, imageSrc);
  return { html: serialize(doc.children), text };
}
