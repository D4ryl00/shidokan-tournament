export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: string[] = [],
    /** Refus que l'écran traite à part (par exemple RESCUE_DIVERGED). */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Identifiant de cet onglet : envoyé avec chaque écriture, il évite à l'onglet de se recharger pour sa propre écriture. */
export const TAB_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
