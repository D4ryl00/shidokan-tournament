import { ActionIcon, Group, List, Modal, Stack, Text, Title, type TitleOrder } from '@mantine/core';
import { useState } from 'react';
import { HELP, type HelpTopicId } from '../help.js';

/**
 * Bouton ⓘ : ouvre l'aide complète d'un sujet. Dans une autre fenêtre, `onOpenChange` permet à celle-ci de ne pas
 * se fermer avec la même touche Échap (Mantine écoute Échap sur toute la page, pour chaque fenêtre ouverte).
 */
export function HelpButton({ topic, onOpenChange }: { topic: HelpTopicId; onOpenChange?: (opened: boolean) => void }) {
  const [opened, setOpenedState] = useState(false);
  const setOpened = (v: boolean) => {
    setOpenedState(v);
    onOpenChange?.(v);
  };
  const h = HELP[topic];
  return (
    <>
      <ActionIcon variant="subtle" radius="xl" size="lg" className="no-print" aria-label={`Aide : ${h.title}`}
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
    <Text size="sm" c="dimmed" mb={4} className="no-print" data-testid="help-short" data-topic={topic}>
      {HELP[topic].short}
    </Text>
  );
}

/** Titre de section avec son ⓘ, puis sa phrase d'aide. `suffix` complète le titre (un compteur, par exemple). */
export function SectionHeader({ topic, order = 4, suffix }: { topic: HelpTopicId; order?: TitleOrder; suffix?: string }) {
  return (
    <Stack gap={2}>
      <Group gap={4} wrap="nowrap">
        <Title order={order}>{HELP[topic].title}{suffix ? ` ${suffix}` : ''}</Title>
        <HelpButton topic={topic} />
      </Group>
      <HelpText topic={topic} />
    </Stack>
  );
}

/**
 * Phrase d'aide suivie de son ⓘ, en tête d'un `Fieldset` dont la légende reste le titre seul
 * (le nom du groupe lu par un lecteur d'écran n'inclut pas « Aide : … »).
 */
export function HelpLine({ topic }: { topic: HelpTopicId }) {
  return (
    <Group gap={4} wrap="nowrap" align="flex-start">
      <HelpText topic={topic} />
      <HelpButton topic={topic} />
    </Group>
  );
}
