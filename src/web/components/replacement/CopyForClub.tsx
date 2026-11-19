import { Button } from '@mantine/core';
import type { MoveView } from '../../../domain/replacement/view.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { useRegistrations } from '../../api.js';
import { copyWithNotice } from '../../clipboard.js';
import { clubRequestText } from './clubText.js';

/**
 * « 📋 Copier pour le club » : une ligne par combattant déplacé, dans le presse-papiers (`copyWithNotice`).
 */
export function CopyForClub({ competitionId, view, grid, size = 'xs' }: { competitionId: string; view: MoveView; grid: CategoryGrid; size?: 'xs' | 'compact-xs' }) {
  const { data: regs = [] } = useRegistrations(competitionId);
  const copy = async () => {
    const text = clubRequestText(view, grid, (rid) => {
      const r = regs.find((x) => x.id === rid);
      return r ? { firstName: r.fighter.firstName, lastName: r.fighter.lastName, club: r.club?.name ?? null } : { firstName: '', lastName: rid, club: null };
    });
    await copyWithNotice(text);
  };
  return (
    <Button size={size} variant="outline" color="green" data-testid="move-copy" onClick={() => void copy()}>
      📋 Copier pour le club
    </Button>
  );
}
