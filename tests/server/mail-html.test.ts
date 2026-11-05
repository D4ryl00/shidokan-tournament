import { describe, expect, it } from 'vitest';
import { cleanMailHtml, cleanTemplate, renderMailHtml } from '../../src/server/mail-html.js';

const v = { club: 'A&B <b>"x"</b>', coach: 'Marie', competition: 'Coupe', date: '22/11/2026', lieu: 'Lyon', date_limite: '01/11/2026', lien: 'https://s.fr/inscription/abc' };

describe('filtre et construction du mail', () => {
  it('garde ce que permet l’éditeur et ne change pas un message déjà filtré', () => {
    const html = '<h1 style="text-align: center">T</h1><p><strong>g</strong> <em>i</em> <u>s</u> <span style="color: #c0392b">c</span> <mark>m</mark></p><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><blockquote><p>q</p></blockquote><p><a href="https://x.fr" target="_blank" rel="noopener noreferrer nofollow">l</a></p><p><img src="/api/mail-images/00000000-0000-4000-8000-000000000000" width="400" alt="a"></p>';
    const once = cleanMailHtml(html);
    expect(once.removed).toEqual([]);
    expect(cleanMailHtml(once.html).html).toBe(once.html);
    expect(once.html).toContain('text-align');
    expect(once.html).toContain('color');
    expect(once.imageIds).toEqual(['00000000-0000-4000-8000-000000000000']);
  });
  it('retire et signale ce qui n’est pas permis', () => {
    const r = cleanMailHtml('<script>x()</script><table><tr><td>t</td></tr></table><img src="https://e.fr/a.png"><img src="data:image/png;base64,AA"><a href="javascript:x()">j</a><p style="position:fixed;color:#000" onclick="x()">p</p><iframe src="https://e.fr"></iframe>');
    expect(r.html).not.toMatch(/script|<table|https:\/\/e\.fr|data:|javascript:|position|onclick|iframe/);
    expect(r.html).toContain('t');
    expect(r.removed).toEqual(expect.arrayContaining(['« script »', '« table »', 'image externe', 'lien non autorisé', '« iframe »']));
    expect(new Set(r.removed).size).toBe(r.removed.length);
  });
  it('refuse les adresses relatives et les images d’une autre adresse du serveur', () => {
    const r = cleanMailHtml('<a href="//evil.fr">a</a><a href="/x">b</a><img src="/api/other/00000000-0000-4000-8000-000000000000"><a href="JavaScript:x()">c</a>');
    expect(r.html).not.toMatch(/href|<img|evil/);
  });
  it('ne tolère aucune espace autour d’une adresse d’image ou de {lien}', () => {
    const img = cleanMailHtml('<img src=" /api/mail-images/00000000-0000-4000-8000-000000000000 "><a href=" {lien} ">x</a>');
    expect(img.html).not.toMatch(/<img|href/);
    expect(img.imageIds).toEqual([]);
    expect(img.removed).toEqual(expect.arrayContaining(['image externe', 'lien non autorisé']));
    const many = Array.from({ length: 11 }, (_, i) => `<img src=" /api/mail-images/00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')} ">`).join('');
    expect(cleanMailHtml(`<p>t</p>${many}`).html).not.toContain('<img');
  });
  it('échappe les valeurs dans le texte et dans une adresse de lien', () => {
    const { html, text } = renderMailHtml('<p>{club}</p><p><a href="{lien}">ici</a></p>', v);
    expect(html).toContain('A&amp;B &lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('href="https://s.fr/inscription/abc"');
    expect(text).toContain('A&B <b>"x"</b>');
    expect(text).toContain('ici (https://s.fr/inscription/abc)');
  });
  it('échappe une valeur placée dans une adresse', () => {
    const { html } = renderMailHtml('<p><a href="https://x.fr/?c={club}">ici</a></p>', v);
    expect(html).toContain('href="https://x.fr/?c=A&amp;B &lt;b&gt;&quot;x&quot;&lt;/b&gt;"');
  });
  it('{lien} donne toujours un lien valide, jamais un lien dans un lien', () => {
    const { html } = renderMailHtml('<p>{lien} et {lien}</p><p><a href="https://x.fr">{lien}</a></p>', v);
    expect((html.match(/<a /g) ?? []).length).toBe(3);
    expect(html).not.toMatch(/<a [^>]*>[^<]*<a /);
  });
  it('écrit les styles sur les éléments et garde les lignes vides', () => {
    const { html } = renderMailHtml('<h1>T</h1><p></p><blockquote><p>q</p></blockquote><p><mark>m</mark></p><p><img src="/api/mail-images/00000000-0000-4000-8000-000000000000" width="400" alt="a"></p>', v, (id) => `cid:${id}@shidokan`);
    expect(html).toMatch(/<h1 style="[^"]*font-size/);
    expect(html).toContain('<p>&nbsp;</p>');
    expect(html).toMatch(/<blockquote style="[^"]*border-left/);
    expect(html).toMatch(/<mark style="[^"]*background-color/);
    expect(html).toContain('src="cid:00000000-0000-4000-8000-000000000000@shidokan"');
    expect(html).toMatch(/<img [^>]*width="400"[^>]*style="[^"]*max-width: ?100%/);
  });
  it('donne une version texte lisible', () => {
    const { text } = renderMailHtml('<h2>T</h2><p>Bonjour {coach},</p><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><blockquote><p>q</p></blockquote><p><img src="/api/mail-images/00000000-0000-4000-8000-000000000000" alt="a"></p>', v);
    expect(text).toBe('T\n\nBonjour Marie,\n\n- a\n\n1. b\n\n> q');
  });
  it('refuse un message vide ou avec trop d’images', () => {
    expect(() => cleanTemplate({ subject: 'S', body: '<p></p>', format: 'html' })).toThrow('Le message est vide.');
    const imgs = Array.from({ length: 11 }, (_, i) => `<img src="/api/mail-images/00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}">`).join('');
    expect(() => cleanTemplate({ subject: 'S', body: imgs, format: 'html' })).toThrow('Au plus 10 images par message.');
  });
  it('accepte les couleurs nommées et hsl() ; une couleur inconnue du filtre reste signalée', () => {
    const r = cleanMailHtml('<p><span style="color: red">a</span> <span style="color: hsl(120, 50%, 40%)">b</span> <span style="color: hsla(120 50% 40% / 0.5)">c</span><mark style="background-color: navy">d</mark></p>');
    expect(r.removed).toEqual([]);
    expect(r.html).toBe('<p><span style="color:red">a</span> <span style="color:hsl(120, 50%, 40%)">b</span> <span style="color:hsla(120 50% 40% / 0.5)">c</span><mark style="background-color:navy">d</mark></p>');
    expect(cleanMailHtml(r.html).html).toBe(r.html);
    const refused = cleanMailHtml('<p><span style="color: var(--x)">a</span></p>');
    expect(refused.html).toBe('<p><span>a</span></p>');
    expect(refused.removed).toEqual(['style non permis']);
  });
  it('signale la taille, la police et les autres styles retirés', () => {
    const font = cleanMailHtml('<p><span style="font-size:30px;font-family:Arial">t</span></p>');
    expect(font.html).toBe('<p><span>t</span></p>');
    expect(font.removed).toEqual(['taille ou police']);
    expect(cleanMailHtml('<p style="position:fixed;color:#000">t</p>').removed).toEqual(['style non permis']);
    expect(cleanMailHtml('<p><strong style="color:#000">t</strong></p>').removed).toEqual(['style non permis']);
    expect(cleanMailHtml('<p style="text-align:center"><span style="color:#000">t</span></p>').removed).toEqual([]);
    expect(cleanMailHtml('<p style="">t</p>').removed).toEqual([]);
  });
  it('un div devient un paragraphe et h4-h6 un titre 3, sans être signalés', () => {
    const r = cleanMailHtml('<div>Ligne 1</div><div style="text-align:center">Ligne 2</div><h4>T4</h4><h5>T5</h5><h6>T6</h6>');
    expect(r.html).toBe('<p>Ligne 1</p><p style="text-align:center">Ligne 2</p><h3>T4</h3><h3>T5</h3><h3>T6</h3>');
    expect(r.removed).toEqual([]);
    expect(r.text).toBe('Ligne 1\n\nLigne 2\n\nT4\n\nT5\n\nT6');
    expect(cleanMailHtml(r.html).html).toBe(r.html);
  });
  it('un div qui ne fait que contenir des blocs disparaît : jamais un paragraphe dans un paragraphe', () => {
    const r = cleanMailHtml('<div dir="ltr"><div>Ligne 1</div><div><br></div><ul><li>a</li></ul></div>');
    expect(r.html).toBe('<p>Ligne 1</p><p><br /></p><ul><li>a</li></ul>');
    expect(r.removed).toEqual([]);
    expect(cleanMailHtml(r.html).html).toBe(r.html);
  });
  it('{lien} dans un lien à l’adresse refusée reste un lien personnel cliquable', () => {
    const { html, text } = renderMailHtml('<p><a href="tel:0102">{lien}</a></p><p><a href="javascript:x()"><strong>{lien}</strong></a></p>', v);
    expect(html).toBe('<p><a href="https://s.fr/inscription/abc">https://s.fr/inscription/abc</a></p><p><strong><a href="https://s.fr/inscription/abc">https://s.fr/inscription/abc</a></strong></p>');
    expect(text).toBe('https://s.fr/inscription/abc\n\nhttps://s.fr/inscription/abc');
  });
  it('un message déjà stocké avec un script est refiltré à la construction du mail', () => {
    const { html, text } = renderMailHtml('<p>Bonjour {club}</p><script>alert("x")</script><img src="https://e.fr/a.png" onerror="x()"><a href="javascript:x()" onclick="x()">j</a>', v);
    expect(html).not.toMatch(/script|alert|onerror|onclick|e\.fr|javascript/);
    expect(text).not.toContain('alert');
  });
  it('un message sans format est gardé tel quel', () => {
    const t = { subject: 'S', body: 'Bonjour <script>' };
    expect(cleanTemplate(t)).toEqual(t);
  });
});
