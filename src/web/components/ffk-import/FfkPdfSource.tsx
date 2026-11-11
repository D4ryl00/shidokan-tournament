import { Anchor, Text } from '@mantine/core';

export const FFK_COMPETITION_SITE = 'https://www.ffkcompetition.fr';

/** « Libellé » avec des espaces insécables : un guillemet ne se retrouve pas seul en bout ou en début de ligne (téléphone). */
export const quoted = (label: string) => `«\u00a0${label}\u00a0»`;

/** Où trouver le PDF : en tête de la fenêtre d'import (coach et organisateur). Libellés tels que le site de la FFK les écrit. */
export function FfkPdfSource() {
  return (
    <Text size="sm" c="dimmed" data-testid="ffk-pdf-source">
      Le PDF {quoted('Etat des inscriptions')} se récupère sur{' '}
      <Anchor href={FFK_COMPETITION_SITE} target="_blank" rel="noopener noreferrer" size="sm">ffkcompetition.fr</Anchor>{'\u00a0'}: ouvrez
      la compétition, onglet {quoted('Récap')}, puis téléchargez {quoted('Etat des inscriptions')}. Un PDF par discipline{'\u00a0'}:
      importez-les l’un après l’autre.
    </Text>
  );
}
