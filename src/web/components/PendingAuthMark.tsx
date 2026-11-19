import { Text } from '@mantine/core';

/** Pastille ⏳ d'un combattant dont une autorisation du coach est en attente ; le survol dit laquelle. */
export function PendingAuthMark({ texts }: { texts: string[] }) {
  return <Text span size="xs" data-testid="auth-pending" title={texts.join('\n')} aria-label="Autorisation en attente" style={{ cursor: 'help' }}>⏳</Text>;
}
