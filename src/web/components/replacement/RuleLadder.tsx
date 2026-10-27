import { ActionIcon, Box, Switch, Text, UnstyledButton } from '@mantine/core';
import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import { plural } from '../../../domain/plural.js';
import { applyRulesView, COST_BAND_LABELS, costBand, NO_VALIDATION_RULES, RULE_LABELS, ruleNumber, type CostBand, type RulesView } from '../../../domain/replacement/rules.js';
import { defaultSettings, type RuleId } from '../../../domain/settings.js';
import type { LadderRow } from '../../api.js';
import { rowBars, type LadderBar } from './ladderBars.js';

/** Couleur de chaque groupe de coût (`COST_BAND_LABELS`), du vert au rouge. */
export const BAND_COLOR = ['var(--sk-cost0)', 'var(--sk-cost1)', 'var(--sk-cost2)', 'var(--sk-cost3)', 'var(--sk-cost4)'];
/** Part « restent seuls » d'une barre : hachures rouges. */
const HATCH = 'repeating-linear-gradient(45deg, var(--sk-alone) 0 6px, var(--sk-alone-alt) 6px 12px)';

/** Déplace la règle `from` à l’index `to` ; `return` reste en tête. */
function moved(order: RuleId[], from: number, to: number): RuleId[] {
  if (from < 1 || to < 1 || from === to || to >= order.length) return order;
  const next = [...order];
  const [r] = next.splice(from, 1);
  next.splice(to, 0, r!);
  return next;
}

// Colonnes du tableau : mêmes largeurs pour l'en-tête et chaque ligne (sur un écran étroit, les lignes passent à la ligne).
const COL = {
  handle: { width: 16, flex: 'none' },
  arrows: { minWidth: 56, flex: 'none' },
  number: { minWidth: 18, flex: 'none' },
  name: { flex: '1 1 160px', minWidth: 0 },
  cost: { width: 32, flex: 'none', display: 'inline-flex', justifyContent: 'center' },
  active: { width: 48, flex: 'none', display: 'inline-flex', justifyContent: 'flex-end' },
  bar: { flex: '2 1 200px', minWidth: 0 },
  moves: { flex: '0 1 120px', minWidth: 0 },
} satisfies Record<string, CSSProperties>;
const ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', padding: '6px 8px', borderRadius: 8 };
const HEAD: CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--sk-muted)' };

/** Ce que contient la ligne de départ : « 1 retour · 1 poids hors catégorie · 2 choix du plan ». */
function startDetail(start: NonNullable<LadderRow['start']>): string {
  const parts = [
    start.returns > 0 ? plural(start.returns, 'retour') : '',
    start.weights > 0 ? `${start.weights.toLocaleString('fr-FR')} poids hors catégorie` : '',
    start.choices > 0 ? plural(start.choices, 'choix du plan', 'choix du plan') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'aucune correction';
}

/** Barre « casés · restent seuls » : les casés par couleur de coût, puis les seuls hachurés ; toute la largeur est l'échelle. */
function Bar({ bar }: { bar: LadderBar }) {
  const placed = bar.placed.reduce((n, s) => n + s.count, 0);
  const pct = (n: number) => `${(n / bar.total) * 100}%`;
  const title = [...bar.placed.map((s) => `${plural(s.count, 'casé')} (${COST_BAND_LABELS[s.band].toLowerCase()})`), plural(bar.alone, 'seul')].join(' · ');
  const cell: CSSProperties = { height: '100%', display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, boxSizing: 'border-box' };
  return (
    <Box data-testid="ladder-bar" data-placed={placed} data-alone={bar.alone} title={bar.total === 0 ? undefined : title}
      style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', width: '100%' }}>
      {bar.total === 0 ? (
        <Text size="xs" c="dimmed" style={{ alignSelf: 'center' }}>Aucun combattant seul</Text>
      ) : (
        <>
          {bar.placed.map((s, i) => (
            <span key={i} data-testid="ladder-segment" data-band={s.band}
              style={{ ...cell, width: pct(s.count), background: BAND_COLOR[s.band], color: 'var(--sk-on-cost)', justifyContent: 'center' }}>
              {s.count}
            </span>
          ))}
          {bar.alone > 0 && (
            <span data-testid="ladder-alone" style={{ ...cell, width: pct(bar.alone), background: HATCH, color: 'var(--sk-alone-text)', paddingLeft: 8 }}>
              {plural(bar.alone, 'seul')}
            </span>
          )}
        </>
      )}
    </Box>
  );
}

/** Légende des barres : les couleurs de casés présentes, puis les hachures des seuls. */
function Legend({ bands }: { bands: CostBand[] }) {
  const chip = (background: string): CSSProperties => ({ width: 22, height: 12, borderRadius: 3, background, display: 'inline-block', flex: 'none' });
  return (
    <Box data-testid="ladder-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: 'var(--sk-soft)', padding: '0 8px' }}>
      {bands.map((b) => (
        <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={chip(BAND_COLOR[b]!)} />casés : {COST_BAND_LABELS[b].toLowerCase()}</span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={chip(HATCH)} />restent seuls</span>
    </Box>
  );
}

/**
 * La liste des règles de réaffectation, en tableau : l’ordre est la priorité, la ligne pointillée « je m’arrête ici » la limite
 * des règles appliquées. La première ligne (le retour, fixe) est le départ : les corrections imposées (retours, poids hors
 * catégorie) et les choix du plan. Avec `rows` (le plan), chaque ligne a sa barre « casés · restent seuls » à l'échelle des
 * seuls du départ : les casés prennent la couleur de coût de la règle qui les a casés.
 */
export function RuleLadder({ view, rows, onChange, busy, fresh }: {
  view: RulesView;
  rows?: LadderRow[];
  onChange: (v: RulesView) => void;
  busy?: boolean;
  /** Pendant un calcul : les lignes (`null` : le départ) déjà recalculées ; les autres, celles du plan précédent, sont grisées. */
  fresh?: ReadonlySet<RuleId | null>;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const settings = applyRulesView(defaultSettings(), view);
  const byRule = new Map(rows?.filter((r) => r.rule !== null).map((r) => [r.rule, r]));
  const stale = (rule: RuleId) => (fresh && !fresh.has(rule) ? 0.4 : 1);
  const reorder = (from: number, to: number) => onChange({ ...view, order: moved(view.order, from, to) });
  const bandOf = (rule: RuleId) => costBand(settings, rule, !NO_VALIDATION_RULES.has(rule));
  const isOn = (rule: RuleId) => rule === 'return' || view.on[rule];

  const startRow = byRule.get('return');
  const { start, bars } = rowBars(rows ?? [], bandOf);
  const shownBands = [...new Set([...bars.values()].flatMap((b) => b.placed.map((s) => s.band)))].sort();

  /** Colonne Déplacements : « 3 » ou « 3 · 1 à valider ». */
  const movesCell = (row: LadderRow): ReactNode => (
    <Text size="xs" c="dimmed" className="num" style={COL.moves}>
      {row.moves}
      {row.toValidate > 0 && <> · <Text span size="xs" fw={700} c="var(--sk-text)">{row.toValidate} à valider</Text></>}
    </Text>
  );

  return (
    <Box data-testid="rule-ladder" role="group" aria-label="Règles de réaffectation" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows && start !== null && start > 0 && <Legend bands={shownBands} />}
      <Box data-testid="ladder-header" visibleFrom="sm" style={{ ...ROW, ...HEAD, paddingTop: 0, paddingBottom: 2, borderBottom: '1px solid var(--sk-line)', borderRadius: 0 }}>
        <span style={COL.handle} /><span style={COL.arrows} />
        <span style={COL.number}>N°</span>
        <span style={COL.name}>Règle</span>
        <span style={COL.cost}>Coût</span>
        <span style={COL.active}>Active</span>
        {rows && <><span style={COL.bar}>Combattants : casés · restent seuls</span><span style={COL.moves}>Déplacements</span></>}
      </Box>
      {view.order.map((rule, i) => {
        const on = isOn(rule);
        const row = byRule.get(rule);
        const band = bandOf(rule);
        const manual = !NO_VALIDATION_RULES.has(rule);
        const label = RULE_LABELS[rule];
        const fixed = rule === 'return';
        const number = ruleNumber(view.order, rule);
        const cutHere = () => { if (!busy && view.cutAfter !== rule) onChange({ ...view, cutAfter: rule }); };
        const bar = fixed ? (start === null ? undefined : { placed: [], alone: start, total: start }) : bars.get(rule);
        const title = fixed
          ? `Au départ, corrections imposées${(startRow?.start?.choices ?? 0) > 0 ? ' et vos choix' : ''}`
          : label;
        return (
          <Fragment key={rule}>
            <Box
              data-testid="ladder-row" data-rule={rule}
              draggable={!fixed && !busy}
              // Firefox ne commence un glisser qu'avec une donnée.
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', rule); }}
              onDragOver={(e) => { if (dragFrom !== null && !fixed) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) reorder(dragFrom, i); setDragFrom(null); }}
              onDragEnd={() => setDragFrom(null)}
              onClick={cutHere}
              style={{
                ...ROW, cursor: 'pointer',
                background: fixed ? 'var(--sk-chip)' : 'var(--sk-row)', border: '1px solid var(--sk-card-line)', opacity: on ? 1 : 0.55,
                outline: dragFrom === i ? '2px dashed var(--sk-accent)' : undefined,
              }}
            >
              <span aria-hidden style={{ ...COL.handle, color: 'var(--sk-muted)', cursor: fixed ? 'default' : 'grab', userSelect: 'none', visibility: fixed ? 'hidden' : 'visible' }}>⠿</span>
              <span style={{ ...COL.arrows, display: 'inline-flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                {!fixed && (
                  <>
                    <ActionIcon data-testid="ladder-up" variant="subtle" color="gray" size="sm" aria-label={`Monter « ${label} »`} disabled={busy || i <= 1} onClick={() => reorder(i, i - 1)}>↑</ActionIcon>
                    <ActionIcon data-testid="ladder-down" variant="subtle" color="gray" size="sm" aria-label={`Descendre « ${label} »`} disabled={busy || i >= view.order.length - 1} onClick={() => reorder(i, i + 1)}>↓</ActionIcon>
                  </>
                )}
              </span>
              <Text size="sm" c="dimmed" className="num" style={COL.number}>{number ?? ''}</Text>
              {/* Le nom est aussi le bouton « s'arrêter ici » au clavier (Tab, puis Entrée ou Espace). */}
              <UnstyledButton data-testid={fixed ? 'ladder-start' : 'ladder-cut-here'} aria-label={`S’arrêter après « ${title} »`} aria-pressed={view.cutAfter === rule} disabled={busy}
                onClick={(e) => { e.stopPropagation(); cutHere(); }}
                style={{ ...COL.name, cursor: 'inherit', borderRadius: 4 }}>
                <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
                  {title}
                  {manual && <Text span size="xs" c="dimmed" fw={400}> · à valider</Text>}
                </Text>
                {fixed && (
                  <Text data-testid="ladder-start-detail" size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                    {startRow?.start ? startDetail(startRow.start) : 'retours et poids hors catégorie, toujours faits'}
                  </Text>
                )}
              </UnstyledButton>
              <span style={COL.cost}>
                {!fixed && (
                  <span role="img" aria-label={COST_BAND_LABELS[band]} title={COST_BAND_LABELS[band]}
                    style={{ width: 12, height: 12, borderRadius: '50%', background: BAND_COLOR[band], flex: 'none' }} />
                )}
              </span>
              <span style={COL.active} onClick={(e) => e.stopPropagation()}>
                {!fixed && (
                  <Switch data-testid="ladder-switch" aria-label={`${label} : active`} checked={view.on[rule]} disabled={busy}
                    onChange={(e) => onChange({ ...view, on: { ...view.on, [rule]: e.currentTarget.checked } })} />
                )}
              </span>
              {rows && on && row && row.alone !== null && bar && (
                <>
                  <Box style={{ ...COL.bar, opacity: stale(rule) }}><Bar bar={bar} /></Box>
                  {movesCell(row)}
                </>
              )}
              {/* Règle activée dont la ligne n'est pas encore calculée : une ligne active, la barre en attente. */}
              {rows && on && !(row && row.alone !== null) && (
                <>
                  <Box style={COL.bar}>
                    <Box data-testid="ladder-pending" style={{ height: 22, width: '2.2rem', borderRadius: 6, border: '1px dashed var(--sk-muted)', color: 'var(--sk-muted)', fontSize: 13, textAlign: 'center' }}>…</Box>
                  </Box>
                  <Text size="xs" c="dimmed" style={COL.moves}>pas encore calculée</Text>
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
