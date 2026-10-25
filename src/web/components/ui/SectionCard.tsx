import { Card, Group, Stack, Text, Title } from '@mantine/core';
import { useId, type ReactNode } from 'react';
import type { HelpTopicId } from '../../help.js';
import { HelpButton, HelpText } from '../Help.js';

/**
 * Section en carte (remplace les cadres « fieldset ») : titre, aide, actions à droite, puis le contenu. Un groupe dont le nom lu
 * (lecteur d'écran) est le titre seul.
 */
export function SectionCard({ title, help, description, actions, children, id, 'data-testid': testId }: {
  title: ReactNode; help?: HelpTopicId; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; 'data-testid'?: string;
}) {
  const titleId = useId();
  return (
    <Card withBorder padding="lg" id={id} data-testid={testId} component="section" role="group" aria-labelledby={titleId}
      style={{ scrollMarginTop: 72 }}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Stack gap={2} style={{ minWidth: 0, flex: '1 1 260px' }}>
            <Group gap={4} wrap="nowrap">
              <Title order={3} fz="lg" id={titleId}>{title}</Title>
              {help && <HelpButton topic={help} />}
            </Group>
            {description && <Text size="sm" c="dimmed">{description}</Text>}
            {help && <HelpText topic={help} />}
          </Stack>
          {actions && <Group gap="xs">{actions}</Group>}
        </Group>
        {children}
      </Stack>
    </Card>
  );
}
