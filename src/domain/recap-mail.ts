import type { MailTemplate } from './mail-template-schema.js';

/** Variables utilisables dans le message du récapitulatif. */
export const RECAP_VARIABLES = '{club} {coach} {competition} {date} {lieu}';

/** Texte de départ du récapitulatif envoyé à chaque club (texte brut). */
export const DEFAULT_RECAP_MAIL: MailTemplate = {
  subject: 'Récapitulatif {competition} — {club}',
  body: 'Bonjour {coach},\n\nVous trouverez ci-joint le récapitulatif des inscriptions du club {club} pour la compétition {competition} du {date} à {lieu}.\n\nMerci de le vérifier et de nous signaler toute erreur.\n\nSportivement,',
};
