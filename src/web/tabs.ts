/** Onglets d'une compétition ; chaque étape du projet ajoute les siens. */
export const COMPETITION_TABS = [
  { path: 'inscriptions', label: 'Inscriptions' },
  { path: 'clubs', label: 'Clubs' },
  { path: 'fiche-club', label: 'Fiche club' },
  { path: 'import-ffk', label: 'Import FFK' },
  { path: 'pesee', label: 'Pesée' },
  { path: 'recasement', label: 'Recasement' },
  { path: 'tableaux', label: 'Tableaux' },
  { path: 'combats', label: 'Combats' },
  { path: 'podiums', label: 'Podiums' },
  { path: 'reglages', label: 'Réglages' },
  { path: 'grille', label: 'Grille âge / poids' },
] as const;
