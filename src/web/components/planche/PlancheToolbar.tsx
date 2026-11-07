import { Button, Checkbox, Group, SegmentedControl, Select, TextInput } from '@mantine/core';
import type { Wave } from '../../../domain/waves.js';
import { IconSearch } from '../ui/icons.js';
import type { PlancheSort } from './model.js';

export type Scope = 'wave' | 'waiting' | 'all';

/** Barre de la planche : session, recherche, classement, « Seulement à traiter », Historique. */
export function PlancheToolbar({ waves, waveId, scope, waiting, onScope, query, onQuery, sort, onSort, onlyTodo, onOnlyTodo, historyCount, onHistory }: {
  waves: Wave[]; waveId: string | null; scope: Scope; waiting: number; onScope: (v: string) => void;
  query: string; onQuery: (v: string) => void; sort: PlancheSort; onSort: (v: PlancheSort) => void;
  onlyTodo: boolean; onOnlyTodo: (v: boolean) => void; historyCount: number; onHistory?: () => void;
}) {
  return (
    <Group gap="sm" align="flex-end" data-testid="planche-toolbar">
      {waves.length > 0 && (
        <SegmentedControl size="xs" data-testid="brackets-wave" value={scope === 'wave' ? (waveId ?? '') : scope} onChange={onScope}
          data={[...waves.map((w) => ({ value: w.id, label: w.name })), ...(waiting ? [{ value: 'waiting', label: `En attente (${waiting})` }] : []), { value: 'all', label: 'Toutes' }]} />
      )}
      <TextInput data-testid="planche-search" placeholder="Chercher une catégorie ou un combattant" aria-label="Chercher une catégorie ou un combattant"
        leftSection={<IconSearch />} value={query} onChange={(e) => onQuery(e.currentTarget.value)} style={{ flex: '1 1 220px', minWidth: 0 }} />
      <Select data-testid="planche-sort" size="sm" w={170} label="Classer par" allowDeselect={false} value={sort}
        data={[{ value: 'categorie', label: 'Catégorie' }, { value: 'zone', label: 'Zone' }]} onChange={(v) => v && onSort(v as PlancheSort)} />
      <Checkbox data-testid="planche-todo" size="sm" label="Seulement à traiter" checked={onlyTodo} onChange={(e) => onOnlyTodo(e.currentTarget.checked)} pb={6} />
      {onHistory && <Button size="compact-sm" variant="default" data-testid="history-open" onClick={onHistory}>Historique ({historyCount})</Button>}
    </Group>
  );
}
