import { Text } from '@mantine/core';
import type { CSSProperties } from 'react';
import { applyRulesView, costBand, NO_VALIDATION_RULES, RULE_LABELS, ruleNumber, type RulesView } from '../../../domain/replacement/rules.js';
import type { MoveView } from '../../../domain/replacement/view.js';
import { defaultSettings, type RuleId } from '../../../domain/settings.js';
import { BAND_COLOR } from './RuleLadder.js';

const ON_COLOR = 'var(--sk-on-cost)';
const pillStyle = (color: string, main: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '2px 7px', borderRadius: 10,
  border: `1.5px solid ${color}`, fontWeight: main ? 700 : 400, maxWidth: '100%', overflowWrap: 'anywhere',
});
const numberStyle = (color: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 16, height: 16, borderRadius: 8,
  background: color, color: ON_COLOR, fontSize: 10, fontWeight: 700, flex: 'none',
});

/**
 * Pastilles des règles d'un déplacement, aux couleurs de leur coût (la plus coûteuse en gras) ; une correction qui s'impose
 * sans règle (pesée vers la catégorie de son poids réel, retour) a une pastille neutre.
 */
export function RulePills({ details, rules, costRule, forced }: {
  details: MoveView['details'];
  rules: RulesView;
  costRule: RuleId | null;
  /** Texte de la pastille neutre d'une correction imposée ; `null` : aucune. */
  forced: string | null;
}) {
  const settings = applyRulesView(defaultSettings(), rules);
  const bandOf = (r: RuleId) => costBand(settings, r, !NO_VALIDATION_RULES.has(r));
  const shown = details.filter((d) => !(forced && d.rule === 'return'));
  return (
    <>
      {forced && <span data-testid="plan-rule" style={pillStyle('var(--sk-muted)', false)}>{forced}</span>}
      {shown.map((d) => {
        const color = BAND_COLOR[bandOf(d.rule)]!;
        const n = ruleNumber(rules.order, d.rule);
        return (
          <span key={d.rule} data-testid="plan-rule" style={pillStyle(color, d.rule === costRule)}>
            {n !== null && <span style={numberStyle(color)} className="num">{n}</span>}
            {RULE_LABELS[d.rule]}
            {d.detail && <Text span size="xs" c="dimmed" fw={400}>{d.detail}</Text>}
          </span>
        );
      })}
    </>
  );
}
