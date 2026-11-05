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
  it('un message sans format est gardé tel quel', () => {
    const t = { subject: 'S', body: 'Bonjour <script>' };
    expect(cleanTemplate(t)).toEqual(t);
  });
});
