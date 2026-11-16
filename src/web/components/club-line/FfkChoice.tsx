import { Group, UnstyledButton } from '@mantine/core';
import type { ffkChoiceState } from './ffkStep.js';

/** Deux cases côte à côte sous un champ en désaccord : la valeur de la FFK et celle de la fiche. */
export function FfkChoice({ label, state, ffk, fiche, disabled, unavailable, titles = { ffk: 'FFK', fiche: 'Votre fiche' }, pending, onPick }: {
  /** Nom du champ, pour l'étiquette du groupe. */
  label: string;
  state: ReturnType<typeof ffkChoiceState>;
  /** Valeurs lisibles. */
  ffk: string;
  fiche: string;
  disabled?: boolean;
  /** Case dont la valeur n'est pas proposée par le champ en ce moment. */
  unavailable?: { ffk?: boolean; fiche?: boolean };
  /** Titres des deux cases. */
  titles?: { ffk: string; fiche: string };
  /** Choix encore à faire (carte d'import, champ vide) : cases en pointillés orange. */
  pending?: boolean;
  onPick: (which: 'ffk' | 'fiche') => void;
}) {
  const box = (which: 'ffk' | 'fiche', title: string, value: string) => {
    const off = disabled || unavailable?.[which];
    return (
    <UnstyledButton key={which} type="button" data-testid={`ffk-choice-${which}`} aria-pressed={state === which} disabled={off} onClick={() => onPick(which)}
      style={{
        flex: 1, padding: '6px 10px', borderRadius: 6, opacity: off ? 0.55 : 1,
        border: state === which ? '1px solid var(--mantine-color-blue-6)' : pending ? '1px dashed var(--mantine-color-orange-6)' : '1px solid var(--mantine-color-default-border)',
        background: state === which ? 'var(--mantine-color-blue-light)' : pending ? 'var(--mantine-color-body)' : 'transparent',
      }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{title}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </UnstyledButton>
    );
  };
  return (
    <Group gap="xs" grow mt={4} role="group" aria-label={`${label} : valeur à garder`}>
      {box('ffk', titles.ffk, ffk)}
      {box('fiche', titles.fiche, fiche)}
    </Group>
  );
}
