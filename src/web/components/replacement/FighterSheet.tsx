import { Box, Text } from '@mantine/core';
import { useMemo } from 'react';
import { useCategories, useGrid, useRegistrations, useWaves, useWeighIn } from '../../api.js';
import { disciplineLabel } from '../../labels.js';
import { useRecasementDetails } from '../ReplacementBadge.js';
import { sheetLines } from './sheetLines.js';

/** Fiche d'un combattant (sans le club), sous son nom dans les détails d'une réaffectation. */
export function FighterSheet({ competitionId, registrationId }: { competitionId: string; registrationId: string }) {
  const { data: regs } = useRegistrations(competitionId);
  const { data: grid } = useGrid(competitionId);
  const { data: weighIn } = useWeighIn(competitionId);
  const { data: categories } = useCategories(competitionId);
  const { data: waves } = useWaves(competitionId);
  const recasements = useRecasementDetails(competitionId);
  const row = regs?.find((r) => r.id === registrationId);

  const lines = useMemo(() => {
    if (!row || !grid) return null;
    const presence = weighIn?.fighters.find((x) => x.fighterId === row.fighterId)?.presence ?? null;
    const others = (regs ?? []).filter((r) => r.fighterId === row.fighterId && r.id !== row.id).map((r) => {
      const cat = categories?.find((c) => c.registrationIds.includes(r.id));
      return { label: cat?.label ?? disciplineLabel(r.discipline), session: (cat?.waveId && waves?.find((w) => w.id === cat.waveId)?.name) || null };
    });
    return sheetLines(row, { grid, presence, others, recasement: recasements.get(row.id) });
  }, [row, grid, weighIn, regs, categories, waves, recasements]);

  if (!lines) return <Text size="xs" c="dimmed">Chargement…</Text>;
  return (
    <Box
      data-testid="fighter-sheet"
      style={{ borderLeft: '3px solid var(--sk-accent)', background: 'var(--sk-row)', padding: '6px 10px', fontSize: 12 }}
    >
      <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, max-content) 1fr', gap: '2px 8px', margin: 0 }}>
        {lines.map((l) => (
          <div key={l.label} style={{ display: 'contents' }}>
            <dt style={{ color: 'var(--sk-muted)' }}>{l.label}</dt>
            <dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{l.value}</dd>
          </div>
        ))}
      </dl>
    </Box>
  );
}
