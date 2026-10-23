/** Une saisie faite en zone autonome, telle qu'elle part au PC principal. */
export interface ZoneEntry {
  id: string;
  seq: number;
  kind: 'result' | 'delete' | 'kata' | 'tie-break';
  categoryId: string;
  matchId?: string;
  registrationId?: string;
  round?: 'round1' | 'final';
  scope?: string;
  data: { winner: 'a' | 'b'; method: string; score: string | null } | { notes: number[] } | { order: string[] } | null;
  /** Combat : les deux combattants au moment de la saisie. */
  entrants: [string, string] | null;
  /** Révision lue avant la saisie (résultat, notes ou départage) ; 'none' : rien. */
  baseRev: string;
  /** Affichage seulement (elle change à chaque résultat). */
  categoryVersion: number | null;
  zoneId: string;
  at: string;
}

/** Journal envoyé au PC principal, ou fichier. */
export interface ZoneJournalFile {
  format: 'shidokan-zone-journal';
  formatVersion: 1;
  competitionId: string;
  zoneId: string;
  zoneName: string;
  from: { instanceId: string; instanceName: string };
  entries: ZoneEntry[];
}

/** Clé de la donnée visée par une saisie (avec la catégorie) : deux saisies de même clé portent sur la même donnée. */
export const targetKey = (e: Pick<ZoneEntry, 'kind' | 'matchId' | 'registrationId' | 'round' | 'scope'>) =>
  e.kind === 'result' || e.kind === 'delete' ? `match:${e.matchId}` : e.kind === 'kata' ? `kata:${e.registrationId}:${e.round}` : `tb:${e.scope}`;
