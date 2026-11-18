import { Button, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { MoveView } from '../../../domain/replacement/view.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { useRegistrations } from '../../api.js';
import { clubRequestText } from './clubText.js';

/**
 * « 📋 Copier pour le club » : une ligne par combattant déplacé, dans le presse-papiers. Presse-papiers refusé ou absent :
 * le texte est montré dans la notification, pour le copier à la main.
 */
export function CopyForClub({ competitionId, view, grid, size = 'xs' }: { competitionId: string; view: MoveView; grid: CategoryGrid; size?: 'xs' | 'compact-xs' }) {
  const { data: regs = [] } = useRegistrations(competitionId);
  const copy = async () => {
    const text = clubRequestText(view, grid, (rid) => {
      const r = regs.find((x) => x.id === rid);
      return r ? { firstName: r.fighter.firstName, lastName: r.fighter.lastName, club: r.club?.name ?? null } : { firstName: '', lastName: rid, club: null };
    });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard');
      await navigator.clipboard.writeText(text);
      notifications.show({ color: 'green', message: <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>Copié : {text}</Text> });
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
  };
  return (
    <Button size={size} variant="outline" color="green" data-testid="move-copy" onClick={() => void copy()}>
      📋 Copier pour le club
    </Button>
  );
}
