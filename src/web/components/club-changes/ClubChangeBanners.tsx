import { Button, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { plural } from '../../../domain/plural.js';
import { useClubChanges, type ClubChangeView } from '../../api.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { frDate } from './ClubChangeModal.js';

/** Au-delà de ce nombre de clubs, un seul bandeau en donne le nombre. */
const MAX_BANNERS = 3;

function Banner({ testId, action, children }: { testId: string; action: ReactNode; children: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md" data-testid={testId} role="status"
      style={{ background: 'var(--sk-warn)', color: 'var(--sk-warn-text)', borderRadius: 'var(--mantine-radius-md)', padding: '10px 14px' }}>
      <Text size="sm" fw={500} c="inherit" style={{ overflowWrap: 'anywhere' }}>{children}</Text>
      {action}
    </Group>
  );
}

const button = (label: string, onOpen: () => void) => (
  <Button size="compact-sm" variant="default" onClick={onOpen} style={{ flexShrink: 0 }}>{label}</Button>
);

/** Page de l'annuaire : combien de clubs diffèrent de leur fiche après une modification dans une compétition. */
export function DirectoryChangesBanner({ onOpen }: { onOpen: () => void }) {
  const { data: changes = [] } = useClubChanges();
  if (changes.length === 0) return null;
  const n = changes.length;
  return (
    <Banner testId="directory-changes-banner" action={button('Voir les changements', onOpen)}>
      {n === 1 ? '1 club diffère' : `${n} clubs diffèrent`} de l’annuaire après une modification dans une compétition.
    </Banner>
  );
}

/** Fiche club d'une compétition : un bandeau par club qui diffère de l'annuaire (un seul, avec le nombre, au-delà de trois). */
export function CompetitionChangesBanner({ competitionId, onOpen }: { competitionId: string; onOpen: (clubId: string | null) => void }) {
  const { data: changes = [] } = useClubChanges(competitionId);
  if (changes.length === 0) return null;
  if (changes.length > MAX_BANNERS) {
    return (
      <Banner testId="competition-changes-banner" action={button('Voir les changements', () => onOpen(null))}>
        {plural(changes.length, 'club diffère', 'clubs diffèrent')} de l’annuaire.
      </Banner>
    );
  }
  return (
    <>
      {changes.map((c: ClubChangeView) => (
        <Banner key={c.clubId} testId="competition-changes-banner" action={button('Comparer', () => onOpen(c.clubId))}>
          {c.values.name} a été modifié le {frDate(c.changedAt)} {c.origin === 'club' ? 'par le club' : 'dans la compétition'} : il diffère de l’annuaire.
        </Banner>
      ))}
    </>
  );
}

/** Origine d'un changement à examiner, sur la ligne d'un club ou d'une fiche. */
export function ClubChangePill({ origin }: { origin: 'club' | 'competition' }) {
  return <StatusBadge tone="warn" size="sm" data-testid="club-change-pill">{origin === 'club' ? 'Modifié par le club' : 'Modifié dans la compétition'}</StatusBadge>;
}
