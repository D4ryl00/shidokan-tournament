/** Types du journal de la compétition : ce qui a été fait, par qui, comment. */

export type JournalType =
  | 'inscription' | 'import' | 'pesee' | 'categorie' | 'reaffectation' | 'plan' | 'tableau'
  | 'session' | 'resultat' | 'club' | 'mail' | 'main' | 'competition' | 'non-detaille';

/** Ordre d'affichage du filtre. */
export const JOURNAL_TYPES: JournalType[] = [
  'inscription', 'import', 'pesee', 'categorie', 'reaffectation', 'plan', 'tableau',
  'session', 'resultat', 'club', 'mail', 'main', 'competition', 'non-detaille',
];

export const JOURNAL_TYPE_LABELS: Record<JournalType, string> = {
  inscription: 'Inscription',
  import: 'Import',
  pesee: 'Pesée · présence',
  categorie: 'Catégorie',
  reaffectation: 'Réaffectation',
  plan: 'Plan',
  tableau: 'Tableau',
  session: 'Session · zone',
  resultat: 'Résultat',
  club: 'Club',
  mail: 'Mail',
  main: 'Main',
  competition: 'Compétition',
  'non-detaille': 'Non détaillé',
};

export type JournalVia =
  | 'saisie' | 'sur-place' | 'en-ligne' | 'fiche-club' | 'import-ffk' | 'plan' | 'a-la-main'
  | 'historique' | 'pesee' | 'tableaux' | 'sessions' | 'combats' | 'clubs' | 'mails'
  | 'synchronisation' | 'ligne-de-commande' | 'autre';

export const JOURNAL_VIA_LABELS: Record<JournalVia, string> = {
  saisie: 'Saisie',
  'sur-place': 'Inscription sur place',
  'en-ligne': 'Inscription en ligne',
  'fiche-club': 'Fiche club importée',
  'import-ffk': 'Import FFK',
  plan: 'Plan automatique',
  'a-la-main': 'À la main',
  historique: 'Historique',
  pesee: 'Pesée',
  tableaux: 'Tableaux',
  sessions: 'Sessions',
  combats: 'Combats',
  clubs: 'Clubs',
  mails: 'Envoi de mails',
  synchronisation: 'Synchronisation',
  'ligne-de-commande': 'Ligne de commande',
  autre: 'Autre',
};

export type JournalActor =
  | { kind: 'account'; email: string; role: 'organisateur' | 'table' | 'zone' }
  | { kind: 'poste'; poste: 'organisation' | 'table' | 'zone' | 'inconnu'; zoneName?: string }
  | { kind: 'club'; clubName: string }
  | { kind: 'app' };

/** « Qui » d'une entrée, tel qu'affiché. */
/** Rôle d'un compte, dit dans le journal (« compte Table ») : un compte Table est souvent partagé entre bénévoles. */
const ACCOUNT_ROLE_LABELS = { organisateur: 'Organisateur', table: 'Table', zone: 'Zone' } as const;

export function actorLabel(a: JournalActor): string {
  switch (a.kind) {
    case 'account':
      return `${a.email} · compte ${ACCOUNT_ROLE_LABELS[a.role]}`;
    case 'poste':
      if (a.poste === 'organisation') return 'poste Organisation';
      if (a.poste === 'table') return 'poste Table centrale';
      if (a.poste === 'zone') return a.zoneName ? `poste ${a.zoneName}` : 'poste Zone';
      return 'poste inconnu';
    case 'club':
      return `${a.clubName} · lien du club`;
    case 'app':
      return 'l’appli';
  }
}

export interface JournalChange {
  label: string;
  before: string | null;
  after: string | null;
}

/** Les étapes suivantes en ajoutent. */
export type JournalAction =
  | 'competition-created' | 'journal-opened' | 'fighter-added' | 'fighter-removed'
  | 'fighter-changed' | 'weigh-in' | 'presence' | 'weigh-in-closed' | 'raw';

export interface JournalData {
  subject?: string;
  detail?: string;
  changes?: JournalChange[];
  route?: string;
  method?: string;
  params?: Record<string, string>;
}

export interface JournalEntryView {
  id: string;
  seq: number;
  type: JournalType;
  action: JournalAction;
  at: string;
  clientAt: string | null;
  actor: JournalActor;
  via: JournalVia;
  data: JournalData;
  children: JournalEntryView[];
  open: boolean;
}
