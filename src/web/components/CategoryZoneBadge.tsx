import { Select } from '@mantine/core';

/**
 * Zone d'une catégorie dans la liste de l'écran Combats : une puce qui se change en un clic (liste des zones). Le parent décide
 * de l'effet : épingler la zone, ou ouvrir « Déplacer vers… » quand la catégorie est figée.
 */
export function CategoryZoneBadge({ data, value, onChange }: {
  data: { value: string; label: string; disabled?: boolean }[]; value: string; onChange: (zoneId: string) => void;
}) {
  const label = data.find((d) => d.value === value)?.label;
  return (
    <Select size="xs" radius="xl" data={data} value={value} allowDeselect={false} data-testid="schedule-zone" aria-label="Zone de combat" title={label}
      style={{ flex: '1 1 160px', minWidth: 150, maxWidth: 260 }} comboboxProps={{ width: 260, position: 'bottom-start' }}
      styles={{ input: { backgroundColor: 'var(--sk-chip)', color: 'var(--sk-chip-text)', borderColor: 'transparent', fontWeight: 600, textOverflow: 'ellipsis' } }}
      onChange={(v) => v !== null && onChange(v)} />
  );
}
