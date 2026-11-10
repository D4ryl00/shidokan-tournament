import { Group, UnstyledButton } from '@mantine/core';
import type { ffkChoiceState } from './ffkStep.js';

/** Deux cases côte à côte sous un champ en désaccord : la valeur de la FFK et celle de la fiche. */
export function FfkChoice({ state, ffk, fiche, disabled, onPick }: {
  state: ReturnType<typeof ffkChoiceState>;
  /** Valeurs lisibles. */
  ffk: string;
  fiche: string;
  disabled?: boolean;
  onPick: (which: 'ffk' | 'fiche') => void;
}) {
  const box = (which: 'ffk' | 'fiche', label: string, value: string) => (
    <UnstyledButton key={which} type="button" data-testid={`ffk-choice-${which}`} aria-pressed={state === which} disabled={disabled} onClick={() => onPick(which)}
      style={{
        flex: 1, padding: '6px 10px', borderRadius: 6, opacity: disabled ? 0.55 : 1,
        border: `1px solid ${state === which ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-default-border)'}`,
        background: state === which ? 'var(--mantine-color-blue-light)' : 'transparent',
      }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </UnstyledButton>
  );
  return (
    <Group gap="xs" grow mt={4} role="group" aria-label="Valeur à garder">
      {box('ffk', 'FFK', ffk)}
      {box('fiche', 'Votre fiche', fiche)}
    </Group>
  );
}
