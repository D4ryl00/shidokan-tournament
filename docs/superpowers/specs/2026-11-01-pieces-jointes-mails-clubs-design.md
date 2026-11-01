# Pièces jointes des mails aux clubs — conception

Date : 2026-11-01. Validée en conversation avec l'organisateur (les choix marqués « choix du concepteur » sont à vérifier à la relecture).

## Intention

Le mail envoyé aux clubs (lien personnel d'inscription, `sendInvitations` dans `src/server/mail.ts`) joint déjà, toujours, la fiche à
imprimer (PDF) et le tableur (.ods). L'organisateur veut aussi y joindre **ses propres fichiers**, comme l'affiche et le règlement de la
compétition : **les mêmes pour tous les clubs** d'une compétition, enregistrés une fois avec la compétition plutôt que choisis à chaque
envoi. Il veut aussi pouvoir **ne plus joindre** l'une ou l'autre des fiches club, sans qu'elles disparaissent.

## Objectifs

- Une partie « Pièces jointes » dans l'accordéon « Message aux clubs de cette compétition » (`CompetitionMessage`,
  `src/web/components/InvitationMail.tsx`) pour **gérer** les pièces jointes, pas seulement les lister.
- Lignes, dans cet ordre :
  1. **Fiche à imprimer (PDF)** — `fiche-club-<date>.pdf` : case « Joindre », lien de téléchargement (route existante `club-form.pdf`).
     Pas de suppression.
  2. **Tableur (.ods)** — `fiche-club-<date>.ods` : idem (route `club-form.ods`).
  3. **Les fichiers ajoutés**, dans l'ordre d'ajout : nom, taille, case « Joindre », lien de téléchargement, bouton « Supprimer ».
- Un bouton « Ajouter un fichier » (sélection d'un ou plusieurs fichiers depuis l'ordinateur) sous la liste.
- Les cases sont **enregistrées avec la compétition**, valent pour tous les clubs et pour tous les envois suivants, jusqu'à ce que
  l'organisateur les change (décision de l'organisateur). Chaque clic sur une case est enregistré tout de suite (pas de bouton
  « Enregistrer » à part — choix du concepteur, comme une case à cocher de réglage).
- Envoi groupé : chaque mail porte les pièces cochées, dans l'ordre de la liste. Aucune cochée : le mail part sans pièce jointe.
- L'aperçu du message (bloc existant `data-testid="invitation-attachments"`) dit ce qui sera joint : « Pièces jointes : a, b, c » ou
  « Pièces jointes : aucune ».
- « Ouvrir dans ma messagerie » (fenêtre de `OnlineEntryPanel.tsx`, `data-testid="mailto-attachments"`) ne peut pas joindre de fichier :
  elle propose au téléchargement **les pièces cochées seulement** (les fiches club et les fichiers ajoutés) ; aucune cochée : la phrase
  sur les pièces jointes n'apparaît pas.
- L'aide (`src/web/help.ts`, entrée des inscriptions en ligne, phrase sur les pièces jointes) est mise à jour : gestion des pièces,
  texte du message à adapter soi-même, fichiers ajoutés absents des sauvegardes et du paquet de passage de main.

## Non-objectifs

- Pas de choix des pièces jointes club par club, ni au moment de l'envoi (refusé par l'organisateur : réglage de la compétition).
- Pas de pièces jointes au mail d'essai des Réglages de l'application.
- Pas de pièces jointes au niveau de l'application (modèle commun à toutes les compétitions).
- Pas de renommage d'un fichier ajouté (on le supprime et on le rajoute).
- Les fichiers ajoutés ne voyagent pas avec la compétition (voir Contraintes).

## Anti-objectifs

- Un envoi qui échoue chez Gmail ou le serveur SMTP parce que le mail est trop gros : les limites ci-dessous l'empêchent avant.
- Un fichier qui, téléchargé depuis l'application, s'ouvre dans le navigateur comme une page (contenu actif) : toujours servi en
  téléchargement.
- Perdre une fiche club par erreur : elles ne se suppriment pas, elles se décochent.

## Contraintes et règles

### Fichiers acceptés (choix du concepteur)

- Extensions acceptées (casse ignorée) et type annoncé dans le mail :
  pdf, jpg/jpeg, png, gif, webp, doc, docx, odt, xls, xlsx, ods, ppt, pptx, odp, txt, csv. Autre extension : refus
  « Type de fichier non accepté : .xyz (acceptés : PDF, images, documents, tableurs, présentations, texte) ». Les exécutables et
  scripts que Gmail bloque sont ainsi exclus.
- Limites : **10 fichiers** ajoutés au plus par compétition, **10 Mo** par fichier, **15 Mo** pour l'ensemble des fichiers ajoutés
  (cochés ou non). Les fiches club (quelques centaines de Ko) ne comptent pas. Raison : Gmail refuse un mail de plus de 25 Mo une fois
  encodé (base64, +33 %). Messages : « Au plus 10 pièces jointes. », « Fichier trop gros : 10 Mo au plus. », « Pièces jointes trop
  lourdes : 15 Mo au plus en tout. »
- Fichier vide : refusé.
- Nom : on garde le nom du fichier de l'ordinateur, sans chemin ni caractères de contrôle, espaces autour retirés, 150 caractères au
  plus (raccourci en gardant l'extension). Un nom déjà pris (casse ignorée) par un fichier ajouté ou par une fiche club de cette
  compétition est refusé : « Une pièce jointe porte déjà ce nom. »
- Plusieurs fichiers choisis d'un coup : envoyés un par un ; chaque refus est affiché avec le nom du fichier, les autres sont ajoutés.

### Stockage

- **Contenu des fichiers sur le disque, pas dans la base** (choix du concepteur, après relecture) : dans le dossier
  `pieces-jointes/` à côté de la base (`path.join(path.dirname(path.resolve(dbPath)), 'pieces-jointes')`, comme `sauvegardes/`), un
  fichier par pièce jointe nommé par son `id` (pas par le nom choisi par l'organisateur). Écriture dans un fichier temporaire puis
  renommage. Raison : la base est copiée par les sauvegardes automatiques (jusqu'à 200 copies), par la copie de secours du PC toutes
  les 5 minutes et par « Restaurer depuis un fichier » (corps limité à 20 Mio) ; 15 Mo de fichiers par compétition dans la base
  rendraient tout cela lourd, voire impossible.
- Nouvelle table `mail_attachments` (migration 0027, générée par `npm run db:generate`), **sans le contenu** : `id`, `competition_id`
  (clé étrangère, suppression en cascade), `file_name`, `content_type`, `size`, `included` (booléen, vrai à l'ajout), `created_at`, plus
  les colonnes de version habituelles (`rowMeta()`) : la table a `competition_id`, elle est donc versionnée par `versionedTables`.
- Fichiers sans ligne (pièce supprimée, compétition supprimée, purge, restauration d'une sauvegarde plus ancienne) : effacés du dossier
  au démarrage et après chacune de ces opérations (un balayage « fichiers dont l'id n'est plus dans la table »).
- Ligne sans fichier (restauration d'une sauvegarde plus récente que le dossier, fichier effacé à la main) : la liste l'affiche
  « Fichier manquant » (en rouge, sans lien de téléchargement, case « Joindre » désactivée, bouton « Supprimer » disponible). Si une
  pièce **cochée** manque au moment d'un envoi groupé, l'envoi est refusé avant le premier mail, sans changer aucun lien :
  « Pièce jointe introuvable : <nom>. Supprimez-la ou ajoutez-la de nouveau. »
- Conséquence acceptée : les sauvegardes ne contiennent pas les fichiers ajoutés ; après une restauration, il faut les rajouter s'ils
  manquent. L'aide le dit.
- Les cases des fiches club : nouveau réglage de compétition `clubFormAttachments: { pdf: boolean; ods: boolean }` dans
  `competitionSettingsSchema` (`src/domain/settings.ts`), vrai/vrai par défaut (les compétitions existantes gardent donc leurs deux
  fiches jointes). Il change par le PATCH de compétition existant.
- `mail_attachments` est une table **propre à l'installation** : ajoutée à `LOCAL_ONLY_TABLES` (`src/server/sync/package.ts`), comme
  `mail_log` et `club_invitations`. Les fichiers ne partent donc pas dans le paquet (prise de main, fichier « donner la main ») : ils
  sont là où on les a ajoutés, c'est-à-dire en pratique sur le serveur, où partent les mails. Le réglage `clubFormAttachments`, lui,
  voyage avec les autres réglages (choix du concepteur : c'est un réglage comme un autre).
- Purge RGPD des 13 mois (`src/server/repositories/retention.ts`) : `mail_attachments` est vidée avec les autres tables locales, et les
  fichiers correspondants effacés (ce ne sont pas des données personnelles, mais elles ne servent plus et pèsent).

### Texte du message

- Le texte du message n'est **pas** adapté automatiquement aux pièces cochées (décision de l'organisateur : il corrige le texte lui-même
  quand il change les pièces jointes). Pas de nouvelle variable. Le texte par défaut, qui cite la fiche PDF et le tableur, ne change pas.
- Rappel discret sous la liste des pièces jointes (choix du concepteur) : « Si le texte du message cite les pièces jointes, pensez à
  l’adapter. » L'aide le dit aussi.

### Limites et serveur d'envoi

- Les limites (15 Mo en tout, environ 21 Mo une fois encodé) conviennent à Gmail, par l'API (téléversement jusqu'à 35 Mo, message
  jusqu'à 25 Mo) comme par son SMTP (25 Mo) : c'est l'envoi visé. Avec un autre serveur SMTP plus strict, le refus arrive club par club
  comme toute erreur d'envoi : le nouveau lien du club est désactivé, l'ancien reste valable, l'erreur s'affiche dans le résultat
  (comportement existant de `sendInvitations`). Pas de limite propre à chaque serveur d'envoi.

### Serveur

- Routes, sous `/api/competitions/:id` (réservées à l'organisateur ; refusées en lecture seule quand la main est ailleurs, par la garde
  existante qui couvre toutes les écritures de ces routes) :
  - `GET /mail-attachments` : liste `{ id, fileName, contentType, size, included, createdAt }` sans le contenu.
  - `POST /mail-attachments` : corps brut `application/octet-stream`, nom dans l'en-tête `X-File-Name` (encodé
    `encodeURIComponent`, comme l'import FFK) ; renvoie la ligne créée. Limite de corps de la route : 10 Mo.
  - `GET /mail-attachments/:attachmentId` : le fichier, `Content-Disposition: attachment` avec le nom encodé (RFC 5987,
    `filename*=UTF-8''…`, plus un `filename="…"` ASCII de secours), `X-Content-Type-Options: nosniff`.
  - `PATCH /mail-attachments/:attachmentId` : `{ included: boolean }`.
  - `DELETE /mail-attachments/:attachmentId` : 204.
  - Les deux GET sont ajoutés à `ORGANISER_GETS` (`src/server/auth/permissions.ts`) ; les écritures ne sont pas dans `TABLE_WRITES`
    (donc refusées aux comptes Table centrale et Zone).
- `sendInvitations` : les pièces jointes = fiches club cochées (via `clubFormAttachments`) puis fichiers ajoutés cochés, lus sur le
  disque et préparés une seule fois avant le premier envoi comme aujourd'hui (et avant la vérification du serveur d'envoi : une pièce
  manquante est refusée sans rien envoyer).
- Le nom d'un fichier ajouté qui viendrait à égaler celui d'une fiche club après un changement de date de la compétition : rien
  d'empêché (cas sans conséquence pour les messageries) — choix du concepteur.

### Écran

- Les erreurs (refus d'un fichier) s'affichent sous la liste, avec le nom du fichier.
- La liste et les cases suivent l'état « lecture seule » de l'écran comme les autres réglages de la compétition (choix du concepteur :
  si l'écran désactive déjà les écritures quand la main est ailleurs, faire pareil ; sinon le refus 409 du serveur s'affiche).
- Les nouvelles requêtes invalident la liste des pièces jointes et l'aperçu.

## Tests attendus

- Serveur (`tests/server/`) : ajout / liste / téléchargement (en-têtes) / décocher / supprimer ; refus (type, taille, total, nombre,
  nom en double y compris avec une fiche club, vide) ; mail envoyé avec les bonnes pièces dans le bon ordre selon les cases, fiches
  club décochées absentes ; aucune cochée → pas de pièce jointe ; compte Table centrale refusé ; compétition gérée ailleurs → 409 ;
  la table n'est pas dans le paquet et le test « toutes les tables classées » passe ; purge des 13 mois vide la table et efface les
  fichiers ; fichiers orphelins balayés ; pièce cochée manquante → envoi refusé sans lien changé ; liste « Fichier manquant ».
- e2e (Playwright) : ajouter un fichier dans « Message aux clubs », le voir dans l'aperçu, décocher la fiche PDF, le supprimer.

## Laissé au constructeur

- Mise en page exacte de la liste (tableau ou lignes), libellés des tailles (Ko/Mo), icônes.
- Découpage du code (module de domaine pour les règles de nom/type/taille, dépôt côté serveur).
