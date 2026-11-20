import { MISSING_WEIGHT_BULLET, type AuthorizationRow } from './authorizations.js';

/**
 * Texte à envoyer aux coachs (spec étape 45 §7.4, format de la skill `shidokan-club-messages`) : salutation courte,
 * combattants numérotés, une puce par demande, puis la demande des accords et des poids manquants.
 */

/** Ce dont le texte a besoin d'une ligne de la liste. */
export type MessageRequest = Pick<AuthorizationRow, 'fighterId' | 'label' | 'status' | 'bullet' | 'current'>;
/** Un combattant du message : « NOM Prénom » et ses puces. */
export interface MessageRow {
  label: string;
  bullets: string[];
}

/** « Karaté Jiyu » : la discipline d'origine de l'inscription, début de `current` (« Karaté Jiyu · Benjamines −40 »). */
const disciplineOf = (r: MessageRequest) => r.current.split(' · ')[0]!;

/** Demandes regroupées par combattant (un numéro chacun), dans l'ordre de la liste. */
export function byFighter<T extends { fighterId: string }>(requests: T[]): T[][] {
  const out = new Map<string, T[]>();
  for (const r of requests) out.set(r.fighterId, [...(out.get(r.fighterId) ?? []), r]);
  return [...out.values()];
}

/**
 * Combattants du message, dans l'ordre de la liste : seulement les demandes en attente et les poids manquants (une demande
 * accordée n'est plus à demander). Un combattant inscrit dans plusieurs disciplines n'a qu'un numéro ; chaque puce dit alors
 * de quelle inscription elle parle.
 */
export function messageRows(requests: MessageRequest[]): MessageRow[] {
  return byFighter(requests.filter((r) => r.status !== 'granted')).map((rs) => {
    const several = new Set(rs.map(disciplineOf)).size > 1;
    return { label: rs[0]!.label, bullets: rs.map((r) => (several ? `${disciplineOf(r)} : ${r.bullet}` : r.bullet)) };
  });
}

/** Demande de fin : accords, poids, ou les deux, selon les puces. */
function closing(rows: MessageRow[]): string {
  const bullets = rows.flatMap((r) => r.bullets);
  const weight = bullets.some((b) => b.endsWith(MISSING_WEIGHT_BULLET));
  const agreement = bullets.some((b) => !b.endsWith(MISSING_WEIGHT_BULLET));
  if (agreement && weight) return 'Merci de nous confirmer votre accord pour ces changements et de nous indiquer les poids demandés.';
  return agreement ? 'Merci de nous confirmer votre accord pour ces changements.' : 'Merci de nous indiquer les poids demandés.';
}

/** Combattants numérotés et leurs puces, sans salutation ni demande finale : à coller à la suite d'un autre envoi. */
export function fightersText(rows: MessageRow[]): string {
  return rows.flatMap((r, i) => [`${i + 1}. ${r.label}`, ...r.bullets.map((b) => `   - ${b}`)]).join('\n');
}

/** Message d'un club (nom vide : sans club, pas nommé) ; rien à demander : texte vide. */
export function clubMessage(club: { name: string }, rows: MessageRow[]): string {
  if (rows.length === 0) return '';
  return [
    'Bonjour,',
    '',
    `Voici les points à valider pour vos combattants${club.name ? ` (${club.name})` : ''} :`,
    '',
    fightersText(rows),
    '',
    closing(rows),
  ].join('\n');
}

/** Texte copié pour un club : le message complet, ou seulement les combattants (envoi session par session). */
export function copyText(club: { name: string }, rows: MessageRow[], greeting: boolean): string {
  return greeting ? clubMessage(club, rows) : fightersText(rows);
}

/** « Copier tout » : le texte de chaque club qui a quelque chose à demander, sous son nom. */
export function allClubsMessage(clubs: { name: string; rows: MessageRow[] }[], opts: { greeting?: boolean } = {}): string {
  const greeting = opts.greeting ?? true;
  return clubs
    .filter((c) => c.rows.length > 0)
    .map((c) => `=== ${c.name || 'Sans club'} ===\n${copyText(c, c.rows, greeting)}`)
    .join('\n\n\n');
}
