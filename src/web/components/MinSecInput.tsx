import { TextInput } from '@mantine/core';
import { useState } from 'react';
import { minSecText, parseMinSec } from '../../domain/schedule/durations.js';

/** « m:ss » en secondes. */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

/**
 * Durée saisie en minutes et secondes (« 1:30 », ou « 2 » pour deux minutes) ; `value` et `onChange` en secondes.
 * Un texte illisible ou hors bornes montre une erreur et ne change rien.
 */
export function MinSecInput({ value, onChange, label, min = 0, max = 3600, 'data-testid': testId }: {
  value: number; onChange: (sec: number) => void; label: string; min?: number; max?: number; 'data-testid'?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? clock(value);
  const parsed = parseMinSec(shown);
  const error = parsed === null ? 'Format attendu : 1:30' : parsed < min || parsed > max ? `Entre ${minSecText(min)} et ${minSecText(max)}` : null;
  return (
    <TextInput label={label} value={shown} error={text !== null ? error : null} data-testid={testId} inputMode="numeric" size="sm"
      onChange={(e) => {
        const t = e.currentTarget.value;
        setText(t);
        const sec = parseMinSec(t);
        if (sec !== null && sec >= min && sec <= max) onChange(sec);
      }}
      onBlur={() => { if (text !== null && !error) setText(null); }} />
  );
}
