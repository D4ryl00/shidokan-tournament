import { Progress, Stack, Text } from '@mantine/core';

/** « Fiche 3 sur 7 » et sa barre : en tête de chaque étape de l'import FFK (fiche ou choix d'homonyme). */
export function FfkProgress({ index, total }: { index: number; total: number }) {
  const label = `Fiche ${index + 1} sur ${total}`;
  return (
    <Stack gap={4} data-testid="ffk-progress">
      <Text size="sm" c="dimmed">{label}</Text>
      <Progress value={((index + 1) / Math.max(total, 1)) * 100} size="sm" aria-label={label} />
    </Stack>
  );
}
