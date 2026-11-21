import { Text } from '@mantine/core';
import type { CategoryTimes, PassageTime } from '../../domain/schedule/organiser-times.js';
import { versText } from './public/zoneRows.js';

/** « sur le tatami » ou « vers H:MM ». */
export function passageTimeText(t: PassageTime): string {
  return t.kind === 'onTatami' ? 'sur le tatami' : versText(t.clock);
}

/** « Zone · prochain vers H:MM · finale vers H:MM » (« 1er combat » / kata « tour 1 » tant que rien n'est joué) ; parties absentes omises. */
export function categoryTimesText(zone: string | null, t: CategoryTimes, kata: boolean): string {
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
