import { describe, expect, test } from 'vitest';
import { entityAffiliation, linkClubs } from '../../src/domain/ffk-plan/clubs.js';

describe('rapprochement des clubs', () => {
  test('sûr : même entité, alias, même nom, ou même N° d’affiliation (club ou annuaire) → relié d’office', () => {
    const [l] = linkClubs([{ clubEntity: '0060690 ETOILE SPORTIVE VILLENEUVE LOUBET KARATE', clubName: 'ETOILE SPORTIVE VILLENEUVE LOUBET KARATE', rows: 14 }],
      [{ id: 'c1', name: 'ESVL Karaté', ffkEntity: null, affiliationNumber: '0060690' }], {}, undefined);
    expect(l).toMatchObject({ affiliationNumber: '0060690', proposal: { clubId: 'c1', certainty: 'sure' }, target: 'c1', chosen: false });
  });
  test('nom proche « à vérifier » : proposé, pas relié par défaut', () => {
    const [l] = linkClubs([{ clubEntity: '0060781 SAISHO DOJO', clubName: 'SAISHO DOJO', rows: 5 }], [{ id: 'c2', name: 'Saisho Dojo Nice', ffkEntity: null, affiliationNumber: null }], {}, undefined);
    expect(l).toMatchObject({ proposal: { clubId: 'c2', certainty: 'doubtful' }, target: null });
  });
  test('choix : un club relie, « none » délie même un lien sûr', () => {
    const ent = [{ clubEntity: '0060057 STADE LAURENTIN KARATE', clubName: 'STADE LAURENTIN KARATE', rows: 22 }];
    const clubs = [{ id: 'c3', name: 'Stade Laurentin Karaté', ffkEntity: '0060057 STADE LAURENTIN KARATE', affiliationNumber: null }, { id: 'c4', name: 'Autre', ffkEntity: null, affiliationNumber: null }];
    expect(linkClubs(ent, clubs, {}, { '0060057 STADE LAURENTIN KARATE': 'none' })[0]).toMatchObject({ target: null, chosen: true });
    expect(linkClubs(ent, clubs, {}, { '0060057 STADE LAURENTIN KARATE': 'c4' })[0]).toMatchObject({ target: 'c4', chosen: true });
  });
  test('club inconnu : ni proposition ni lien', () => {
    expect(linkClubs([{ clubEntity: '0310769 PYRENEES FIGHTING CLUB', clubName: 'PYRENEES FIGHTING CLUB', rows: 2 }], [], {}, undefined)[0]).toMatchObject({ proposal: null, target: null });
  });
  test('N° d’affiliation vide ou différent (zéros compris) : pas de lien', () => {
    const ent = [{ clubEntity: '0060690 X CLUB', clubName: 'X CLUB', rows: 1 }];
    expect(linkClubs(ent, [{ id: 'a', name: 'Y', ffkEntity: null, affiliationNumber: '' }], {}, undefined)[0]!.proposal).toBeNull();
    expect(linkClubs(ent, [{ id: 'a', name: 'Y', ffkEntity: null, affiliationNumber: '60690' }], {}, undefined)[0]!.proposal).toBeNull();
  });
  test('entityAffiliation', () => {
    expect(entityAffiliation('0060690 ETOILE')).toBe('0060690');
    expect(entityAffiliation('ETOILE')).toBeNull();
  });
});
