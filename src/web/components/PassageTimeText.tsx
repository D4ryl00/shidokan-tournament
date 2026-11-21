import { Text } from '@mantine/core';
import type { Category } from '../../domain/categories.js';
import type { CategoryTimes, OrganiserTimes, PassageTime } from '../../domain/schedule/organiser-times.js';
import { driftText, versText } from './public/zoneRows.js';
import { StatusBadge } from './ui/StatusBadge.js';

/** « sur le tatami » ou « vers H:MM ». */
export function passageTimeText(t: PassageTime): string {
  return t.kind === 'onTatami' ? 'sur le tatami' : versText(t.clock);
}

/**
 * « Zone · prochain vers H:MM · finale vers H:MM » (« 1er combat » / kata « tour 1 » tant que rien n'est joué) ; parties absentes
 * omises. Prochain passage = la finale : « Zone · finale vers H:MM » (« Zone · sur le tatami » quand elle y est).
 */
export function categoryTimesText(zone: string | null, t: CategoryTimes, kata: boolean): string {
  if (t.nextIsFinal && t.next !== null) {
    const final = t.next.kind === 'onTatami' ? passageTimeText(t.next) : `finale ${passageTimeText(t.next)}`;
    return [zone, final].filter((p): p is string => !!p).join(' · ');
  }
  const first = kata ? 'tour 1' : '1er combat';
  const next = t.next === null ? null
    : t.next.kind === 'onTatami' ? passageTimeText(t.next)
    : `${t.first ? first : 'prochain'} ${passageTimeText(t.next)}`;
  const final = t.final ? `finale ${passageTimeText(t.final)}` : null;
  return [zone, next, final].filter((p): p is string => !!p).join(' · ');
}

/** Heure d'un passage : accent et gras ; estimée d'une session pas encore lancée : estompée et en italique. */
export function PassageTimeLabel({ t, size = 'xs' }: { t: PassageTime | null; size?: 'xs' | 'sm' }) {
  if (!t) return null;
  const planned = t.kind === 'at' && t.planned;
  return planned
    ? <Text span size={size} c="dimmed" fs="italic" data-testid="passage-time" data-planned="true">{passageTimeText(t)}</Text>
    : <Text span size={size} fw={700} style={{ color: 'var(--sk-accent)' }} data-testid="passage-time" data-planned="false">{passageTimeText(t)}</Text>;
}

/** Heures d'une catégorie estimées pour une session pas encore lancée. */
export const plannedCategory = (t: CategoryTimes | null): boolean => [t?.next, t?.final].some((p) => p?.kind === 'at' && p.planned);

/**
 * Ligne d'heures d'une catégorie dans une liste (« Tatami 1 · prochain vers 10:42 · finale vers 11:35 ») ; estompée pour une
 * session pas encore lancée ; rien pour une catégorie terminée ou sans heure.
 */
export function CategoryTimesLine({ category, times, zone }: { category: Pick<Category, 'id' | 'bracket' | 'status'>; times: OrganiserTimes; zone: string | null }) {
  if (category.status === 'finished') return null;
  const t = times.category(category);
  if (!t) return null;
  const planned = plannedCategory(t);
  return (
    <Text size="xs" mt={4} data-testid="category-times" c={planned ? 'dimmed' : undefined} fs={planned ? 'italic' : undefined}>
      {categoryTimesText(zone, t, category.bracket?.kind === 'kata')}
    </Text>
  );
}

/** Avance (vert) ou retard (orange) d'une zone ; rien sans valeur (session pas lancée) ni quand elle est à l'heure. */
export function ZoneDriftBadge({ drift, size }: { drift: number | null; size: 'md' | 'lg' }) {
  if (drift === null) return null;
  const label = driftText(drift);
  if (label === 'à l’heure') return null;
  return <StatusBadge tone={drift > 0 ? 'warn' : 'ok'} size={size} data-testid="zone-drift">{label}</StatusBadge>;
}
