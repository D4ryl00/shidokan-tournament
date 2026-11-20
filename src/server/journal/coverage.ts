/**
 * Classement de chaque route d'écriture d'une compétition (et du lien d'un club) pour le journal : clés « MÉTHODE motif ».
 * Un test (tests/server/journal-coverage.test.ts) échoue tant qu'une route n'est dans aucune liste, ou dans deux.
 *
 * - COVERED : la route écrit elle-même une entrée détaillée.
 * - EXEMPT : la route ne change rien qui se raconte (aperçu, calcul) ; le filet de sécurité ne la note pas.
 * - PENDING : détaillée par une étape à venir ; en attendant, le filet de sécurité écrit une entrée brute.
 */

const C = '/api/competitions/:id';
const keys = (...k: string[]) => new Set(k);

export const JOURNAL_COVERED = keys(
  'POST /api/competitions',
  `POST ${C}/registrations`,
  `PUT ${C}/registrations/:rid`,
  `DELETE ${C}/registrations/:rid`,
  `POST ${C}/clubs/:clubId/lines`,
  `PUT ${C}/clubs/:clubId/lines/:fighterId`,
  `DELETE ${C}/clubs/:clubId/lines/:fighterId`,
  'POST /api/inscription/:token/lines',
  'PUT /api/inscription/:token/lines/:fighterId',
  'DELETE /api/inscription/:token/lines/:fighterId',
  `PUT ${C}/fighters/:fighterId/public-name`,
  `PUT ${C}/weigh-in/:fighterId`,
  `POST ${C}/weigh-in/close`,
  `POST ${C}/ffk-imports/:uploadId/commit`,
  `POST ${C}/authorizations/grant`,
  `POST ${C}/authorizations/ungrant`,
  `POST ${C}/waves/freeze`,
  `POST ${C}/waves/unfreeze`,
);

export const JOURNAL_EXEMPT = keys(
  // Le journal part avec la compétition.
  `DELETE ${C}`,
  // Aperçus : rien n'est enregistré (l'écriture suit par la route sans « /preview »).
  `POST ${C}/club-forms/preview`,
  `POST ${C}/club-forms/entry/preview`,
  `POST ${C}/ffk-imports/:uploadId/preview`,
  `POST ${C}/replacement/preview`,
  `POST ${C}/replacement/exchange/preview`,
  `POST ${C}/replacement/details/preview`,
  `POST ${C}/categories/:cid/move/preview`,
  `POST ${C}/launch/number/preview`,
  // Plan d'ensemble calculé, pas appliqué (l'application est `plan/apply`).
  `POST ${C}/replacement/plan`,
  // Lecture d'un fichier (fiche club, PDF de la FFK) : les combattants lus ne sont enregistrés que par la saisie qui suit.
  `POST ${C}/club-forms/read`,
  `POST ${C}/ffk-pdf`,
  'POST /api/inscription/:token/ffk-pdf',
  // Dépôt du fichier FFK en attente de l'aperçu : rien n'est importé avant `commit`.
  `POST ${C}/ffk-imports`,
  // Modèle de grille de l'application : la compétition ne change pas.
  `POST ${C}/grid/save-template`,
  // Copie envoyée au serveur : synchronisation courante, rien ne change dans la compétition.
  `POST ${C}/sync/copy`,
);

export const JOURNAL_PENDING = keys(
  // étape 53 : imports et clubs
  `POST ${C}/club-forms/import`,
  `POST ${C}/club-forms/entry/import`,
  `POST ${C}/clubs`,
  `POST ${C}/clubs/new`,
  `POST ${C}/clubs/from-directory`,
  `PATCH ${C}/clubs/:clubId`,
  `POST ${C}/clubs/:clubId/club-form-header`,
  'PATCH /api/inscription/:token/club',
  // Hors compétition, une entrée dans chaque compétition touchée (pas dans le filet) : annuaire, Google Contacts, changements de clubs.
  'POST /api/club-directory/:entryId/apply-to-clubs',
  'POST /api/club-directory/merge',
  'POST /api/club-directory/google/apply',
  'POST /api/club-changes/:clubId/resolve',
  'POST /api/club-changes/:clubId/ignore',

  // étape 54 : réaffectation et tableaux
  `POST ${C}/replacement/apply`,
  `POST ${C}/replacement/plan/apply`,
  `POST ${C}/replacement/move`,
  `POST ${C}/replacement/exchange`,
  `POST ${C}/replacement/refuse`,
  `POST ${C}/replacement/unrefuse`,
  `POST ${C}/replacement/withdraw`,
  `POST ${C}/replacement/set-aside`,
  `POST ${C}/replacement/resume`,
  `POST ${C}/replacement/ignore`,
  `POST ${C}/replacement/unignore`,
  `POST ${C}/replacement/reset`,
  `PUT ${C}/replacement/rules`,
  `POST ${C}/replacement/rules/reset`,
  `POST ${C}/history/undo`,
  `PATCH ${C}/categories/:cid`,
  `POST ${C}/categories/:cid/redraw`,
  `POST ${C}/categories/:cid/swap`,
  `POST ${C}/categories/:cid/regenerate`,
  `POST ${C}/free-tableaux`,
  `PATCH ${C}/free-tableaux/:cid`,
  `DELETE ${C}/free-tableaux/:cid`,
  `PUT ${C}/closed-categories`,
  `PUT ${C}/grid`,
  `POST ${C}/grid/load-template`,

  // étape 55 : jour J et le reste
  `PATCH ${C}`,
  `PUT ${C}/zones`,
  `PUT ${C}/waves`,
  `PUT ${C}/wave-schedules`,
  `PUT ${C}/finals/categories`,
  `PUT ${C}/finals/zone`,
  `POST ${C}/launch`,
  `POST ${C}/launch/reopen`,
  `POST ${C}/launch/number`,
  `POST ${C}/categories/:cid/move`,
  `PUT ${C}/categories/:cid/results/:matchId`,
  `DELETE ${C}/categories/:cid/results/:matchId`,
  `PUT ${C}/categories/:cid/kata/:rid/:round`,
  `PUT ${C}/categories/:cid/tie-break`,
  `POST ${C}/zone-journal`,
  `POST ${C}/zone-cards/:entryId`,
  `PATCH ${C}/club-entry`,
  `POST ${C}/invitations`,
  `DELETE ${C}/invitations/:clubId`,
  `POST ${C}/invitations/:clubId/links`,
  `DELETE ${C}/invitations/:clubId/links/:linkId`,
  `POST ${C}/invitations/:clubId/mailto`,
  `POST ${C}/invitations/send`,
  `POST ${C}/invitations/:clubId/recap`,
  `POST ${C}/invitations/recaps/send`,
  `POST ${C}/mail-attachments`,
  `PATCH ${C}/mail-attachments/:attachmentId`,
  `DELETE ${C}/mail-attachments/:attachmentId`,
  // Main sur la compétition (passée, reprise, secours) et compétition reçue d'un fichier.
  `POST ${C}/export-handover`,
  `POST ${C}/take-back`,
  `POST ${C}/sync/return`,
  `POST ${C}/sync/rescue`,
  `POST ${C}/sync/rescue/notify`,
  'POST /api/competitions/import',
  'POST /api/sync/remote/competitions/:cid/take',
  'POST /api/sync/remote/competitions/:cid/return',
  'POST /api/sync/remote/competitions/:cid/rescue',
  // Hors compétition, une entrée dans chaque compétition touchée (pas dans le filet) : sauvegarde restaurée.
  'POST /api/restore',
  'POST /api/mirror/copies/:name/restore',
);
