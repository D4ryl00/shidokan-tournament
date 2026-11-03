import { expect, test } from 'vitest';
import { sendSummary } from '../../src/web/send-summary.js';

test('tout est parti', () => {
  expect(sendSummary(1, 0)).toBe('1 mail envoyé : les liens déjà envoyés restent valables.');
  expect(sendSummary(3, 0)).toBe('3 mails envoyés : les liens déjà envoyés restent valables.');
});

test('rien n’est parti : pas de « 0 mail envoyé »', () => {
  expect(sendSummary(0, 1)).toBe('Aucun mail envoyé : 1 club en erreur, aucun lien ne lui a été ajouté ; corrigez puis renvoyez.');
  expect(sendSummary(0, 2)).toBe('Aucun mail envoyé : 2 clubs en erreur, aucun lien ne leur a été ajouté ; corrigez puis renvoyez.');
});

test('en partie : le nombre de clubs en erreur accordé', () => {
  expect(sendSummary(2, 1)).toBe('2 mails envoyés : les liens déjà envoyés restent valables. 1 club en erreur : aucun lien ne lui a été ajouté ; corrigez puis renvoyez.');
  expect(sendSummary(1, 3)).toBe('1 mail envoyé : les liens déjà envoyés restent valables. 3 clubs en erreur : aucun lien ne leur a été ajouté ; corrigez puis renvoyez.');
});
