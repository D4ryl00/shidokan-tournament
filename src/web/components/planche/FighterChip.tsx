import { Box, Group, Text } from '@mantine/core';
import type { HTMLAttributes } from 'react';
import type { ProposalType } from '../../../domain/replacement/index.js';
import type { RecasementEntry } from '../../api.js';
import type { EntrantInfo } from '../BracketView.js';
import { FighterInfoButton } from '../FighterInfoButton.js';
import { ReplacementBadge } from '../ReplacementBadge.js';

/**
 * Pastille d'un combattant (nom, club, badge de réaffectation dont « Placé à la main »). Le club est en orange quand le combattant
 * rencontre un coéquipier au 1er tour. `extra` : attributs ajoutés par l'appelant (glisser-déposer, clic).
 */
export function FighterChip({ id, info, badge, badgeDetail, sameClub = false, matched = false, selected = false, locked = false, compact = false, competitionId, extra }: {
  id: string;
  info?: EntrantInfo;
  badge?: ProposalType;
  badgeDetail?: RecasementEntry;
  sameClub?: boolean;
  /** Trouvé par la recherche. */
  matched?: boolean;
  selected?: boolean;
  locked?: boolean;
  /** Carte compacte (galaxie) : le nom seul, le club au survol. */
  compact?: boolean;
  /** Avec les infos du combattant : affiche ⓘ (fiche dans une bulle). */
  competitionId?: string;
  extra?: HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <Box data-testid="planche-chip" data-entrant={id} data-locked={locked || undefined} title={compact ? info?.club : undefined} {...extra}
      style={{
        border: `1px solid ${selected ? 'var(--sk-accent)' : 'var(--sk-card-line)'}`,
        outline: selected ? '2px solid var(--sk-accent)' : undefined,
        borderRadius: 6, padding: compact ? '2px 8px' : '3px 8px', minWidth: 0, backgroundColor: matched ? 'var(--sk-chip)' : 'var(--sk-card)',
        cursor: locked ? 'default' : 'grab', ...extra?.style,
      }}>
      <Group gap={2} wrap="wrap" justify="space-between" align="flex-start">
        <Text size="sm" fw={matched ? 700 : 500} lh={1.25} style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{info?.name ?? '?'}</Text>
        {competitionId && info && <FighterInfoButton competitionId={competitionId} registrationId={id} name={info.name} club={info.club} />}
        {badge && <ReplacementBadge type={badge} size="xs" detail={badgeDetail} />}
      </Group>
      {!compact && <Text size="xs" lh={1.2} c={sameClub ? 'orange' : 'dimmed'} fw={sameClub ? 600 : undefined} data-testid={sameClub ? 'same-club' : undefined} className="sk-ellipsis">
        {info?.club ?? ''}
      </Text>}
    </Box>
  );
}
