import { Button, Checkbox, Group, SegmentedControl, Select, TextInput } from '@mantine/core';
import type { ReactNode } from 'react';
import type { Wave } from '../../../domain/waves.js';
import { IconSearch } from '../ui/icons.js';
import type { PlancheSort } from './model.js';

export type Scope = 'wave' | 'waiting' | 'all';

/**
 * Barre de la planche : session, recherche, classement, « Seulement à traiter », Historique.
 * La galaxie la reprend sans `onSort` ni `onOnlyTodo` (sans objet chez elle) et y ajoute ses puces (`children`).
 */
export function PlancheToolbar({ waves, waveId, scope, waiting, onScope, query, onQuery, sort, onSort, onlyTodo, onOnlyTodo, historyCount, onHistory, children }: {
  waves: Wave[]; waveId: string | null; scope: Scope; waiting: number; onScope: (v: string) => void;
  query: string; onQuery: (v: string) => void; sort?: PlancheSort; onSort?: (v: PlancheSort) => void;
  onlyTodo?: boolean; onOnlyTodo?: (v: boolean) => void; historyCount: number; onHistory?: () => void;
  children?: ReactNode;
}) {
  return (
    <Group gap="sm" align="flex-end" data-testid="planche-toolbar">
      {waves.length > 0 && (
        <SegmentedControl size="xs" data-testid="brackets-wave" value={scope === 'wave' ? (waveId ?? '') : scope} onChange={onScope}
          data={[...waves.map((w) => ({ value: w.id, label: w.name })), ...(waiting ? [{ value: 'waiting', label: `En attente (${waiting})` }] : []), { value: 'all', label: 'Toutes' }]} />
      )}
      <TextInput data-testid="planche-search" placeholder="Chercher une catégorie ou un combattant" aria-label="Chercher une catégorie ou un combattant"
        leftSection={<IconSearch />} value={query} onChange={(e) => onQuery(e.currentTarget.value)} style={{ flex: '1 1 220px', minWidth: 0 }} />
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
