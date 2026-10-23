import { expect, test } from 'vitest';
import { DEFAULT_INVITATION_MAIL } from '../../src/domain/app-settings.js';
import { renderTemplate, type MailValues } from '../../src/domain/mail-template.js';

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
      'Sportivement,',
      'Shidokan France',
    ].join('\n'),
  );
});
