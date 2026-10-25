import { Badge, type BadgeProps } from '@mantine/core';
import type { ReactNode } from 'react';

/** Sens d'un état : succès, attention, action, neutre, erreur ; les mêmes couleurs dans les deux thèmes. */
export type Tone = 'ok' | 'warn' | 'accent' | 'neutral' | 'danger';

const STYLE: Record<Exclude<Tone, 'danger'>, { bg: string; fg: string }> = {
  ok: { bg: 'var(--sk-ok)', fg: 'var(--sk-ok-text)' },
  warn: { bg: 'var(--sk-warn)', fg: 'var(--sk-warn-text)' },
  accent: { bg: 'var(--sk-chip)', fg: 'var(--sk-chip-text)' },
  neutral: { bg: 'var(--sk-line)', fg: 'var(--sk-soft)' },
};

/**
 * Badge d'état lisible (première lettre en capitale, couleur selon le sens). Jamais coupé par une colonne étroite d'un tableau ;
 * un badge à largeur maximale (`maw`) se coupe (texte complet au survol) ; `wrap` : message long qui passe à la ligne.
 */
export function StatusBadge({ tone, wrap = false, children, ...rest }: { tone: Tone; wrap?: boolean; children: ReactNode } & Omit<BadgeProps, 'color' | 'children'> & { 'data-testid'?: string; title?: string }) {
  const fit = wrap ? { height: 'auto', maxWidth: '100%', paddingBlock: 4 } : rest.maw === undefined ? { minWidth: 'max-content' } : {};
  const label = wrap ? { whiteSpace: 'normal' as const, overflow: 'visible', lineHeight: 1.35 } : {};
  if (tone === 'danger') return <Badge color="red" {...rest} styles={{ root: fit, label }}>{children}</Badge>;
  const s = STYLE[tone];
  return <Badge {...rest} styles={{ root: { backgroundColor: s.bg, color: s.fg, ...fit }, label }}>{children}</Badge>;
}
