import { Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import type { FfkCard, FfkOrphan } from '../../../domain/ffk-plan/plan.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { ageBandLabel, disciplineLabel } from '../../labels.js';
import { ChoiceOption } from './ChoiceOption.js';
import { searchByName, searchReady } from './search.js';

type OrphanMode = 'keep' | 'match' | 'delete';

const cardName = (c: FfkCard) => `${c.exportLine.lastName} ${c.exportLine.firstName}`;

/** « Karaté, Kata · Benjamins · onglet Karate, ligne 24 » : de quoi reconnaître une ligne de l’export. */
function cardDetails(c: FfkCard, grid: CategoryGrid | undefined): string {
  const disciplines = [...c.exportLine.combats.map(disciplineLabel), ...(c.exportLine.kata ? [disciplineLabel('kata')] : [])].join(', ') || '—';
  const age = c.exportLine.ageBandCode ? ageBandLabel(grid, c.exportLine.ageBandCode) : '—';
  const first = c.rows[0];
  return `${disciplines} · ${age}${first ? ` · onglet ${first.sheet}, ligne ${first.line}` : ''}`;
}

/**
 * 4. Fiches club sans inscription FFK : les combattants de la compétition qu’aucune ligne de l’export ne concerne. « Garder » (défaut,
 * rien ne change), « Rapprocher… » (chercher la ligne de l’export qui est ce combattant : sa carte se lie à lui et s’ouvre) ou
 * « Supprimer » (ses inscriptions sont supprimées à l’import ; refusé si ses combats ont commencé).
 */
export function OrphansSection({ orphans, cards, grid, actions, matched, onAction, onMatch }: {
  orphans: FfkOrphan[];
  cards: FfkCard[];
  grid: CategoryGrid | undefined;
  /** `choices.orphans` : le bouton enfoncé suit le clic sans attendre l’aperçu. */
  actions: Record<string, 'keep' | 'delete'> | undefined;
  /** Dernier rapprochement demandé (sa carte est ouverte plus haut). */
  matched: { cardKey: string; fighterId: string } | null;
  onAction: (fighterId: string, action: 'keep' | 'delete') => void;
  onMatch: (cardKey: string, fighterId: string) => void;
}) {
  if (orphans.length === 0) return <Text size="sm" c="dimmed">Tous les inscrits de la compétition sont dans l’export.</Text>;
  return (
    <Stack gap={0}>
      {orphans.map((o, i) => (
        <OrphanRow key={o.fighterId} orphan={o} first={i === 0} cards={cards} grid={grid} action={actions?.[o.fighterId] ?? o.action}
          matchedCard={matched?.fighterId === o.fighterId ? (cards.find((c) => c.key === matched.cardKey) ?? null) : null}
          onAction={(a) => onAction(o.fighterId, a)} onMatch={(cardKey) => onMatch(cardKey, o.fighterId)} />
      ))}
    </Stack>
  );
}

function OrphanRow({ orphan, first, cards, grid, action, matchedCard, onAction, onMatch }: {
  orphan: FfkOrphan;
  first: boolean;
  cards: FfkCard[];
  grid: CategoryGrid | undefined;
  action: 'keep' | 'delete';
  matchedCard: FfkCard | null;
  onAction: (action: 'keep' | 'delete') => void;
  onMatch: (cardKey: string) => void;
}) {
  const [matching, setMatching] = useState(false);
  const [query, setQuery] = useState('');
  const mode: OrphanMode = matching ? 'match' : action;
  const change = (m: string) => {
    setMatching(m === 'match');
    // « Rapprocher… » garde la fiche tant que la carte n’est pas validée avec ce combattant.
    onAction(m === 'delete' ? 'delete' : 'keep');
  };
  const results = searchByName(cards, query, cardName);

  return (
    <Group data-testid="ffk-orphan" justify="space-between" align="flex-start" gap="sm" py="sm"
      style={{ borderTop: first ? undefined : '1px solid var(--sk-line)' }}>
      <Stack gap={4} style={{ minWidth: 0, flex: '1 1 260px' }}>
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
          <b>{orphan.label}</b> <Text span c="dimmed">· {orphan.disciplines} · {orphan.clubName}</Text>
        </Text>
        {orphan.fromFfk && <Text size="xs" c="dimmed">présent dans l’export précédent</Text>}
        {!orphan.deletable && <Text size="xs" c="dimmed">combats commencés : ne peut pas être supprimé</Text>}
        {mode === 'delete' && <Text size="xs" c="red">L’inscription sera supprimée à l’import.</Text>}
        {mode === 'match' && (
          <Stack gap={4} mt={4}>
            {matchedCard && (
              <Text size="xs" c="green">Rapproché de la ligne FFK {cardName(matchedCard)} : sa carte est ouverte plus haut.</Text>
            )}
            <TextInput type="search" autoComplete="off" size="sm" placeholder="Chercher la ligne de l’export par son nom…"
              aria-label={`Chercher la ligne de l’export de ${orphan.label}`} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
            {searchReady(query) && (results.length
              ? results.map((c) => (
                <ChoiceOption key={c.key} checked={matchedCard?.key === c.key} onClick={() => onMatch(c.key)} sub={cardDetails(c, grid)}>
                  <b>{cardName(c)}</b>
                </ChoiceOption>
              ))
              : <Text size="xs" c="dimmed">Aucune ligne de l’export ne contient « {query.trim()} ».</Text>)}
          </Stack>
        )}
      </Stack>
      <SegmentedControl size="xs" value={mode} onChange={change} color={mode === 'delete' ? 'red' : 'blue'}
        aria-label={`Action pour ${orphan.label}`}
        data={[
          { value: 'keep', label: 'Garder' },
          { value: 'match', label: 'Rapprocher…' },
          { value: 'delete', label: 'Supprimer', disabled: !orphan.deletable },
        ]} />
    </Group>
  );
}
