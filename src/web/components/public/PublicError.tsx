import { Alert, Group, Loader, Text } from '@mantine/core';
import { isNetworkError, publicErrorText } from '../../publicStatus.js';

/**
 * Erreur d'une page publique, seulement quand rien n'est à l'écran : serveur injoignable (en français, réessayé tout seul),
 * sinon le message du serveur. Avec des données, le bandeau « Connexion perdue » suffit.
 */
export function PublicError({ error, hasData }: { error: unknown; hasData: boolean }) {
  const text = publicErrorText(error, hasData);
  if (!text) return null;
  if (isNetworkError(error)) {
    return (
      <Group justify="center" gap="xs" py="xl" data-testid="public-unreachable">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">{text}</Text>
      </Group>
    );
  }
  return <Alert color="red" title={text} data-testid="api-error" />;
}
