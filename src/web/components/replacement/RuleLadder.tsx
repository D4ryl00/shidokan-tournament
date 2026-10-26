import { ActionIcon, Box, Switch, Text } from '@mantine/core';
import { Fragment, useState, type CSSProperties } from 'react';
import { plural } from '../../../domain/plural.js';
import { applyRulesView, COST_BAND_LABELS, costBand, NO_VALIDATION_RULES, RULE_LABELS, type RulesView } from '../../../domain/replacement/rules.js';
import { defaultSettings, type RuleId } from '../../../domain/settings.js';
import type { LadderRow } from '../../api.js';

/** Couleur de chaque groupe de coût (`COST_BAND_LABELS`), du vert au rouge. */
export const BAND_COLOR = ['var(--sk-cost0)', 'var(--sk-cost1)', 'var(--sk-cost2)', 'var(--sk-cost3)', 'var(--sk-cost4)'];

/** Déplace la règle `from` à l’index `to` ; `return` reste en tête. */
function moved(order: RuleId[], from: number, to: number): RuleId[] {
  if (from < 1 || to < 1 || from === to || to >= order.length) return order;
  const next = [...order];
  const [r] = next.splice(from, 1);
  next.splice(to, 0, r!);
  return next;
}

const barStyle = (pct: number, color: string): CSSProperties => ({
  width: `${pct}%`, minWidth: 'min(2.2rem, 100%)', maxWidth: '100%', boxSizing: 'border-box',
  background: color, color: '#fff', borderRadius: 6, padding: '2px 8px', fontWeight: 700, fontSize: 13, lineHeight: 1.5,
});

/**
 * La liste des règles de réaffectation : l’ordre est la priorité, la ligne pointillée « je m’arrête ici » la limite des règles
 * appliquées. Avec `rows` (le plan), chaque règle a sa barre alignée à gauche : combattants encore seuls une fois les règles
 * jusqu’à celle-là permises.
 */
export function RuleLadder({ view, rows, onChange, busy }: { view: RulesView; rows?: LadderRow[]; onChange: (v: RulesView) => void; busy?: boolean }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const settings = applyRulesView(defaultSettings(), view);
  const byRule = new Map(rows?.filter((r) => r.rule !== null).map((r) => [r.rule, r]));
  const start = rows?.find((r) => r.rule === null);
  // Une règle peut laisser plus de combattants seuls que le départ (correction de poids obligatoire) : l’échelle est le plus grand nombre.
  const max = Math.max(1, ...(rows ?? []).map((r) => r.alone ?? 0));
  const pct = (n: number) => (n / max) * 100;
  const reorder = (from: number, to: number) => onChange({ ...view, order: moved(view.order, from, to) });
  const bandOf = (rule: RuleId) => costBand(settings, rule, !NO_VALIDATION_RULES.has(rule));

  return (
    <Box data-testid="rule-ladder" role="group" aria-label="Règles de réaffectation" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {start && (
        <Box data-testid="ladder-start" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
          <Text size="sm" fw={600} style={{ flex: '1 1 160px', minWidth: 0 }}>Sans rien changer</Text>
          <Box style={{ flex: '2 1 200px', minWidth: 0 }}>
            <Box data-testid="ladder-alone" style={barStyle(pct(start.alone ?? 0), 'var(--sk-text)')}><span style={{ color: 'var(--sk-bg)' }}>{start.alone ?? 0}</span></Box>
          </Box>
          <Text size="xs" c="dimmed" style={{ flex: '1 1 100%' }}>combattants seuls au départ</Text>
        </Box>
      )}
      {view.order.map((rule, i) => {
        const on = rule === 'return' || view.on[rule];
        const row = byRule.get(rule);
        const band = bandOf(rule);
        const manual = !NO_VALIDATION_RULES.has(rule);
        const label = RULE_LABELS[rule];
        const fixed = rule === 'return';
        return (
          <Fragment key={rule}>
            <Box
              data-testid="ladder-row" data-rule={rule}
              draggable={!fixed && !busy}
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (dragFrom !== null && !fixed) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) reorder(dragFrom, i); setDragFrom(null); }}
              onDragEnd={() => setDragFrom(null)}
              onClick={() => { if (!busy && view.cutAfter !== rule) onChange({ ...view, cutAfter: rule }); }}
              style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                background: 'var(--sk-row)', border: '1px solid var(--sk-card-line)', opacity: on ? 1 : 0.55,
                outline: dragFrom === i ? '2px dashed var(--sk-accent)' : undefined,
              }}
            >
              <span aria-hidden style={{ width: 16, color: 'var(--sk-muted)', cursor: fixed ? 'default' : 'grab', userSelect: 'none', visibility: fixed ? 'hidden' : 'visible' }}>⠿</span>
              <span style={{ display: 'inline-flex', gap: 2, minWidth: 56 }} onClick={(e) => e.stopPropagation()}>
                {!fixed && (
                  <>
                    <ActionIcon data-testid="ladder-up" variant="subtle" color="gray" size="sm" aria-label={`Monter « ${label} »`} disabled={busy || i <= 1} onClick={() => reorder(i, i - 1)}>↑</ActionIcon>
                    <ActionIcon data-testid="ladder-down" variant="subtle" color="gray" size="sm" aria-label={`Descendre « ${label} »`} disabled={busy || i >= view.order.length - 1} onClick={() => reorder(i, i + 1)}>↓</ActionIcon>
                  </>
                )}
              </span>
              <Text size="sm" c="dimmed" className="num" style={{ minWidth: 18 }}>{i + 1}</Text>
              <Text size="sm" fw={600} style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
                {label}
                {manual && <Text span size="xs" c="dimmed" fw={400}> · à valider</Text>}
              </Text>
              <span role="img" aria-label={COST_BAND_LABELS[band]} title={COST_BAND_LABELS[band]}
                style={{ width: 12, height: 12, borderRadius: '50%', background: BAND_COLOR[band], flex: 'none' }} />
              <span style={{ width: 40, display: 'inline-flex', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                {!fixed && (
                  <Switch data-testid="ladder-switch" aria-label={`${label} : active`} checked={view.on[rule]} disabled={busy}
                    onChange={(e) => onChange({ ...view, on: { ...view.on, [rule]: e.currentTarget.checked } })} />
                )}
              </span>
              {rows && on && row && row.alone !== null && (
                <>
                  <Box style={{ flex: '2 1 200px', minWidth: 0 }}>
                    <Box data-testid="ladder-alone" style={barStyle(pct(row.alone), BAND_COLOR[band]!)}>{row.alone}</Box>
                  </Box>
                  <Text size="xs" c="dimmed" style={{ flex: '1 1 100%' }}>{plural(row.moves, 'déplacement', 'déplacements')} · {row.toValidate} à valider</Text>
                </>
              )}
            </Box>
            {view.cutAfter === rule && (
              <Box data-testid="ladder-cut" role="separator" style={{ borderTop: '2px dashed var(--sk-accent)', color: 'var(--sk-accent)', fontSize: 12, fontWeight: 700, paddingTop: 2, textAlign: 'center' }}>
                je m’arrête ici
              </Box>
            )}
          </Fragment>
        );
      })}
    </Box>
  );
}
