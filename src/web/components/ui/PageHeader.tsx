import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { HelpTopicId } from '../../help.js';
import { HelpButton, HelpText } from '../Help.js';

/**
 * En-tête d'une page ou d'un onglet : titre (avec son ⓘ), résumé discret et phrase d'aide ; à droite, les actions (la principale
 * en dernier).
 */
export function PageHeader({ title, summary, help, actions }: { title: ReactNode; summary?: ReactNode; help?: HelpTopicId; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
      <Stack gap={2} style={{ minWidth: 0, flex: '1 1 320px' }}>
        <Group gap={4} wrap="nowrap">
          <Title order={2} fz="h3">{title}</Title>
          {help && <HelpButton topic={help} />}
        </Group>
        {summary && <Text size="sm" c="dimmed">{summary}</Text>}
        {help && <HelpText topic={help} />}
      </Stack>
      {actions && <Group gap="xs" wrap="wrap" justify="flex-end">{actions}</Group>}
    </Group>
  );
}
