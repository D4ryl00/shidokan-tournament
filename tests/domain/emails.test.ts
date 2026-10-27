import { describe, expect, it } from 'vitest';
import { EMAIL_LIMITS, cleanEmails, isAcceptableEmail, joinEmails, missingEmails, sameEmail, splitEmails } from '../../src/domain/emails.js';

describe('adresses e-mail d’un club', () => {
  it('découpe une case en adresses', () => {
    expect(splitEmails(' a@x.fr, b@y.fr;c@z.fr\nd@w.fr  e@v.fr ')).toEqual(['a@x.fr', 'b@y.fr', 'c@z.fr', 'd@w.fr', 'e@v.fr']);
    expect(splitEmails('')).toEqual([]);
    expect(splitEmails(null)).toEqual([]);
  });

  it('nettoie une liste : espaces, vides et doublons retirés, ordre gardé', () => {
    expect(cleanEmails([' B@y.fr ', 'a@x.fr', '', 'b@Y.fr', 'a@x.fr'])).toEqual(['B@y.fr', 'a@x.fr']);
  });

  it('compare sans la casse', () => {
    expect(sameEmail('Jean@Club.fr', ' jean@club.fr')).toBe(true);
    expect(sameEmail('jean@club.fr', 'jeanne@club.fr')).toBe(false);
  });

  it('accepte une seule adresse valide par case', () => {
    expect(isAcceptableEmail(' a@x.fr ')).toBe(true);
    expect(isAcceptableEmail('a@x.fr, b@y.fr')).toBe(false);
    expect(isAcceptableEmail('pas une adresse')).toBe(false);
    expect(isAcceptableEmail(`${'a'.repeat(EMAIL_LIMITS.length)}@x.fr`)).toBe(false);
  });

  it('propose seulement les adresses qui manquent, sans dépasser la limite', () => {
    expect(missingEmails(['a@x.fr'], ['A@x.fr', 'b@y.fr', 'b@y.fr'])).toEqual(['b@y.fr']);
    const nine = Array.from({ length: EMAIL_LIMITS.count - 1 }, (_, i) => `n${i}@x.fr`);
    expect(missingEmails(nine, ['p@x.fr', 'q@x.fr'])).toEqual(['p@x.fr']);
  });

  it('joint pour l’affichage', () => {
    expect(joinEmails(['a@x.fr', 'b@y.fr'])).toBe('a@x.fr, b@y.fr');
  });
});
