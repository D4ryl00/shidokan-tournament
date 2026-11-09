import { TextInput } from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { minSecText, parseMinSec } from '../../domain/schedule/durations.js';

/** « m:ss » en secondes. */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/**
 * Durée saisie en minutes et secondes (« 1:30 », ou « 2 » pour deux minutes) ; `value` et `onChange` en secondes.
 * Un texte illisible ou hors bornes montre une erreur et ne change rien ; `onValidityChange` prévient l'écran, qui
 * bloque alors l'enregistrement (jamais une valeur que le champ ne montre pas).
 */
export function MinSecInput({ value, onChange, onValidityChange, label, min = 0, max = 3600, 'data-testid': testId }: {
  value: number; onChange: (sec: number) => void; onValidityChange?: (valid: boolean) => void; label: string; min?: number; max?: number; 'data-testid'?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? clock(value);
  const check = (t: string) => {
    const sec = parseMinSec(t);
    return { sec, error: sec === null ? 'Format attendu : 1:30' : sec < min || sec > max ? `Entre ${minSecText(min)} et ${minSecText(max)}` : null };
  };
  const { error } = check(shown);
  // Champ retiré de l'écran alors qu'il était en erreur : il ne bloque plus rien.
  const report = useRef(onValidityChange);
  report.current = onValidityChange;
  useEffect(() => () => report.current?.(true), []);
  return (
    <TextInput label={label} value={shown} error={text !== null ? error : null} data-testid={testId} inputMode="numeric" size="sm"
      onChange={(e) => {
        const t = e.currentTarget.value;
        setText(t);
        const r = check(t);
        if (r.error === null) onChange(r.sec!);
        onValidityChange?.(r.error === null);
      }}
      onBlur={() => { if (text !== null && !error) setText(null); }} />
  );
}

/**
 * Champs de durée en erreur d'un écran : `field(clé)` se passe en `onValidityChange` ; `invalid` vrai tant qu'un champ
 * montre une erreur, pour désactiver « Enregistrer ».
 */
export function useInvalidFields(): { invalid: boolean; field: (key: string) => (valid: boolean) => void } {
  const [bad, setBad] = useState<ReadonlySet<string>>(() => new Set());
  const field = useCallback((key: string) => (valid: boolean) => setBad((prev) => {
    if (prev.has(key) === !valid) return prev;
    const next = new Set(prev);
    if (valid) next.delete(key); else next.add(key);
    return next;
  }), []);
  return { invalid: bad.size > 0, field };
}
