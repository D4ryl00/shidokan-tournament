const key = (competitionId: string) => `combats-categories:${competitionId}`;

/** Liste des catégories de l'écran Combats ouverte ou repliée, choisie dans ce navigateur (null : pas encore choisie). */
export function categoriesOpen(competitionId: string): boolean | null {
  try {
    const v = localStorage.getItem(key(competitionId));
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

export function rememberCategoriesOpen(competitionId: string, open: boolean): void {
  try {
    localStorage.setItem(key(competitionId), open ? '1' : '0');
  } catch {
    /* navigateur sans stockage : le choix vaut pour cette visite */
  }
}
