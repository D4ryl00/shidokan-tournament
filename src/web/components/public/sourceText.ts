import type { PublicCompetition, SideSource } from '../../../domain/public/types.js';

/** « le vainqueur du n° 12 » ; la zone est ajoutée quand elle diffère de celle du combat (les numéros sont propres à chaque zone). */
export function sourceText(from: SideSource, zoneId: string, pub: PublicCompetition): string {
  const who = from.kind === 'winner' ? 'vainqueur' : 'perdant';
  if (from.number === null) return `le ${who} du combat précédent`;
  const zone = from.zoneId !== null && from.zoneId !== zoneId ? pub.zones.find((z) => z.id === from.zoneId)?.name : undefined;
  return `le ${who} du n° ${from.number}${zone ? `, ${zone}` : ''}`;
}
