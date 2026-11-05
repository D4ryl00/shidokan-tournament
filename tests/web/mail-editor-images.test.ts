import { describe, expect, it } from 'vitest';
import { pastedLosses, reducedOutputType } from '../../src/web/components/mail-editor/images.js';

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
});
