import { plural } from '../domain/plural.js';

/** Bilan d'un envoi groupé : mails partis (les liens d'avant restent valables), puis clubs en erreur (aucun lien ne leur a été ajouté). Rien de parti : « Aucun mail envoyé ». */
export function sendSummary(sent: number, errors: number): string {
  const failed = `aucun lien ne ${errors > 1 ? 'leur' : 'lui'} a été ajouté ; corrigez puis renvoyez.`;
  const clubs = plural(errors, 'club en erreur', 'clubs en erreur');
  if (sent === 0) return `Aucun mail envoyé : ${clubs}, ${failed}`;
  const ok = `${plural(sent, 'mail envoyé', 'mails envoyés')} : les liens déjà envoyés restent valables.`;
  return errors ? `${ok} ${clubs} : ${failed}` : ok;
}
