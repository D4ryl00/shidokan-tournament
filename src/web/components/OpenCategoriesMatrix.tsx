import { Button, Checkbox, Group, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { ENTRY_COLUMNS, entryCells, entryKey, type EntryCell } from '../../domain/closed-categories.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { plural } from '../../domain/plural.js';
import type { CategoryGrid, Sex } from '../../domain/types.js';
import { useClosedCategories, useSetClosedCategories } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

const LOCKED_TITLE = 'Catégorie déjà lancée : elle ne peut plus être fermée.';
const DISCIPLINE_GROUPS = [...new Set(ENTRY_COLUMNS.map((c) => c.discipline))];

/** Tableau « Catégories ouvertes » : une case par tranche × sexe × discipline × règlement, enregistrée tout de suite. */
export function OpenCategoriesMatrix({ competitionId, grid }: { competitionId: string; grid: CategoryGrid }) {
  const { data } = useClosedCategories(competitionId);
  const save = useSetClosedCategories(competitionId);
  const [pending, setPending] = useState<{ cells: EntryCell[]; count: number } | null>(null);
  if (!data) return null;
  const closed = new Set(data.closed.map(entryKey));
  const locked = new Set(data.locked);
  const valid = new Map(entryCells(grid).map((c) => [entryKey(c), c]));
  const count = (cells: EntryCell[]) => cells.reduce((n, c) => n + (data.counts[entryKey(c)] ?? 0), 0);

  /** Ferme les cases ouvertes (non verrouillées) si toutes le sont, sinon rouvre tout ; confirmation s'il y a des inscrits. */
  const toggle = (cells: EntryCell[]) => {
    const allOpen = cells.every((c) => !closed.has(entryKey(c)));
    if (!allOpen) return save.mutate({ cells: cells.filter((c) => closed.has(entryKey(c))), closed: false });
    const toClose = cells.filter((c) => !locked.has(entryKey(c)));
    if (toClose.length === 0) return;
    const n = count(toClose);
    if (n > 0) setPending({ cells: toClose, count: n });
    else save.mutate({ cells: toClose, closed: true });
  };
  const groupBox = (cells: EntryCell[], label: string, testId: string) => {
    const open = cells.filter((c) => !closed.has(entryKey(c))).length;
    return (
      <Checkbox size="xs" aria-label={label} data-testid={testId} checked={cells.length > 0 && open === cells.length}
        indeterminate={open > 0 && open < cells.length} disabled={cells.length === 0} onChange={() => toggle(cells)} />
    );
  };
  const rows = grid.ageBands.flatMap((band) => (['F', 'M'] as Sex[]).map((sex) => ({ band, sex })));

  return (
    <Stack gap="sm">
      <ApiErrorAlert error={save.error} />
      <ScrollArea type="auto">
        <Table className="sk-cell" withColumnBorders data-testid="open-categories">
          <Table.Thead>
            <Table.Tr>
              <Table.Th rowSpan={2}>Tranche</Table.Th>
              {DISCIPLINE_GROUPS.map((d) => (
                <Table.Th key={d} colSpan={ENTRY_COLUMNS.filter((c) => c.discipline === d).length} ta="center">{DISCIPLINES[d].label}</Table.Th>
              ))}
            </Table.Tr>
            <Table.Tr>
              {ENTRY_COLUMNS.map((col) => {
                const cells = [...valid.values()].filter((c) => c.discipline === col.discipline && c.ruleset === col.ruleset);
                const name = col.ruleset ? (col.ruleset === 'jiyu' ? 'Jiyu' : 'Shobu') : '—';
                return (
                  <Table.Th key={`${col.discipline}-${col.ruleset}`} ta="center">
                    <Group gap={4} justify="center" wrap="nowrap">
                      {groupBox(cells, `Toute la colonne ${DISCIPLINES[col.discipline].label} ${name}`, `open-col-${col.discipline}-${col.ruleset ?? 'none'}`)}
                      <Text size="xs" fw={600}>{name}</Text>
                    </Group>
                  </Table.Th>
                );
              })}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ band, sex }) => {
              const rowCells = [...valid.values()].filter((c) => c.ageBandCode === band.code && c.sex === sex);
              return (
                <Table.Tr key={`${band.code}-${sex}`}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Group gap={6} wrap="nowrap">
                      {groupBox(rowCells, `Toute la ligne ${band.label} ${sex}`, `open-row-${band.code}-${sex}`)}
                      <Text size="sm">{band.label} {sex}</Text>
                    </Group>
                  </Table.Td>
                  {ENTRY_COLUMNS.map((col) => {
                    const cell = valid.get(entryKey({ ageBandCode: band.code, sex, ...col }));
                    if (!cell) return <Table.Td key={`${col.discipline}-${col.ruleset}`} />;
                    const k = entryKey(cell);
                    const isLocked = locked.has(k) && !closed.has(k);
                    const n = data.counts[k] ?? 0;
                    return (
                      <Table.Td key={k} ta="center">
                        <Group gap={4} justify="center" wrap="nowrap" title={isLocked ? LOCKED_TITLE : undefined}>
                          <Checkbox size="xs" data-testid={`open-cell-${k}`} aria-label={`${band.label} ${sex} ${DISCIPLINES[col.discipline].label}${col.ruleset ? ` ${col.ruleset}` : ''}`}
                            checked={!closed.has(k)} disabled={isLocked} onChange={() => toggle([cell])} />
                          {n > 0 && <Text size="xs" c="dimmed" className="num" style={{ whiteSpace: 'nowrap' }} data-testid={`open-count-${k}`}>{plural(n, 'inscrit')}</Text>}
                        </Group>
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Modal opened={pending !== null} onClose={() => setPending(null)} title={pending && pending.cells.length > 1 ? 'Fermer ces catégories ?' : 'Fermer cette catégorie ?'}>
        <Stack>
          {pending && (
            <Text>{plural(pending.count, 'combattant déjà inscrit', 'combattants déjà inscrits')} : {pending.count > 1 ? 'ils apparaîtront' : 'il apparaîtra'} en Réaffectation.</Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPending(null)}>Annuler</Button>
            <Button data-testid="open-cells-confirm" loading={save.isPending}
              onClick={() => pending && save.mutate({ cells: pending.cells, closed: true }, { onSettled: () => setPending(null) })}>
              Fermer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
