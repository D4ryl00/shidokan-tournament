import { Box, Text } from '@mantine/core';
import type { CSSProperties, ReactNode } from 'react';
import { plural } from '../../../domain/plural.js';
import type { RulesView } from '../../../domain/replacement/rules.js';
import type { MoveView } from '../../../domain/replacement/view.js';
import type { RuleId } from '../../../domain/settings.js';
import type { CategoryGrid } from '../../../domain/types.js';
import { keyParts, whyText } from './keyDiff.js';
import { RulePills } from './RulePills.js';

const kg = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
const tag: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--sk-muted)' };
const block = (to: boolean): CSSProperties => ({
  flex: '1 1 220px', minWidth: 0, padding: '6px 10px', borderRadius: 'var(--mantine-radius-md)',
  border: `1px solid ${to ? 'var(--sk-accent)' : 'var(--sk-line)'}`, background: 'var(--sk-bg)',
});

function Label({ view, grid, side }: { view: MoveView; grid: CategoryGrid; side: 'from' | 'to' }) {
  const key = side === 'from' ? view.from : view.to;
  if (!key) return <Text size="sm">—</Text>;
  return (
    <Text size="sm" style={{ overflowWrap: 'anywhere' }} data-testid={`move-${side}`}>
      {keyParts(key, side === 'from' ? view.to : view.from, grid).map((p, i) => (
        <span key={i}>
          {p.sep}
          {/* Un morceau ne se coupe jamais (« -45 kg » sur une ligne) : on passe à la ligne entre les morceaux. */}
          <span data-changed={p.changed ? 'true' : undefined}
            style={p.changed ? { whiteSpace: 'nowrap', fontWeight: 700, background: 'var(--sk-chip)', color: 'var(--sk-chip-text)', borderRadius: 4, padding: '0 4px' } : { whiteSpace: 'nowrap' }}>
            {p.text}
          </span>
        </span>
      ))}
    </Text>
  );
}

/** Ligne « avec qui » sous « Vers » : les noms (deux au plus), sinon le nombre d'adversaires ; vide : il y sera seul. */
function arrivalLine(view: MoveView): ReactNode {
  if (view.opponents.length === 0) {
    const e = view.sex === 'F' ? 'elle' : 'il';
    return <Text size="sm" fw={600} c="var(--sk-warn-text)">vide : {e} y sera seul{view.sex === 'F' ? 'e' : ''}, à réaffecter ensuite</Text>;
  }
  const who = view.opponents.length <= 2 ? `avec ${view.opponents.join(' et ')}` : plural(view.opponents.length, 'adversaire', 'adversaires');
  const gap = view.gap ? ` · écart ${kg(view.gap.kg)} kg (max ${kg(view.gap.max)})` : '';
  return <Text size="sm">{who}{gap}</Text>;
}

/**
 * Une proposition (carte ou ligne du plan) lisible d'un coup d'œil : pourquoi, « De ➜ Vers » avec ce qui change surligné,
 * puis les pastilles des règles. Les blocs passent l'un sous l'autre sur un écran étroit.
 */
export function MoveBlocks({ view, grid, rules, costRule, children }: {
  view: MoveView;
  grid: CategoryGrid;
  rules: RulesView;
  costRule: RuleId | null;
  /** Badges en plus, sous les pastilles (pré-accord, changement de session…). */
  children?: ReactNode;
}) {
  const forced = view.forced ? (view.why.kind === 'return' ? 'Retour · imposé' : 'Correction de pesée · imposée') : null;
  return (
    <Box data-testid="move-blocks" style={{ minWidth: 0, flex: '1 1 100%' }}>
      <Box style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={tag}>Pourquoi</span>
        <Text size="sm" data-testid="move-why" style={{ overflowWrap: 'anywhere' }}>{whyText(view.why, view.sex)}</Text>
      </Box>
      <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch' }}>
        <Box style={block(false)}>
          <div style={tag}>De</div>
          <Label view={view} grid={grid} side="from" />
          {view.from && (
            <Text size="sm" c="var(--sk-muted)">
              {plural(view.fromCount, 'combattant', 'combattants')} → {view.fromRemaining === 0 ? 'il n’en restera aucun' : `il en restera ${view.fromRemaining}`}
            </Text>
          )}
        </Box>
        {/* Écran étroit : les blocs passent l'un sous l'autre, la flèche descend. */}
        <Box aria-hidden visibleFrom="sm" style={{ alignSelf: 'center', color: 'var(--sk-accent)', fontSize: 20, padding: '0 2px' }}>➜</Box>
        <Box aria-hidden hiddenFrom="sm" style={{ flex: '1 1 100%', textAlign: 'center', color: 'var(--sk-accent)', fontSize: 20, lineHeight: 1 }}>⬇</Box>
        <Box style={block(true)}>
          <div style={tag}>Vers</div>
          <Label view={view} grid={grid} side="to" />
          {arrivalLine(view)}
        </Box>
      </Box>
      <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginTop: 6 }}>
        <RulePills details={view.details} rules={rules} costRule={costRule} forced={forced} />
        {children}
      </Box>
    </Box>
  );
}
