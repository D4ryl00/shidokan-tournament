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

/** Badge d'état lisible (première lettre en capitale, couleur selon le sens). */
export function StatusBadge({ tone, children, ...rest }: { tone: Tone; children: ReactNode } & Omit<BadgeProps, 'color' | 'children'> & { 'data-testid'?: string; title?: string }) {
  if (tone === 'danger') return <Badge color="red" {...rest}>{children}</Badge>;
  const s = STYLE[tone];
  return <Badge {...rest} styles={{ root: { backgroundColor: s.bg, color: s.fg } }}>{children}</Badge>;
}
