import { Group, Radio, Text } from '@mantine/core';
import type { ReactNode } from 'react';

/**
 * Une option à cocher de l’import FFK (« Relier à … », « Ne pas relier pour l’instant », résultat d’une recherche) : un rond,
 * le libellé et une précision en plus discret. Cochée : encadrée en bleu, comme une valeur choisie.
 */
export function ChoiceOption({ checked, onClick, children, sub, disabled, 'data-testid': testId }: {
  checked: boolean;
  onClick: () => void;
  children: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  'data-testid'?: string;
}) {
  return (
    <Radio.Card checked={checked} onClick={onClick} disabled={disabled} radius="md" data-testid={testId}
      style={{
        padding: '7px 10px', opacity: disabled ? 0.55 : 1,
        borderColor: checked ? 'var(--mantine-color-blue-6)' : undefined,
        background: checked ? 'var(--mantine-color-blue-light)' : undefined,
      }}>
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <Radio.Indicator color="blue" size="xs" mt={3} />
        <div style={{ minWidth: 0 }}>
          <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{children}</Text>
          {sub && <Text size="xs" c="dimmed">{sub}</Text>}
        </div>
      </Group>
    </Radio.Card>
  );
}
