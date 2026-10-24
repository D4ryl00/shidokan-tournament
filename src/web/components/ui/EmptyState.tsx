import { Stack, Text, ThemeIcon } from '@mantine/core';
import type { ReactNode } from 'react';

/** Liste vide : ce qu'il n'y a pas encore, et quoi faire. */
export function EmptyState({ title, text, action, icon = '○', 'data-testid': testId }: { title: ReactNode; text?: ReactNode; action?: ReactNode; icon?: ReactNode; 'data-testid'?: string }) {
  return (
    <Stack align="center" gap="xs" py="xl" px="md" ta="center" data-testid={testId}
      style={{ border: '1px dashed var(--sk-card-line)', borderRadius: 'var(--mantine-radius-lg)' }}>
      <ThemeIcon variant="light" radius="xl" size="lg" aria-hidden>{icon}</ThemeIcon>
      <Text fw={600}>{title}</Text>
      {text && <Text size="sm" c="dimmed" maw={460}>{text}</Text>}
      {action}
    </Stack>
  );
}
