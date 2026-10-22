import { ActionIcon, Group, List, Modal, Stack, Text, Title, type TitleOrder } from '@mantine/core';
import { useState } from 'react';
import { HELP, type HelpTopicId } from '../help.js';

/** Bouton ⓘ : ouvre l'aide complète d'un sujet. */
export function HelpButton({ topic }: { topic: HelpTopicId }) {
  const [opened, setOpened] = useState(false);
  const h = HELP[topic];
  return (
    <>
      <ActionIcon variant="subtle" radius="xl" size="sm" className="no-print" aria-label={`Aide : ${h.title}`}
        data-testid="help-button" data-topic={topic} onClick={() => setOpened(true)}>
        ⓘ
      </ActionIcon>
      <Modal opened={opened} onClose={() => setOpened(false)} title={h.title} size="lg" data-testid="help-modal">
        <Stack gap="sm">
          {h.details.map((d, i) =>
            typeof d === 'string' ? (
              <Text key={i} size="sm">{d}</Text>
            ) : (
              <List key={i} size="sm" spacing={4}>
                {d.map((item, j) => <List.Item key={j}>{item}</List.Item>)}
              </List>
            ),
          )}
        </Stack>
      </Modal>
    </>
  );
}

/** Phrase d'aide visible sous un titre (jamais imprimée). */
export function HelpText({ topic }: { topic: HelpTopicId }) {
  return (
    <Text size="sm" c="dimmed" className="no-print" data-testid="help-short" data-topic={topic}>
      {HELP[topic].short}
    </Text>
  );
}

/** Titre de section avec son ⓘ, puis sa phrase d'aide. */
export function SectionHeader({ topic, order = 4 }: { topic: HelpTopicId; order?: TitleOrder }) {
  return (
    <Stack gap={2}>
      <Group gap={4} wrap="nowrap">
        <Title order={order}>{HELP[topic].title}</Title>
        <HelpButton topic={topic} />
      </Group>
      <HelpText topic={topic} />
    </Stack>
  );
}

/** Légende de `Fieldset` avec son ⓘ (la phrase d'aide se place en tête du contenu). */
export function HelpLegend({ topic }: { topic: HelpTopicId }) {
  return (
    <Group gap={4} wrap="nowrap" component="span">
      {HELP[topic].title}
      <HelpButton topic={topic} />
    </Group>
  );
}
