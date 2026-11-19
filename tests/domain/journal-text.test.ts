import { expect, test } from 'vitest';
import { ffkImportDetail, journalDetailLine, journalSearchText, journalText } from '../../src/domain/journal/text.js';
import { actorLabel } from '../../src/domain/journal/types.js';

test('combattant modifié : titre, changements', () => {
  const t = journalText({ action: 'fighter-changed', data: { subject: 'DUPONT Léa (Shidokan Lyon)', changes: [{ label: 'Grade', before: '2e kyu', after: '1er kyu' }] } });
  expect(t.title).toBe('DUPONT Léa (Shidokan Lyon) · modifié');
  expect(t.changes).toEqual([{ label: 'Grade', before: '2e kyu', after: '1er kyu' }]);
});
test.each([
  ['fighter-added', 'DUPONT Léa (Shidokan Lyon) · ajouté'],
  ['fighter-removed', 'DUPONT Léa (Shidokan Lyon) · supprimé'],
  ['presence', 'DUPONT Léa (Shidokan Lyon) · présence'],
])('titre de %s', (action, title) => expect(journalText({ action, data: { subject: 'DUPONT Léa (Shidokan Lyon)' } } as never).title).toBe(title));
test('poids : saisi ou corrigé selon l’avant', () => {
  expect(journalText({ action: 'weigh-in', data: { subject: 'MARTIN Hugo', changes: [{ label: 'Poids', before: null, after: '53,1 kg' }] } }).title).toBe('MARTIN Hugo · poids saisi');
  expect(journalText({ action: 'weigh-in', data: { subject: 'MARTIN Hugo', changes: [{ label: 'Poids', before: '52,4 kg', after: '53,1 kg' }] } }).title).toBe('MARTIN Hugo · poids corrigé');
});
test('entrée brute', () => expect(journalText({ action: 'raw', data: { method: 'PUT', route: '/api/competitions/:id/wave-schedules' } }).title)
  .toBe('Opération non détaillée : PUT /api/competitions/:id/wave-schedules'));
test('autres actions', () => {
  expect(journalText({ action: 'competition-created', data: {} }).title).toBe('Compétition créée');
  expect(journalText({ action: 'journal-opened', data: {} })).toEqual({ title: 'Journal ouvert', detail: 'Ce qui a été fait avant n’y figure pas.', changes: [] });
  expect(journalText({ action: 'weigh-in-closed', data: {} }).title).toBe('Pesée close');
  expect(journalText({ action: 'weigh-in-closed', data: { subject: 'Zone 1', detail: 'x' } })).toEqual({ title: 'Pesée close · Zone 1', detail: 'x', changes: [] });
});
test('autorisation d’un coach : accordée, retirée', () => {
  const data = { subject: 'DUPONT Léa (Shidokan Lyon)', detail: 'Poids · Écart de poids estimé avec ses adversaires : 7 kg maximum.' };
  expect(journalText({ action: 'accordee', data })).toEqual({ title: 'DUPONT Léa (Shidokan Lyon) · autorisation accordée', detail: data.detail, changes: [] });
  expect(journalText({ action: 'retiree', data }).title).toBe('DUPONT Léa (Shidokan Lyon) · autorisation retirée');
});
test('qui', () => {
  expect(actorLabel({ kind: 'poste', poste: 'zone', zoneName: 'Zone 2' })).toBe('poste Zone 2');
  expect(actorLabel({ kind: 'poste', poste: 'table' })).toBe('poste Table centrale');
  expect(actorLabel({ kind: 'poste', poste: 'organisation' })).toBe('poste Organisation');
  expect(actorLabel({ kind: 'poste', poste: 'inconnu' })).toBe('poste inconnu');
  expect(actorLabel({ kind: 'club', clubName: 'Shidokan Lyon' })).toBe('Shidokan Lyon · lien du club');
  expect(actorLabel({ kind: 'account', email: 'orga@exemple.fr', role: 'organisateur' })).toBe('orga@exemple.fr · compte Organisateur');
  expect(actorLabel({ kind: 'account', email: 'table@exemple.fr', role: 'table' })).toBe('table@exemple.fr · compte Table');
  expect(actorLabel({ kind: 'account', email: 'zone@exemple.fr', role: 'zone' })).toBe('zone@exemple.fr · compte Zone');
  expect(actorLabel({ kind: 'app' })).toBe('l’appli');
});
test('texte de recherche : sans accents, majuscules, qui et comment compris', () => {
  const s = journalSearchText({ action: 'fighter-added', data: { subject: 'DUPONT Léa (Shidokan Lyon)' }, actor: { kind: 'poste', poste: 'table' }, via: 'sur-place' });
  expect(s).toContain('LEA'); expect(s).toContain('LYON'); expect(s).toContain('TABLE CENTRALE'); expect(s).toContain('INSCRIPTION SUR PLACE');
});

// Lignes de détail d'un groupe, comme la maquette : le combattant, puis ce qui lui arrive (sans répéter le libellé).
const S = 'LEROY Emma (Dojo Marseille)';
test('ligne de détail : présence → « NOM Prénom (Club) : absente »', () => {
  expect(journalDetailLine({ action: 'presence', data: { subject: S, changes: [{ label: 'Présence', before: 'inconnue', after: 'absente' }] } }))
    .toEqual({ lead: S, outcome: 'absente', changes: [], detail: null });
  expect(journalDetailLine({ action: 'presence', data: { subject: 'NGUYEN Paul (Karaté Club Nice)', changes: [{ label: 'Présence', before: 'inconnue', after: 'absent' }] } }).outcome).toBe('absent');
});
test('ligne de détail : poids → « NOM Prénom (Club) : poids 52,4 kg → 53,1 kg »', () => {
  expect(journalDetailLine({ action: 'weigh-in', data: { subject: S, changes: [{ label: 'Poids', before: '52,4 kg', after: '53,1 kg' }] } }))
    .toEqual({ lead: S, outcome: null, changes: [{ label: 'poids', before: '52,4 kg', after: '53,1 kg' }], detail: null });
});
test('ligne de détail : combattant ajouté, supprimé, modifié', () => {
  expect(journalDetailLine({ action: 'fighter-added', data: { subject: S, detail: 'Kata Minimes F' } })).toEqual({ lead: S, outcome: 'ajouté', changes: [], detail: 'Kata Minimes F' });
  expect(journalDetailLine({ action: 'fighter-removed', data: { subject: S } }).outcome).toBe('supprimé');
  const grade = [{ label: 'Grade', before: '2e kyu', after: '1er kyu' }];
  expect(journalDetailLine({ action: 'fighter-changed', data: { subject: S, changes: grade } })).toEqual({ lead: S, outcome: null, changes: grade, detail: null });
});
test('ligne de détail sans combattant : le titre de l’entrée', () => {
  expect(journalDetailLine({ action: 'raw', data: { method: 'PUT', route: '/x' } })).toEqual({ lead: 'Opération non détaillée : PUT /x', outcome: null, changes: [], detail: null });
});

test('import FFK : titre et détail', () => {
  const t = journalText({ action: 'ffk-import', data: { subject: 'inscriptions-ffk.xlsx', detail: '2 ajoutés · 1 club relié' } });
  expect(t.title).toBe('Import FFK · inscriptions-ffk.xlsx');
  expect(t.detail).toBe('2 ajoutés · 1 club relié');
  expect(ffkImportDetail({ added: 212, changed: 9, removed: 3, unconfirmed: 2, leftAside: 4, weightClasses: 2, clubs: 3 }))
    .toBe('212 ajoutés, 9 modifiés, 3 supprimés · 2 gardés hors export · 4 laissés de côté · 2 catégories de poids créées · 3 clubs reliés');
  expect(ffkImportDetail({ added: 1, changed: 0, removed: 0, unconfirmed: 0, leftAside: 0, weightClasses: 1, clubs: 0 })).toBe('1 ajouté · 1 catégorie de poids créée');
  expect(ffkImportDetail({ added: 0, changed: 0, removed: 0, unconfirmed: 0, leftAside: 0, weightClasses: 0, clubs: 0 })).toBe('aucun changement');
});

test('lignes de détail accordées au genre recopié', () => {
  expect(journalDetailLine({ action: 'fighter-added', data: { subject: 'ROUX Chloé (Dojo Marseille)', sex: 'F', detail: 'Karaté Jiyu' } }))
    .toEqual({ lead: 'ROUX Chloé (Dojo Marseille)', outcome: 'ajoutée', changes: [], detail: 'Karaté Jiyu' });
  expect(journalDetailLine({ action: 'fighter-removed', data: { subject: 'PETIT Nathan (Dojo Marseille)', sex: 'M', detail: 'absent de l’export FFK' } }).outcome).toBe('supprimé');
  expect(journalDetailLine({ action: 'fighter-removed', data: { subject: 'LEROY Emma', sex: 'F' } }).outcome).toBe('supprimée');
  // Entrée écrite avant le genre recopié : masculin.
  expect(journalDetailLine({ action: 'fighter-added', data: { subject: 'MOREAU Lucas' } }).outcome).toBe('ajouté');
  expect(journalDetailLine({ action: 'ffk-unconfirmed', data: { subject: 'SIMON Jade (Shidokan Lyon)', sex: 'F' } }))
    .toEqual({ lead: 'SIMON Jade (Shidokan Lyon)', outcome: 'gardée, absente de l’export FFK', changes: [], detail: null });
});

test('catégorie créée, club relié', () => {
  expect(journalText({ action: 'weight-class-added', data: { subject: 'Benjamins F -30 kg' } }).title).toBe('Catégorie de poids créée · Benjamins F -30 kg');
  expect(journalText({ action: 'club-linked', data: { subject: 'Dojo Marseille', detail: 'au lieu de Dojo Marseille Nord' } }))
    .toMatchObject({ title: 'Dojo Marseille · relié à la FFK', detail: 'au lieu de Dojo Marseille Nord' });
  expect(journalDetailLine({ action: 'club-linked', data: { subject: 'Dojo Marseille' } }).lead).toBe('Dojo Marseille · relié à la FFK');
});

test('titres des combattants accordés au genre recopié, et cherchables tels qu’affichés', () => {
  const S = 'ROUX Chloé (Tani Dojo)';
  const actor = { kind: 'poste', poste: 'table' } as const;
  expect(journalText({ action: 'fighter-added', data: { subject: S, sex: 'F' } }).title).toBe(`${S} · ajoutée`);
  expect(journalText({ action: 'fighter-removed', data: { subject: S, sex: 'F' } }).title).toBe(`${S} · supprimée`);
  expect(journalText({ action: 'fighter-changed', data: { subject: S, sex: 'F' } }).title).toBe(`${S} · modifiée`);
  expect(journalText({ action: 'fighter-added', data: { subject: S, sex: 'M' } }).title).toBe(`${S} · ajouté`);
  // Entrées écrites avant le genre recopié : masculin.
  expect(journalText({ action: 'fighter-changed', data: { subject: S } }).title).toBe(`${S} · modifié`);
  expect(journalSearchText({ action: 'fighter-added', data: { subject: S, sex: 'F' }, actor, via: 'sur-place' })).toContain('AJOUTEE');
  expect(journalSearchText({ action: 'fighter-removed', data: { subject: S, sex: 'F' }, actor, via: 'sur-place' })).toContain('SUPPRIMEE');
  expect(journalSearchText({ action: 'ffk-unconfirmed', data: { subject: S, sex: 'F' }, actor, via: 'import-ffk' })).toContain('ABSENTE DE L EXPORT FFK');
  expect(journalText({ action: 'ffk-unconfirmed', data: { subject: S, sex: 'F' } }).title).toBe(`${S} · gardée, absente de l’export FFK`);
  expect(journalText({ action: 'ffk-unconfirmed', data: { subject: S } }).title).toBe(`${S} · gardé, absent de l’export FFK`);
});
