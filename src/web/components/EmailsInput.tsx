import { Stack, Text, TextInput, type TextInputProps } from '@mantine/core';
import { useState } from 'react';
import { cleanEmails, EMAIL_LIMITS, isAcceptableEmail, splitEmails, TOO_MANY_EMAILS } from '../../domain/emails.js';

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Adresses e-mail d'un club, dans un champ texte : virgule, point-virgule ou espace entre deux. Chaque frappe donne la liste au
 * parent (rien n'attend la sortie du champ, qui ferait bouger la page sous le clic). Une adresse mal écrite est signalée en quittant
 * le champ.
 */
/** `compact` : sans phrase d'aide (champ aligné sur ses voisins), le message d'erreur passe sous le champ. */
export function EmailsInput({ value, onChange, compact = false, ...props }: { value: string[]; onChange: (v: string[]) => void; compact?: boolean } & Omit<TextInputProps, 'value' | 'onChange'>) {
  const [text, setText] = useState(value.join(', '));
  const [touched, setTouched] = useState(false);
  // Liste changée par le parent (fiche rechargée, formulaire vidé) : le texte la reprend.
  const shown = sameList(cleanEmails(splitEmails(text)), cleanEmails(value)) ? text : value.join(', ');
  const list = splitEmails(shown);
  const invalid = list.filter((e) => !isAcceptableEmail(e));
  const error = !touched ? null : invalid.length ? `Adresse invalide : ${invalid.join(', ')}` : list.length > EMAIL_LIMITS.count ? TOO_MANY_EMAILS : null;
  // Le message prend la place de l'aide, au-dessus du champ : sous le champ, il ferait descendre le bouton qu'on est en train de cliquer.
  const description = compact ? undefined : error ? <Text span size="xs" c="var(--mantine-color-error)">{error}</Text> : 'Une ou plusieurs adresses, séparées par des virgules.';
  return (
    <TextInput label="E-mails" description={description} inputMode="email" autoComplete="off" error={compact ? error : !!error}
      value={shown} onBlur={() => setTouched(true)}
      onChange={(e) => { const v = e.currentTarget.value; setText(v); onChange(splitEmails(v)); }} {...props} />
  );
}

/** Adresses d'un club dans un tableau : une par ligne, « — » s'il n'y en a pas. */
export function EmailsList({ emails }: { emails: string[] }) {
  if (!emails.length) return <Text span c="dimmed" size="sm">—</Text>;
  return <Stack gap={0}>{emails.map((e) => <Text key={e} size="sm" style={{ overflowWrap: 'anywhere' }}>{e}</Text>)}</Stack>;
}
