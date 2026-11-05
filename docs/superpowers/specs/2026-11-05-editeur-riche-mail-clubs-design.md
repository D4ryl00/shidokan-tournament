# Éditeur riche du mail aux clubs — conception

Date : 2026-11-05. Discutée en conversation avec l'organisateur. Les choix marqués « choix du concepteur » sont à vérifier à la relecture.

## Intention

Le mail d'invitation aux clubs se rédige aujourd'hui dans un champ de texte brut (`Textarea`). L'organisateur veut le mettre en forme
comme il le ferait dans Gmail, et y placer des images. Ses messages doivent rester faciles à écrire et à relire, et le mail doit arriver
correctement chez les clubs, avec le lien personnel de chacun.

En contrepartie, les mails et les inscriptions en ligne deviennent réservés au serveur en ligne : le PC de la compétition fonctionne sans
internet et n'invite jamais les clubs (décision de l'organisateur, qui ne prévoit pas d'utiliser un PC sans le serveur pour cela).

## Objectifs

### Éditeur

- Un seul composant d'éditeur, utilisé aux deux endroits où le message se rédige (décision de l'organisateur) :
  - Réglages de l'application, section « Message aux clubs » (`TextsCard`, `src/web/pages/AppSettingsPage.tsx`) ;
  - message propre à une compétition (`CompetitionMessage`, `src/web/components/InvitationMail.tsx`).
- Disposition retenue par l'organisateur (maquette A) : l'objet, puis l'éditeur avec **sa barre en haut**, puis les boutons d'enregistrement,
  puis l'**aperçu en dessous**. Dans les Réglages de l'application, il n'y a pas d'aperçu aujourd'hui et il n'en est pas ajouté (pas de club
  dont tirer les valeurs — choix du concepteur).
- L'objet reste en texte simple : un objet de mail ne se met pas en forme.
- Fonctions demandées par l'organisateur : **gras, souligné, couleurs, listes, images dans le texte**.
- Barre choisie par l'organisateur : **la barre de `@mantine/tiptap` et un seul bouton ajouté, celui de l'image**. Aucun autre bouton sur mesure.
- Fonctions ajoutées (choix du concepteur, visibles sur la maquette et non contestées) : italique, surlignage, liste numérotée en plus de la
  liste à puces, lien, annuler/rétablir. Les variables restent écrites `{club}`, `{coach}`, `{competition}`, `{date}`, `{lieu}`, `{date_limite}`,
  `{lien}`, se tapent à la main et restent rappelées au-dessus de l'éditeur, comme aujourd'hui.
- Fonctions complémentaires demandées par l'organisateur, toutes fournies par la barre de Mantine :
  - **titres** : ils remplacent le choix d'une taille de texte (décision de l'organisateur). Trois niveaux (choix du concepteur) ; un titre
    s'applique à une ligne entière ;
  - **alignement** à gauche, au centre ou à droite, pour le texte et les images ;
  - **citation** (bloc en retrait, avec un trait à gauche) ;
  - **édition du code HTML** : le bouton de la barre bascule entre l'éditeur et le code du message, pour la même zone. Ce qui n'est pas permis (voir
    Contraintes) est retiré au retour dans l'éditeur et à l'enregistrement ; un message dit alors que quelque chose a été retiré, sans disparition silencieuse.
- La barre peut passer sur plusieurs lignes, rangée par groupes de fonctions. La disposition A reste valable.
- Une variable peut être mise en forme comme le reste du texte. Le lien personnel peut rester visible (`{lien}` dans le texte, devient un lien
  cliquable affichant l'adresse) ou être placé derrière un mot (lien dont l'adresse est `{lien}`) : la fenêtre de lien accepte donc `{lien}`.
- Couleurs : une palette courte et fixe pour le texte (choix du concepteur) ; le surlignage n'a qu'une couleur (jaune), car le contrôle de Mantine n'en propose pas d'autre. La zone de texte et l'aperçu restent
  sur fond blanc même en thème sombre, pour montrer ce que verront les clubs (choix du concepteur).
- Coller depuis Gmail ou Word garde ce qui est permis et retire le reste. Coller une image passe par le même ajout qu'une image choisie
  (choix du concepteur).

### Message envoyé

- L'envoi reste **un mail par club, avec son lien personnel**. L'idée d'un mail commun en CCI est abandonnée par l'organisateur, puisque
  `{lien}`, `{club}` et `{coach}` sont propres à chaque club.
- « Envoyer le lien par mail » envoie la version mise en forme, avec les images affichées dans le texte, et une version texte brut de secours
  (paragraphes, titres sur leur propre ligne, listes en « - » ou « 1. », citations précédées de « > », adresse d'un lien écrite à côté de son
  texte, images omises).
- Le rendu se voit dans les messageries courantes : Gmail d'abord, puis Outlook et Apple Mail. Les styles sont écrits dans le HTML du mail
  (`style="…"` sur les éléments) : pas de feuille de style.
- « Ouvrir dans ma messagerie » reste disponible sur le serveur, en **texte brut, sans mise en forme ni image** (limite de `mailto:`, acceptée
  par l'organisateur). Sa fenêtre dit que la mise en forme et les images ne suivent pas.
- L'aperçu du message montre le rendu mis en forme, images comprises.

### Messages déjà enregistrés

- Un message existant (application ou compétition) continue de partir sans changement tant qu'il n'est pas modifié. Il s'ouvre dans l'éditeur
  avec ses paragraphes et retours à la ligne.
- Un texte ancien contenant `<` ou `&` reste du texte : il n'est jamais lu comme du HTML. Le format doit donc être dit explicitement, pas
  deviné d'après le contenu.
- Le mécanisme « message par défaut qui suit la dernière version » (`currentInvitationMail`) continue de fonctionner.

### Images

- Ajout par bouton de la barre ou par collage, à la place du curseur, dans le message de l'application comme dans celui d'une compétition
  (décision de l'organisateur).
- Une compétition qui personnalise son message à partir de celui de l'application reprend ses images. Les retirer ensuite de l'un ne les
  retire pas de l'autre.
- Taille d'affichage au choix : petite, moyenne, pleine largeur du mail, comme dans Gmail (choix du concepteur : un logo et une affiche n'ont
  pas la même taille, et certaines messageries ignorent les tailles relatives : la largeur est donc écrite en pixels).
- Réduction à l'ajout (choix du concepteur) : 1200 pixels de large au plus, 2 Mo au plus après réduction, formats acceptés JPEG, PNG, WebP et GIF.
  Le WebP est converti en JPEG ou PNG (Outlook l'affiche mal). Un GIF n'est pas réduit, pour ne pas perdre son animation : au-dessus de 2 Mo,
  il est refusé. Le SVG est refusé. Refus clairs, en français.
- Au plus 10 images par message (choix du concepteur).
- Poids total : images, fiches club et pièces ajoutées d'un même mail ne doivent pas dépasser la limite d'envoi. Gmail refuse au-delà de 25 Mo
  une fois encodé. Le dépassement est refusé **avant tout envoi et sans créer de lien**, avec un message qui dit quoi alléger. La
  limite exacte est laissée au constructeur, en cohérence avec `MAIL_ATTACHMENT_LIMITS`.
- Une image citée par le message mais absente est refusée de la même façon : aucun envoi, aucun lien créé, message clair (comme une pièce
  jointe manquante aujourd'hui).
- Les images sont jointes au mail et affichées par référence interne (`cid:`) : pas d'hébergement public, et les images ne dépendent pas d'un
  lien vers le serveur.

### Mails et inscriptions en ligne réservés au serveur

Sur une installation `INSTANCE_ROLE=local` (PC principal, portable de zone), décision de l'organisateur :

- Toute la section « Inscriptions en ligne » de la compétition est retirée de l'écran : ouverture et gel, date limite, clubs invités, liens et
  colonne « Accès », « Envoyer le lien par mail », « Ouvrir dans ma messagerie », message aux clubs et pièces jointes. Sont retirées aussi les sections
  « Envoi des mails » et « Message aux clubs » des Réglages de l'application. Un lien créé sur le PC ne servirait à rien : il reste sur le PC
  (`club_invitations` ne voyage pas) et pointe vers son adresse locale.
- Les routes correspondantes sont refusées côté serveur, pas seulement cachées : invitations, liens, envoi, `mailto`, aperçu, pièces jointes,
  images, réglages des inscriptions en ligne, page publique `/inscription/:token` et ses appels, mail d'essai, réglages d'envoi.
- Reste sur le PC : la fiche club papier et son import, le téléchargement des fiches club, la mention sur les données et la durée de conservation
  (même carte que le message aujourd'hui), et les inscriptions déjà reçues, qui arrivent avec la compétition comme aujourd'hui.
- La connexion Google se règle dans la section « Envoi des mails » : elle disparaît avec elle sur le PC. Le PC n'a pas de `PUBLIC_URL` ni
  d'identifiants Google, la synchronisation des contacts n'y fonctionne donc déjà pas (choix du concepteur).
- Les réglages d'envoi déjà enregistrés sur un PC ne sont plus utilisés, mais ne sont pas effacés (choix du concepteur).
- Sur le serveur, quand un PC a la main sur une compétition, l'envoi y est déjà refusé (`registerReadOnlyGuard`). Ce comportement reste ; le
  bouton est indisponible et le message dit de rendre la main au serveur pour envoyer des mails. Le message et ses images ne sont pas perdus
  au retour de la main.

### Aide et documentation

`src/web/help.ts` et `docs/guide-utilisateur.md` : éditeur, images, limite de « Ouvrir dans ma messagerie », mails réservés au serveur. La phrase du
guide « Chaque envoi crée un nouveau lien et désactive le précédent » est périmée depuis l'étape 33 : la corriger en passant.

## Non-objectifs

- Pas de choix de police ni de taille de texte, pas de tableau, pas de menu « Insérer une variable » : absents de la barre de Mantine, ils ne sont pas
  ajoutés (décision de l'organisateur). Un élément de ce type venant du collage ou du code HTML est retiré, et le message le signale.
- Pas de mail commun en CCI (abandonné par l'organisateur).
- Pas d'image venant d'une adresse externe, ni dans la barre, ni par collage, ni dans le code HTML : une telle image est retirée, et le message le
  signale.
- Le code HTML ne donne pas accès à tout : pas de script, de feuille de style, de formulaire, de cadre ni de vidéo.
- Pas de mise en forme propre à un club : le même message pour tous, seules les variables changent.
- Pas de pièces jointes au niveau de l'application : les pièces restent par compétition.
- Pas de mail ni d'inscription en ligne pour une installation PC seule.

## Anti-objectifs

- Un club reçoit le lien d'un autre club, ou un lien cassé.
- Un nom de club ou de coach (qui vient parfois d'une fiche ou d'un contact Google) insère du HTML dans le mail : les valeurs des variables sont
  toujours échappées, y compris dans une adresse de lien.
- Un message enregistré avant ce changement part différemment, ou affiche des balises.
- Un envoi part sans une image que le message annonce, ou s'arrête au milieu pour une raison vérifiable avant de commencer.
- Du HTML dangereux entre par l'éditeur, un appel direct à l'API ou un paquet de compétition importé.

## Contraintes

- Stack existante : Mantine 8.3.18 (React 19), Fastify, drizzle, SQLite, nodemailer pour le SMTP et pour construire le message envoyé par l'API Gmail
  (`mimeOf`). Interface et messages en français.
- Éditeur : `@mantine/tiptap@8.3.18` (version de Mantine installée) et Tiptap, décision de l'organisateur après comparaison avec le modèle Simple Editor
  de Tiptap, qui n'a pas la couleur du texte ni le code HTML. Vérifier en premier que l'ensemble fonctionne avec Vite et React 19 ici. Si ce n'est pas le cas, revenir
  vers l'organisateur plutôt que changer d'éditeur.
- Le filtrage du HTML se fait **côté serveur**, par liste de ce qui est permis (éléments, attributs, propriétés de style, adresses `http`,
  `https`, `mailto` et `{lien}` pour les liens, références aux images de l'application pour les images), à l'enregistrement et de nouveau au moment
  de construire le mail, puisqu'un message peut aussi arriver par un paquet de compétition. Limite de `mailTemplateSchema` à relever pour le
  format mis en forme. La liste couvre aussi les titres, citations et alignements. L'édition du code HTML passe par le
  même filtre et n'ouvre aucune exception. Ce filtre et l'éditeur doivent accepter la même chose : un message enregistré puis rouvert ne change pas.
- Un paquet de compétition d'une version précédente (message texte, sans indication de format) reste accepté.
- Sécurité existante à préserver : adresses passées en objets à nodemailer ; lectures réservées à l'organisateur (`ORGANISER_GETS`,
  `src/server/auth/permissions.ts`), à étendre aux images.
- Tests e2e : le serveur de la plupart des tests (port 3100) est en rôle `local` ; les parcours de mail et d'inscription en ligne doivent passer sur
  le serveur en rôle `serveur` (port 3101), limité à 10 connexions par IP en 15 minutes : ne pas multiplier les connexions.
- Test visible : chaque changement visible est essayé dans Chrome avec l'extension Claude in Chrome, sur une base de test et un faux serveur SMTP local.
  Ne jamais ouvrir la base de production depuis l'hôte. Aucun vrai mail n'est envoyé pendant la construction.
- Rendu dans de vraies boîtes : vérifié par l'organisateur après l'installation de la version sur le serveur (décision de l'organisateur). Il crée un
  club de test avec ses propres adresses (au moins Gmail ; Outlook et Apple Mail si possible) et lui envoie le mail depuis le vrai compte. Le constructeur
  fournit une courte liste de points à contrôler : gras, souligné, couleurs, listes, images et leurs tailles, lien personnel cliquable, pièces jointes, version
  sans mise en forme. Tant que cet essai n'est pas fait, le rendu réel est annoncé comme non vérifié ; les défauts trouvés sont corrigés ensuite.
- Migration SQLite suivante : 0029 (la 0028 est prise par les accès des clubs).

## Stockage des images (décision de conception)

Choix du concepteur :

- Table dédiée (par exemple `mail_images`), contenu dans la base. Les images sont communes à toute l'installation : le message les cite par
  identifiant, ce qui permet à une compétition de reprendre celles du message de l'application sans copie.
- Dans la base, donc dans les **copies de secours du serveur**. C'est un choix différent de celui des pièces jointes (dossier à part, hors
  sauvegardes) : une image fait partie du message, et un message restauré sans ses images serait cassé.
- Table ajoutée à `LOCAL_ONLY_TABLES` : les images **ne voyagent pas** dans le paquet de passage de main. Le serveur garde ses images pendant
  qu'un PC a la main, et le message les retrouve au retour. Si une compétition est importée sur une autre installation, le message arrive sans
  ses images : le refus d'envoi « image absente » s'applique, et l'organisateur les remet.
- Nettoyage : une image citée par aucun message (application et toutes les compétitions) est supprimée après un délai d'au moins 24 h, pour ne
  pas perdre une image ajoutée dans un message pas encore enregistré. Une panne du nettoyage ne bloque jamais le démarrage.

## Laissé au constructeur

- Forme exacte du stockage du format du message (champ dédié ou autre) tant que les exigences sur les anciens messages sont tenues.
- Bibliothèque de filtrage HTML et méthode de génération de la version texte.
- Découpage des composants, nom des routes, valeurs de la palette, valeurs pixel des trois tailles d'image.
- Moment du nettoyage des images orphelines.
- Refus exact sur le PC (route absente ou 403), avec un message clair si un appel arrive quand même.

## Références

- Envoi : `src/server/mail.ts` (`sendInvitations`, `invitationMessage`, `mailtoInvitation`, `invitationAttachments`) ; `src/domain/mail-template.ts`.
- Écrans : `src/web/components/InvitationMail.tsx`, `OnlineEntryPanel.tsx`, `MailAttachments.tsx`, `src/web/pages/AppSettingsPage.tsx`.
- Rôles et main : `src/server/auth/guard.ts`, `src/server/sync/ownership.ts`, `src/server/sync/package.ts`.
- Conception précédente sur les pièces jointes : `docs/superpowers/specs/2026-11-01-pieces-jointes-mails-clubs-design.md`.
