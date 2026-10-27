import { expect, test } from 'vitest';
import { DEFAULT_INVITATION_MAIL } from '../../src/domain/app-settings.js';
import { renderTemplate, textToHtml, type MailValues } from '../../src/domain/mail-template.js';

const VALUES: MailValues = {
  club: 'Tani Dojo', coach: 'Jean', competition: 'Coupe 2026', date: '22/11/2026', lieu: 'Nice', date_limite: '15/11/2026', lien: 'https://x/inscription/abc',
};

test('remplace toutes les variables, plusieurs fois ; variable inconnue laissée', () => {
  expect(renderTemplate('{club} {club} {coach} {competition} {date} {lieu} {date_limite} {lien} {autre}', VALUES)).toBe(
    'Tani Dojo Tani Dojo Jean Coupe 2026 22/11/2026 Nice 15/11/2026 https://x/inscription/abc {autre}',
  );
});

test('message par défaut rendu exactement', () => {
  expect(renderTemplate(DEFAULT_INVITATION_MAIL.subject, VALUES)).toBe('Inscriptions — Coupe 2026');
  expect(renderTemplate(DEFAULT_INVITATION_MAIL.body, VALUES)).toBe(
    [
      'Bonjour Jean,',
      '',
      'Les inscriptions à la compétition « Coupe 2026 » (22/11/2026, Nice) sont ouvertes.',
      "Inscrivez les combattants de Tani Dojo sur cette page, et revenez-y pour les modifier jusqu'au 15/11/2026 :",
      'https://x/inscription/abc',
      '',
      'Ce lien est personnel à votre club : ne le transmettez pas.',
      '',
      'Vous pouvez aussi inscrire vos élèves avec les fiches jointes à ce mail : la fiche à imprimer (PDF), à remplir à la main, ou le tableur (.ods, qui s’ouvre avec Excel ou LibreOffice), à remplir sur l’ordinateur. Renvoyez-la-nous en réponse à ce mail avant le 15/11/2026.',
      '',
      'Sportivement,',
      'Shidokan France',
    ].join('\n'),
  );
});

test('variables héritées ignorées : {constructor} et {__proto__} restent tels quels', () => {
  expect(renderTemplate('{constructor} {__proto__} {toString}', VALUES)).toBe('{constructor} {__proto__} {toString}');
});

test('version HTML : un paragraphe par bloc, retours à la ligne gardés, lien cliquable, texte échappé', () => {
  expect(textToHtml('Bonjour <Jean> & co,\n\nPage :\nhttps://x/inscription/a_b-c?x=1&y=2\nMerci.')).toBe(
    '<p>Bonjour &lt;Jean&gt; &amp; co,</p>\n'
      + '<p>Page :<br>\n<a href="https://x/inscription/a_b-c?x=1&amp;y=2">https://x/inscription/a_b-c?x=1&amp;y=2</a><br>\nMerci.</p>',
  );
});

test('version HTML : ponctuation après un lien laissée hors du lien ; lignes vides en trop ignorées', () => {
  expect(textToHtml('Voir https://x/a. Puis (https://x/b).\n\n\n\nFin\n')).toBe(
    '<p>Voir <a href="https://x/a">https://x/a</a>. Puis (<a href="https://x/b">https://x/b</a>).</p>\n<p>Fin</p>',
  );
});
