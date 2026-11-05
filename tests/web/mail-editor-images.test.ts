import { describe, expect, it } from 'vitest';
import { jpegCarriesMetadata, pastedLosses, pastedOnlyAnImage, reducedOutputType } from '../../src/web/components/mail-editor/images.js';

describe('images du message', () => {
  it('choisit le format de l’image réduite', () => {
    expect(reducedOutputType('image/jpeg', false)).toBe('image/jpeg');
    expect(reducedOutputType('image/png', true)).toBe('image/png');
    expect(reducedOutputType('image/webp', false)).toBe('image/jpeg');
    expect(reducedOutputType('image/webp', true)).toBe('image/png');
  });

  it('signale ce que le collage fait perdre', () => {
    expect(pastedLosses('<p>x</p><img src="/api/mail-images/a">')).toEqual([]);
    expect(pastedLosses('<table></table><img src="https://e.fr/a.png">')).toEqual(['tableau', 'image externe']);
    expect(pastedLosses('<img alt="a>b" src=\'data:image/png;base64,AA\'>')).toEqual(['image externe']);
  });

  it('reconnaît un collage qui n’est qu’une image, sans texte', () => {
    expect(pastedOnlyAnImage('<img src="https://e.fr/a.png">')).toBe(true);
    expect(pastedOnlyAnImage('<meta charset="utf-8"><img alt="a>b" src="https://e.fr/a.png"/>')).toBe(true);
    expect(pastedOnlyAnImage('<html><head><title>Titre</title><style>p{color:red}</style></head><body><!--StartFragment--><p><img src="a.png">&nbsp;</p><!--EndFragment--></body></html>')).toBe(true);
    expect(pastedOnlyAnImage('<p>Texte</p><img src="https://e.fr/a.png">')).toBe(false);
    expect(pastedOnlyAnImage('<img src="https://e.fr/a.png"><p>&eacute;</p>')).toBe(false);
    expect(pastedOnlyAnImage('<p>Texte</p>')).toBe(false);
    expect(pastedOnlyAnImage('')).toBe(false);
  });

  it('repère un JPEG qui porte des métadonnées (Exif ou XMP dans un segment APP1)', () => {
    const SOI = [0xff, 0xd8];
    const segment = (marker: number, ...content: number[]) => [0xff, marker, (content.length + 2) >> 8, (content.length + 2) & 0xff, ...content];
    const exif = [...'Exif'].map((c) => c.charCodeAt(0));
    const jfif = segment(0xe0, 0x4a, 0x46, 0x49, 0x46, 0);
    const startOfScan = [...segment(0xda, 1, 2), 0xff, 0xe1, 0, 4, 0, 0, 0xff, 0xd9];
    expect(jpegCarriesMetadata(Uint8Array.from([...SOI, ...jfif, ...segment(0xe1, ...exif, 0, 0, 1, 2), ...startOfScan]))).toBe(true);
    expect(jpegCarriesMetadata(Uint8Array.from([...SOI, ...segment(0xe1, 1, 2, 3), ...startOfScan]))).toBe(true);
    // Sans APP1, ou un motif pareil seulement dans les données de l'image : rien à retirer.
    expect(jpegCarriesMetadata(Uint8Array.from([...SOI, ...jfif, ...startOfScan]))).toBe(false);
    expect(jpegCarriesMetadata(Uint8Array.from([...SOI, ...segment(0xdb, 0xff, 0xe1, 0, 8)]))).toBe(false);
    // Fichier coupé ou qui n'est pas un JPEG : pas de lecture hors du tableau.
    expect(jpegCarriesMetadata(Uint8Array.from(SOI))).toBe(false);
    expect(jpegCarriesMetadata(Uint8Array.from([0x89, 0x50, 0xff, 0xe1]))).toBe(false);
    expect(jpegCarriesMetadata(Uint8Array.from([...SOI, 0xff, 0xe0, 0xff, 0xff, 0xff, 0xe1]))).toBe(false);
  });
});
