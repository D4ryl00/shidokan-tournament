import { todayInParis } from '../public/view.js';

/** « 09:30 » → secondes depuis minuit. */
export function clockToSeconds(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 3600 + Number(m) * 60;
}

/** Secondes depuis minuit → « 9:05 », arrondi à la minute la plus proche. */
export function secondsToClock(sec: number): string {
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60);
  const m = total - h * 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Créé une seule fois : appelé pour chaque résultat à chaque calcul des heures. */
const PARIS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/**
 * Secondes depuis minuit (heure de Paris) du jour `date` (AAAA-MM-JJ). Un instant d'un autre jour donne une valeur
 * < 0 ou ≥ 86 400 ; ISO illisible : null.
 */
export function isoToDaySeconds(iso: string, date: string): number | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = PARIS.formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const [y, mo, d] = date.split('-').map(Number);
  const days = (Date.UTC(n('year'), n('month') - 1, n('day')) - Date.UTC(y!, mo! - 1, d!)) / 86_400_000;
  const sec = days * 86_400 + n('hour') * 3600 + n('minute') * 60 + n('second');
  return Number.isNaN(sec) ? null : sec;
}

/** Secondes depuis minuit à Paris si `now` tombe le jour `date`, sinon null (pas de « maintenant » hors du jour J). */
export function nowOnDay(now: Date, date: string): number | null {
  return todayInParis(now) === date ? isoToDaySeconds(now.toISOString(), date) : null;
}
