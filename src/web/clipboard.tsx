import { Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';

/**
 * Copie un texte à envoyer dans le presse-papiers, avec une notification : `done` si donnée, sinon « Copié : » et le texte.
 * Presse-papiers refusé ou absent : le texte est montré dans la notification, pour le copier à la main.
 */
export async function copyWithNotice(text: string, done?: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard');
    await navigator.clipboard.writeText(text);
    notifications.show({ color: 'green', message: <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{done ?? `Copié : ${text}`}</Text> });
  } catch {
    notifications.show({
      color: 'red',
      autoClose: false,
      message: (
        <>
          <Text size="sm">Copie impossible : sélectionnez le texte ci-dessous et copiez-le.</Text>
          <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }} data-testid="copy-fallback">{text}</Text>
        </>
      ),
    });
  }
}
