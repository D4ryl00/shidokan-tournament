import { ActionIcon, Button, Checkbox, Group, SegmentedControl, Select, Text, TextInput } from '@mantine/core';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { Wave } from '../../../domain/waves.js';
import { IconArrowDown, IconArrowUp, IconSearch } from '../ui/icons.js';
import type { PlancheSort, Scope } from './model.js';
import type { SearchCycle } from './searchCycle.js';

export type { Scope } from './model.js';

/**
 * Recherche qui ne filtre pas : « 2 / 5 » et ↑ / ↓ pour passer d'un résultat à l'autre (planche, liste, galaxie).
 * Entrée ou ↓ : suivant ; Maj+Entrée ou ↑ : précédent ; Échap vide la recherche.
 */
export function PlancheSearch({ query, onQuery, cycle, className, style }: {
  query: string; onQuery: (v: string) => void; cycle: SearchCycle; className?: string; style?: CSSProperties;
}) {
  const searching = query.trim() !== '';
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) { e.preventDefault(); onQuery(''); }
      return;
    }
    const delta = e.key === 'Enter' ? (e.shiftKey ? -1 : 1) : e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0 || !searching) return;
    e.preventDefault();
    cycle.step(delta);
  };
  const none = cycle.total === 0;
  return (
    <TextInput data-testid="planche-search" placeholder="Chercher une catégorie ou un combattant" aria-label="Chercher une catégorie ou un combattant"
      className={className} leftSection={<IconSearch />} value={query} onChange={(e) => onQuery(e.currentTarget.value)} onKeyDown={onKeyDown}
      style={style} rightSectionWidth={searching ? 104 : undefined} rightSectionPointerEvents="all"
      rightSection={searching && (
        <Group gap={0} wrap="nowrap" pr={4}>
          <Text size="xs" className="num" c={none ? 'red' : 'dimmed'} data-testid="planche-search-count" aria-live="polite" style={{ whiteSpace: 'nowrap', marginRight: 2 }}>
            {none ? '0 / 0' : `${cycle.index + 1} / ${cycle.total}`}
          </Text>
          <ActionIcon size="sm" variant="subtle" color="gray" data-testid="planche-search-prev" aria-label="Résultat précédent (Maj+Entrée)" title="Résultat précédent (↑, Maj+Entrée)"
            disabled={none} onClick={() => cycle.step(-1)}><IconArrowUp size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="gray" data-testid="planche-search-next" aria-label="Résultat suivant (Entrée)" title="Résultat suivant (↓, Entrée)"
            disabled={none} onClick={() => cycle.step(1)}><IconArrowDown size={14} /></ActionIcon>
        </Group>
      )} />
  );
}

/**
 * Barre de la planche : session, recherche, classement, « Seulement à traiter », Historique.
 * La galaxie la reprend sans `onSort` ni `onOnlyTodo` (sans objet chez elle) et y ajoute ses puces (`children`).
 */
export function PlancheToolbar({ waves, waveId, scope, waiting, onScope, query, onQuery, cycle, sort, onSort, onlyTodo, onOnlyTodo, historyCount, onHistory, children }: {
  waves: Wave[]; waveId: string | null; scope: Scope; waiting: number; onScope: (v: string) => void;
  query: string; onQuery: (v: string) => void; cycle: SearchCycle; sort?: PlancheSort; onSort?: (v: PlancheSort) => void;
  onlyTodo?: boolean; onOnlyTodo?: (v: boolean) => void; historyCount: number; onHistory?: () => void;
  children?: ReactNode;
}) {
  return (
    <Group gap="sm" align="flex-end" data-testid="planche-toolbar" className="sk-planche-toolbar">
      {waves.length > 0 && (
        <SegmentedControl size="xs" data-testid="brackets-wave" value={scope === 'wave' ? (waveId ?? '') : scope} onChange={onScope}
          data={[...waves.map((w) => ({ value: w.id, label: w.name })), ...(waiting ? [{ value: 'waiting', label: `En attente (${waiting})` }] : []), { value: 'all', label: 'Toutes' }]} />
      )}
      <PlancheSearch query={query} onQuery={onQuery} cycle={cycle} className="sk-planche-search" style={{ flex: '1 1 220px', minWidth: 0 }} />
      {onSort && (
        <Select data-testid="planche-sort" size="sm" w={170} label="Classer par" allowDeselect={false} value={sort ?? 'categorie'}
          data={[{ value: 'categorie', label: 'Catégorie' }, { value: 'zone', label: 'Zone' }]} onChange={(v) => v && onSort(v as PlancheSort)} />
      )}
      {onOnlyTodo && <Checkbox data-testid="planche-todo" size="sm" label="Seulement à traiter" checked={onlyTodo ?? false} onChange={(e) => onOnlyTodo(e.currentTarget.checked)} pb={6} />}
      {children}
      {onHistory && <Button size="compact-sm" variant="default" data-testid="history-open" onClick={onHistory}>Historique ({historyCount})</Button>}
    </Group>
  );
}
