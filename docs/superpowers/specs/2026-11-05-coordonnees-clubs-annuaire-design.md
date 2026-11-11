# Coordonnées des clubs : annuaire et compétitions — conception

Date : 2026-11-05. Discutée en conversation avec l'organisateur, maquettes vues et acceptées. Les choix marqués « choix du concepteur » sont à vérifier à la relecture.

## Intention

Un club de compétition est une copie de sa fiche d'annuaire, faite à l'invitation. L'organisateur a retiré deux adresses d'une fiche et les a vues rester dans une compétition. Il veut que les deux côtés restent cohérents **par ses décisions**, sans écrasement silencieux.

Aujourd'hui, c'est asymétrique et invisible :

- ce que l'organisateur change dans l'annuaire n'atteint jamais les compétitions ;
- ce qu'un coach saisit sur sa page d'inscription **écrase aussitôt l'annuaire**, sans rien signaler (`updateClubEntryHeader`, `src/server/repositories/club-entry.ts:157`).

## Objectifs

### A. Un club de compétition change : depuis sa page, ou dans l'onglet Clubs

- L'annuaire **n'est plus modifié** par la page d'un club (décision de l'organisateur). Le club de la compétition, lui, prend toujours la valeur saisie, comme aujourd'hui.
- Les modifications faites par l'organisateur dans l'onglet **Clubs** d'une compétition suivent la même règle (décision de l'organisateur) : à l'enregistrement, une notification dit que le club diffère de l'annuaire, avec « Comparer » (choix du concepteur).
- Si ce qui est saisi diffère de la fiche d'annuaire, un **changement à examiner** est enregistré pour ce club, avec son origine : `Modifié par le club` ou `Modifié dans la compétition`.
- Champs comparés, partout : **nom du club** (décision de l'organisateur), nom du coach, téléphone, adresses e-mail, numéro d'affiliation.
- Un champ effacé est une modification comme une autre (décision de l'organisateur) : il est proposé, et l'annuaire n'est vidé que si l'organisateur choisit cette valeur. Le nom du club ne peut pas être vide.
- Un seul changement à examiner par club de compétition : le plus récent remplace le précédent, sans perdre ce qui n'a pas été resaisi (toutes les valeurs de l'en-tête sont dans chaque enregistrement).
- Si, après un enregistrement, il n'y a plus de différence avec l'annuaire, il n'y a pas de changement à examiner ; un changement déjà ouvert disparaît.
- **Référence de la comparaison** (choix du concepteur) : un changement garde les valeurs saisies par le club à ce moment. Elles sont comparées à la fiche d'annuaire **au moment de la lecture**. Un changement qui n'a plus de différence, quelle qu'en soit la cause (fiche modifiée par l'organisateur, Google, décision prise pour une autre compétition), n'est plus compté ni affiché, et il est supprimé. Une modification ultérieure, depuis la page du club ou l'onglet Clubs, remplace ces valeurs.
- Rien n'est créé pendant un simple ajout de combattant : seule la modification de l'en-tête du club compte.
- **Ignorer** vaut tant qu'il n'y a pas d'autre modification (décision de l'organisateur) : les valeurs ignorées restent enregistrées. Un nouvel enregistrement avec ces mêmes valeurs ne prévient pas ; une valeur différente prévient de nouveau.

**Numéro d'affiliation** :

- les refus actuels restent (numéro porté par un autre club, fiche qui a déjà un autre numéro) : le coach continue à voir « contactez l'organisateur » ;
- un numéro accepté n'est plus écrit dans l'annuaire : il devient une valeur du changement à examiner ;
- le club de la compétition garde son propre numéro, dans une nouvelle colonne (choix du concepteur) : sa page affiche ce numéro s'il en a un, sinon celui de la fiche. Il reste affiché même si l'organisateur ignore le changement, pour que le coach ne perde pas sa saisie ;
- un numéro refusé n'est pas gardé : le coach voit le refus, comme aujourd'hui.

**Club sans fiche d'annuaire** : le lien automatique existant (`linkClub`) reste. Une fiche créée à cette occasion prend les valeurs du club ; il n'y a alors rien à examiner.

### B. Bandeaux (décision de l'organisateur, maquettes 1 et 2)

- **Annuaire** : bandeau `N clubs diffèrent de l'annuaire après une modification dans une compétition.` avec le bouton « Voir les changements » ; pastille de l'origine et bouton « Comparer » sur chaque fiche concernée.
- **Fiche club d'une compétition**, en tête de la page : un bandeau par club de cette compétition, `<Club> a été modifié le <date> <par le club | dans la compétition> : il diffère de l'annuaire.`, avec « Comparer » ; pastille sur la ligne du club, et dans l'onglet Clubs. Au-delà de 3 clubs, un seul bandeau qui en donne le nombre (choix du concepteur).
- « Voir les changements » ouvre le premier changement à examiner, puis enchaîne sur le suivant après chaque décision (choix du concepteur).
- Réservé à l'organisateur, comme l'annuaire et les inscriptions en ligne.

### C. Fenêtre de comparaison (décision de l'organisateur, maquette 3)

- Même fenêtre depuis l'annuaire et depuis la fiche club.
- Titre : `<Club> : garder quelles informations ?` ; sous-titre : compétition, sa date, et `modifié le <date du changement>`.
- Une ligne par champ : valeur de l'annuaire et valeur de la compétition, un seul choix par ligne pour le nom du club, le coach, le téléphone et le numéro. Un nom ou un numéro déjà pris par une autre fiche se refuse à l'enregistrement. La valeur vide se présente comme `(vide)`. Par défaut, la valeur de la compétition est choisie **si l'enregistrement qui a créé le changement a modifié ce champ**, sauf si elle est vide : c'est alors celle de l'annuaire, pour qu'un effacement ne passe pas sans un clic (choix du concepteur). Un champ que cet enregistrement n'a pas modifié a l'annuaire pour choix par défaut : une ancienne différence (adresses retirées de la fiche par l'organisateur, par exemple) ne revient pas dans la fiche à l'occasion d'un autre changement. Le changement garde donc la liste des champs modifiés par son enregistrement, et les adresses qu'il a ajoutées. Un champ identique est affiché, sans choix.
- E-mails : une case par adresse de l'union des deux listes, avec son origine (`dans les deux`, `ajoutée dans la compétition` pour une adresse ajoutée par l'enregistrement du changement, `seulement dans la compétition` pour une adresse du club que cet enregistrement n'a pas ajoutée, `seulement dans l'annuaire`). Par défaut sont cochées les adresses communes et celles ajoutées par l'enregistrement ; les adresses `seulement dans la compétition` sont décochées. Si le club a effacé toutes ses adresses, ou si l'enregistrement n'a pas modifié les e-mails, les adresses de l'annuaire sont cochées : vider la fiche demande de les décocher (choix du concepteur). Ordre gardé : celles du club d'abord, la première restant la principale. Si les deux listes sont identiques, la liste de la fiche est envoyée telle quelle (ordre et adresse principale de la fiche inchangés).
- Case `Appliquer aussi au club dans <compétition>`, cochée : si le choix retenu diffère de ce que le club a saisi, le club de cette compétition prend aussi le résultat.
  - Compétition gérée ailleurs (main sur un PC) : case désactivée, avec `Gérée par <nom> : à appliquer après le retour de la main.` ; l'annuaire reste modifiable (choix du concepteur).
  - Compétition passée : pas de case, seul l'annuaire est modifié (choix du concepteur).
- Compétition à venir gérée ailleurs, décision prise sans application au club : si le club diffère encore du résultat, le changement reste à examiner après le retour de la main, avec l'annuaire pour choix par défaut de tous les champs. Compétition passée gérée ailleurs : seul l'annuaire est modifié et le changement est fermé, puisque rien ne sera appliqué au club (décision du contrôleur, relecture globale du 2026-11-06). Si le PC a changé les valeurs d'un changement ignoré pendant qu'il avait la main, le changement repasse à examiner à la réception.
- Report vers un club refusé (`apply-to-clubs`) parce que le club ou la fiche a changé depuis l'affichage : `Ce club ou cette fiche vient de changer : rien n'a été appliqué à ce club.` (la fenêtre n'est pas rouverte).
- Une décision sur une fiche peut faire disparaître les changements d'autres compétitions liés à la même fiche, s'ils n'ont plus de différence ; les autres restent à examiner.
- Trois sorties :
  - **Enregistrer dans l'annuaire** : applique les choix et ferme le changement ;
  - **Ignorer ce changement** : ne touche à rien et ferme le changement ; il ne revient que si une valeur change de nouveau (voir A) ;
  - **Plus tard** : ferme la fenêtre sans rien changer ; le changement reste.
- Enregistrer passe par les contrôles de l'annuaire : numéro déjà porté par une autre fiche (refus affiché dans la fenêtre), formats d'adresses.
- Si la fiche d'annuaire a changé pendant que la fenêtre était ouverte (versions de ligne existantes, `If-Match`), refus clair et rechargement de la comparaison (choix du concepteur).

### D. L'organisateur modifie une fiche d'annuaire (décision de l'organisateur, maquette 4)

- Après l'enregistrement de la fiche, si le nom, le coach, le téléphone, les e-mails ou le numéro ont changé, et si des clubs de compétitions **à venir** y sont reliés et diffèrent, une fenêtre `Appliquer aux compétitions à venir ?` s'ouvre. Sinon, rien ne s'ouvre. L'enregistrement de la fiche est déjà fait : fermer la fenêtre ne l'annule pas.
- Un nom refusé dans une compétition (autre club du même nom) laisse ce club tel quel, et le résultat le dit.
- « À venir » : date de la compétition supérieure ou égale à la date du jour (choix du concepteur, annoncé à l'organisateur).
- Une ligne par compétition et par champ qui diffère. Compétition gérée ailleurs (main sur un PC) : affichée, non modifiable, avec `Gérée par <nom> : à appliquer après le retour de la main.` (choix du concepteur).
- L'ancienne fiche est la valeur juste avant cet enregistrement, lue dans la même requête.
- **Sans conflit** : le club avait exactement la même valeur que l'ancienne fiche ; la ligne est cochée « Appliquer ».
- **Conflit** : dans tous les autres cas où le club diffère de la nouvelle fiche, y compris une différence restée d'une fenêtre fermée sans rien appliquer ; choix `Garder le club` (par défaut) ou `Prendre l'annuaire` (choix du concepteur : on n'écrase jamais une valeur dont l'origine n'est pas sûre).
- E-mails : la liste de la fiche remplace celle du club si on applique ; pas de fusion dans cette fenêtre (choix du concepteur).
- Boutons : « Ne rien appliquer » et « Appliquer ». Une compétition en échec n'empêche pas les autres ; le résultat est dit par compétition.
- Appliquer au club de la compétition ferme un changement à examiner devenu sans différence.

### Documentation

`docs/guide-utilisateur.md` et `src/web/help.ts` : la copie à l'invitation, les bandeaux, la comparaison, les compétitions à venir. Retirer ou corriger tout texte qui dirait que l'annuaire suit la page du club. Le texte de la page du club ne doit pas promettre que l'annuaire est mis à jour.

## Non-objectifs

- Pas de mise à jour automatique dans un sens ou dans l'autre.
- ~~Pas de proposition depuis la synchronisation Google~~ : retiré le 2026-11-11 (bug signalé par l'organisateur : la fiche mise à jour par Google ne pouvait plus être reportée sur la compétition). La synchronisation écrit toujours dans l'annuaire sans créer de changement à examiner, puis ouvre la fenêtre D pour chaque fiche mise à jour ou liée dont des clubs de compétitions à venir diffèrent (valeurs d'avant = fiche avant la synchronisation). Une fiche offre aussi « Appliquer aux compétitions à venir… » à tout moment : différences restées, toutes en conflit (valeurs d'avant inconnues).
- Pas de proposition depuis l'import d'une fiche ou l'import FFK : seules la page en ligne d'un club et l'onglet Clubs créent un changement à examiner.
- Pas d'historique des décisions.
- Pas de notification par mail à l'organisateur.
- Pas de changement pour les compétitions passées.
- Pas de suppression des liens d'accès quand une adresse est retirée.

## Anti-objectifs

- Une saisie de coach change l'annuaire sans décision de l'organisateur.
- Un coach voit, sur sa page, les valeurs de l'annuaire d'un autre état, ou perd ce qu'il vient de saisir.
- Une correction de coach est écrasée sans que l'organisateur ait été prévenu du conflit.
- Une compétition sous la main d'un PC est modifiée sur le serveur.
- Un coach est bloqué dans son inscription parce qu'un changement attend une décision.
- Les coordonnées contenues dans un changement à examiner survivent à la purge des données.

## Contraintes

- Stack existante : Fastify, drizzle, SQLite, React, Mantine. Écrans et messages en français. Bandeaux avec les jetons `--sk-*` et lisibles dans les deux thèmes.
- Réutiliser ce qui existe quand c'est naturel : règles de `src/domain/emails.ts`, présentation de `DirectorySyncPage`, `checkNumber`, garde de lecture seule de `src/server/sync/ownership.ts`.
- Migration suivante : `0031`, sur la base de production sans perte (une nouvelle table et une colonne vide pour le numéro du club, qui voyage avec le club dans le paquet). Aucun changement à examiner n'est fabriqué pour le passé, faute de savoir ce que les clubs ont saisi (choix du concepteur).
- Stockage (choix du concepteur) : une ligne par club de compétition, reliée au club et à la fiche d'annuaire, avec les valeurs, l'origine, la date, l'état « ignoré », les champs modifiés par l'enregistrement et les adresses qu'il a ajoutées. Suppression en cascade avec le club ou la compétition. Table `LOCAL_ONLY_TABLES` : un changement à examiner ne voyage pas dans le paquet de passage de main, et il survit à l'aller-retour tant que le club existe. Le changement reste dans les sauvegardes.
- Fusion de fiches d'annuaire : les changements suivent la fiche gardée. Fiche supprimée : le changement est supprimé. Fiche archivée : le changement est gardé mais ni compté ni affiché, et il revient si la fiche est désarchivée (choix du concepteur).
- Purge (`purgeExpiredData`) : les changements des compétitions purgées sont supprimés. Compétition passée : le changement reste proposé jusqu'à la purge ou à la décision.
- Le lien d'un club sans organisateur n'ouvre aucune nouvelle donnée : le coach ne voit jamais de valeur de l'annuaire qu'il n'avait pas déjà.
- Rôles : routes réservées à l'organisateur par le mécanisme actuel. Un compte Table centrale qui modifie un club dans l'onglet Clubs crée le changement, mais ne le voit pas (choix du concepteur). Sur un PC, l'onglet Clubs crée aussi un changement à examiner, et l'annuaire y montre A, C et D pour les compétitions gérées ici ; le bandeau de la fiche club y reste, hors de la section Inscriptions en ligne retirée du PC (choix du concepteur).
- Tests e2e : parcours en ligne sur le port 3101 avec `SERVER_SESSION`, sans nouvelle connexion (limite de 10 par IP en 15 minutes). Noms de compétition uniques.
- Test visible : chaque changement visible est essayé dans Chrome avec l'extension, sur une base temporaire et des données fictives. Ne jamais ouvrir la base de production depuis l'hôte.

## Laissé au constructeur

- Noms des routes, de la table et des composants.
- Forme exacte de la navigation « suivant » dans la fenêtre.
- Découpage entre logique pure (comparaison, conflits, fusion des e-mails, à tester sans base) et écrans.

## Références

- `src/server/repositories/club-entry.ts`, `src/server/db/club-directory.ts`, `src/server/repositories/directory.ts`, `src/server/repositories/invitations.ts`, `src/server/repositories/retention.ts`, `src/server/sync/package.ts`.
- `src/web/pages/DirectoryPage.tsx`, `src/web/pages/DirectorySyncPage.tsx`, `src/web/components/OnlineEntryPanel.tsx`.
- Conception d'origine de la copie : `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md`.
