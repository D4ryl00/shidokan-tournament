import { describe, expect, it } from 'vitest';
import { parseFfkCategory, parseFfkPdfLines, type FfkTextLine } from '../../src/domain/ffk-pdf.js';

const line = (page: number, y: number, ...items: [number, string][]): FfkTextLine => ({
  page,
  y,
  items: items.map(([x, text]) => ({ x, text })),
});
const fighter = (page: number, y: number, lic: string, name: string): FfkTextLine[] => [
  line(page, y, [40, lic], [120, name], [360, 'LIGUE REGIONALE TEST'], [520, 'DOJO TEST']),
  line(page, y + 5, [360, 'ALPES COTE D AZUR DE']),
  line(page, y + 10, [360, 'KARATE ET DA']),
];

describe('parseFfkCategory', () => {
  it('lit un titre simple', () => {
    expect(parseFfkCategory('Poussin Masculin -25 KG')).toEqual({ sex: 'M', ageLabel: 'Poussin', weightLabel: '-25', rulesetLabel: null });
  });
  it('lit le règlement', () => {
    expect(parseFfkCategory('Séniors shobu ippon kumité Feminine +68 KG')).toEqual({ sex: 'F', ageLabel: 'Séniors', weightLabel: '+68', rulesetLabel: 'shobu' });
    expect(parseFfkCategory('Séniors jiyu ippon kumite Masculin -75 KG')?.rulesetLabel).toBe('jiyu');
  });
  it('lit les mots collés', () => {
    expect(parseFfkCategory('Vétéran2 Masculin-75 KG')).toMatchObject({ ageLabel: 'Vétéran 2', weightLabel: '-75', sex: 'M' });
    expect(parseFfkCategory('Benjamin Feminine-30 KG')).toMatchObject({ sex: 'F', weightLabel: '-30' });
  });
  it('lit les titres de kata sans poids', () => {
    expect(parseFfkCategory('Pupille Masculin')).toMatchObject({ weightLabel: null, sex: 'M' });
    expect(parseFfkCategory('Seniors Débutants Shindo Feminine')).toEqual({ ageLabel: 'Seniors Débutants Shindo', sex: 'F', weightLabel: null, rulesetLabel: null });
  });
  it('rejette les autres lignes', () => {
    for (const s of ['Aucune inscription', 'N° Licencié Nom Prénom', '10/11/2026 - Page 2', 'Inscrits : 21']) {
      expect(parseFfkCategory(s)).toBeNull();
    }
  });
});

describe('parseFfkPdfLines', () => {
  it('lit un combattant sous son titre', () => {
    const r = parseFfkPdfLines([
      line(2, 50, [40, 'Poussin Masculin -25 KG']),
      line(2, 70, [40, 'Inscrits']),
      line(2, 90, [40, 'N° Licencié'], [120, 'Nom Prénom']),
      ...fighter(2, 110, '1000001A', 'DURAND LEO'),
    ]);
    expect(r.entries).toEqual([
      { order: 0, fullName: 'DURAND LEO', category: 'Poussin Masculin -25 KG', title: expect.objectContaining({ sex: 'M', weightLabel: '-25' }) },
    ]);
    expect(r.duplicates).toEqual([]);
  });
  it('coupe un nom fondu avec la ligue', () => {
    const r = parseFfkPdfLines([
      line(2, 50, [40, 'Poussin Masculin -25 KG']),
      line(2, 110, [40, '1000001A'], [120, 'DI MARCO SANTOS LUCA LIGUE REGIONALE TEST'], [520, 'DOJO TEST']),
    ]);
    expect(r.entries[0]!.fullName).toBe('DI MARCO SANTOS LUCA');
  });
  it('garde la catégorie d’une page à l’autre', () => {
    const r = parseFfkPdfLines([
      line(2, 700, [40, 'Poussin Masculin -25 KG']),
      line(2, 720, [40, 'Inscrits']),
      line(2, 740, [40, 'N° Licencié'], [120, 'Nom Prénom']),
      line(2, 817, [240, '10/11/2026 - Page 1']),
      line(3, 50, [40, '0060057 NOM DU CLUB']),
      ...fighter(3, 80, '1000001A', 'DURAND LEO'),
    ]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.category).toBe('Poussin Masculin -25 KG');
  });
  it('ignore catégories vides, résumé et entité', () => {
    const r = parseFfkPdfLines([
      line(1, 50, [40, 'ÉTAT DES INSCRIPTIONS']),
      line(1, 70, [40, 'Inscrits : 2']),
      line(1, 90, [40, 'RESUMÉ DES INSCRIPTIONS PAR ENTITÉS']),
      line(1, 110, [40, '0000001 DOJO TEST Inscrit(s) : 2 En cours : 0 Catégorie(s) déclarée(s) vide(s) : 95/110']),
      line(2, 50, [40, '0000001 DOJO TEST']),
      line(2, 70, [40, 'Pupille Masculin']),
      line(2, 90, [40, 'Aucune inscription']),
    ]);
    expect(r.entries).toEqual([]);
  });
  it('signale les doublons', () => {
    const r = parseFfkPdfLines([
      line(2, 50, [40, 'Poussin Masculin -25 KG']),
      ...fighter(2, 80, '1000001A', 'DURAND LEO'),
      ...fighter(2, 110, '1000002A', 'Durand Léo'),
    ]);
    expect(r.entries).toHaveLength(1);
    expect(r.duplicates).toEqual(['Durand Léo']);
  });
});
