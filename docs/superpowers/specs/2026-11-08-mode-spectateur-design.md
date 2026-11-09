# Mode spectateur — conception

Date : 2026-11-08. S'appuie sur l'ordre de passage et les vagues (`2026-10-22-ordre-de-passage-et-aides-design.md`), le
serveur en ligne (`2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md`, étapes 17 à 21) et la conservation des
données (§8.4 de ce même document).
✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant).

Maquette validée par l'utilisateur (✅ « A, mais détaille un peu plus » puis ✅ « c'est bon ») :
`.superpowers/brainstorm/24610-1794159383/content/spectateur-detail.html` (fichier local, git-ignoré ; s'ouvre directement
dans un navigateur). Elle fait foi pour la disposition et les textes, pas pour le code ni pour les données d'exemple.

## 1. Pourquoi

Le jour J, les parents, les coachs et les combattants ne savent pas **où et quand** a lieu un combat. Ils viennent demander
à la table centrale, ou attendent devant la mauvaise zone. ✅ L'utilisateur veut qu'un spectateur, sans compte, ouvre la
page d'accueil sur son téléphone et sache **sur quelle zone, avec quel numéro et vers quelle heure** combat son enfant, et
puisse suivre les **tableaux qui se remplissent avec les vainqueurs**. Il veut aussi pouvoir consulter **l'historique des
compétitions passées**.

✅ La compétition du 22 novembre 2026 se déroule **sur le serveur en ligne** (`competitions.shidokanfrance.com`, Table
centrale et zones connectées) : c'est le serveur qui sert la page publique, avec les données à jour.

**Réussi si :**

- un parent tape « mart » dans la recherche, épingle « MARTIN Léa », et lit « Zone 2 · n° 14 · vers 10:55 · 3 combats
  avant le sien » ;
- quand un résultat est saisi sur une zone, les téléphones ouverts se mettent à jour seuls, en quelques secondes ;
- un retard pris en début de session décale les heures annoncées pour la suite de cette session (✅ une session ne décale
  pas la suivante : rien ne dit qu'elle la suit le même jour, ni sur la même zone sans pause) ;
- un coach suit tout son club d'un geste ;
- un an plus tard, on retrouve les podiums et les tableaux de la compétition dans l'historique.

**Échec même si « ça marche » :**

- une donnée d'organisation sort sur la page publique : poids, grade, licence, coordonnées du coach, notes internes,
  compétition privée ;
- un numéro ou une heure affichés **avant le lancement de la vague**, qui change ensuite ;
- le nom d'un combattant masqué apparaît quelque part (recherche, tableau, podium, historique) ;
- la page publique ralentit les postes de l'organisation le jour J ;
- une compétition privée se devine (son identifiant répond autrement qu'un identifiant inconnu).

## 2. Visibilité d'une compétition ✅

- Deux états : **Privée** et **Publique** ✅ (l'état « brouillon » proposé au départ a été retiré par l'utilisateur).
- **Privée** : visible seulement par les comptes de l'organisation, comme aujourd'hui. 💡 C'est l'état à la création, et
  celui de toutes les compétitions existantes après la migration.
- **Publique** : affichée sur la page d'accueil publique.
- Le choix se fait dans les réglages de la compétition (organisateur seulement 💡). Repasser en privée la retire aussitôt
  de la page publique (les téléphones ouverts affichent « Cette compétition n'est plus affichée »).
- 💡 La visibilité voyage avec la compétition (paquet de synchronisation, sauvegardes), comme les autres colonnes de
  `competitions`.

## 3. Ce que voit le spectateur

### 3.1 Page d'accueil

- ✅ Sur le serveur, un visiteur **non connecté** qui ouvre `/` voit la page d'accueil publique. ✅ Un **bouton « Connexion
  organisateurs »**, bien visible en haut de la page d'accueil (pas un petit lien en bas comme sur la maquette), mène à la
  connexion habituelle ; 💡 après la connexion, l'organisateur arrive sur la liste des compétitions. 💡 Le même bouton reste
  en haut des pages d'une compétition publique. 💡 Un organisateur connecté qui ouvre `/` garde la liste des compétitions actuelle, avec
  un lien « Voir la page publique ».
- Trois blocs (maquette, écran 1) : **Aujourd'hui** (compétitions publiques en cours, avec « ● EN DIRECT »), **À venir**,
  **Historique** (terminées, de la plus récente à la plus ancienne).
- 💡 « Aujourd'hui » = la date de la compétition est aujourd'hui, ou une de ses vagues est lancée et la compétition n'est
  pas terminée. « Terminée » = date passée. Le constructeur choisit la règle exacte pour une compétition sur deux jours
  (il n'y en a pas aujourd'hui).
- **À venir** : nom, date, lieu, et l'heure prévue de chaque vague si elle est saisie. Rien d'autre ✅ (tableaux et numéros
  attendent le lancement de la vague, §3.6).
- 💡 Sur une installation **locale** (PC), `/` reste la page de l'organisateur ; la page publique est accessible à une
  adresse à part (par exemple `/public`) pour un écran dans la salle. Le constructeur choisit l'adresse ; elle est la même
  sur le serveur, `/` y menant pour les visiteurs non connectés.

### 3.2 Page d'une compétition : quatre onglets ✅

Barre en bas de l'écran (maquette) : **★ Suivis · Zones · Tableaux · Résultats**. En haut : nom de la compétition,
« ● EN DIRECT · mis à jour à HH:MM ». Conçue d'abord pour un téléphone, utilisable sur un ordinateur.

**Suivis** (onglet ouvert par défaut ✅, écran 2) :

- Champ de recherche « Nom, prénom ou club… ».
- Une carte par combattant épinglé. Le **prochain combat** est mis en avant : zone, numéro, heure prévue en gros ;
  « N combats avant le sien sur la zone » ; adversaire (« contre BONNET Chloé (Kime Club) » ou « contre le vainqueur du
  n° 12 ») ; durée prévue (« 2 × 1 min 30 »).
- Les combats joués : « n° 9 · a battu PETIT Noah » (gagné) ou « battue par FAURE Jade » (perdu). Pastille d'état :
  à venir, qualifié, éliminé, médaille.
- Kata : numéro de passage du bloc, zone, heure prévue, puis note et place.
- Un combattant inscrit dans plusieurs disciplines a une ligne par catégorie, sur la même carte 💡.

**Recherche** (écran 3) : par nom, prénom ou club, sans tenir compte des accents ni des majuscules. Un club propose
« ★ Suivre tout le club » ✅. Les épingles sont gardées **sur le téléphone** (stockage du navigateur), sans compte ✅, par
compétition 💡. Un combattant masqué n'apparaît pas dans la recherche (§4).

**Zones** (écran 4) :

- En haut, la vague : « Vague 1 · prévue 9:30 · démarrée 9:41 ».
- Par zone : le combat **à suivre** mis en avant, les suivants avec leur heure prévue et les deux noms (« LEROY A. /
  ROUX M. »), « voir les N suivants », et « en avance / en retard de N min » (écart entre l'heure prévue au départ de la
  vague et l'heure estimée maintenant 💡).
- 💡 L'application ne sait pas qu'un combat **a commencé** (seul le résultat est saisi). Le combat mis en avant est le
  **premier combat sans résultat** dans l'ordre de passage de la zone ; la maquette dit « en cours », le constructeur peut
  écrire « sur le tatami » ou « à suivre », sans prétendre qu'il est commencé.
- Zone des finales : c'est une zone ordinaire choisie dans les réglages (`settings.finalsZoneId`). Elle joue aussi ses
  propres catégories, et les finales de la vague passent à la fin de sa file (`src/domain/passages/plan.ts`). Sa file
  montre une ligne « Finales de la vague 1 à partir de HH:MM » à l'endroit où elles commencent. La maquette (« les finales
  de toutes les catégories ») se trompe sur ce point : le code fait foi.
- Les vagues suivantes : heure de pesée si connue et heure de début prévue.
- Toucher un combat ouvre son tableau.

**Tableaux** (écran 5) :

- Liste des catégories de la compétition dont la vague est lancée, avec filtres par discipline et par vague, zone et
  état (à venir, en cours, terminé).
- Un tableau : en-tête « zone · format · durée des rounds · finale vers HH:MM » ; le tableau en lecture seule qui se remplit
  avec les vainqueurs ; une vue « Combats » (liste dans l'ordre de passage). Tous les formats existants doivent s'afficher
  (élimination simple et double, repêchage, petite finale, poules, poules puis tableau, combat unique, au meilleur des
  trois, kata) 💡 en réutilisant l'affichage actuel des tableaux en lecture seule si c'est possible.
- Les combattants suivis sont surlignés.

**Résultats** (écran 6) :

- Podiums des catégories terminées, de la plus récente à la plus ancienne, avec filtre par discipline.
- Décompte des médailles **par club** 💡 (validé avec la maquette).
- Le même écran sert pour une compétition de l'historique.

### 3.3 Mise à jour en direct 💡

- La page se met à jour seule, sans recharger, en écoutant un flux d'événements public de la compétition (même principe
  que `/api/competitions/:id/events`, mais ouvert sans connexion et réservé aux compétitions publiques).
- « mis à jour à HH:MM » = heure de la dernière donnée reçue ; un bandeau « Connexion perdue, nouvel essai… » si le flux
  tombe, puis reprise automatique.
- Si la compétition a la main ailleurs (PC en secours, zone sans réseau), le serveur montre ce qu'il a, et l'heure de mise à
  jour le dit. Aucun traitement spécial de plus.

### 3.4 Historique ✅

- Seulement les compétitions **publiques** et terminées.
- Le palmarès est déjà gardé sans limite de durée (nom, prénom, club, catégorie, tableaux, résultats, places), donc
  l'effacement automatique des 13 mois ne retire rien de ce que montre l'historique. Les heures et durées n'y sont plus
  affichées 💡.
- Onglets : Tableaux et Résultats (pas de Suivis ni de Zones 💡 ; la recherche reste, elle surligne).

### 3.5 Noms des combattants ✅

- **Nom et prénom complets** ✅ (« MARTIN Léa »), et le club. Dans les files des zones, la forme courte « MARTIN L. »
  suffit 💡.
- Jamais : poids, grade, licence, coordonnées, date de naissance, notes internes, état de pesée ou de présence.
- 💡 Un combattant absent ou qui ne combat pas apparaît comme dans le tableau de l'organisation (« forfait »,
  « exempt ») ; aucune raison n'est affichée.

### 3.6 Quand une compétition publique montre ses tableaux ✅

- **Rien avant le lancement de la vague** ✅ : ni tableaux, ni numéros, ni zones, ni heures. Avant, la compétition (ou la
  vague) affiche « Numéros et horaires au lancement de la vague, prévu vers 9:30 ».
- Au lancement, les catégories de la vague apparaissent avec leurs numéros figés.
- Une vague **rouverte** disparaît de nouveau de la page publique jusqu'au prochain lancement 💡.
- Une renumérotation après lancement (« à la suite ») se voit aussitôt, comme sur les feuilles imprimées.
- Compétition sans vague (vague implicite) : même règle, avec son lancement.

## 4. Masquer le nom d'un combattant ✅

- ✅ L'organisateur peut masquer le nom d'un combattant précis (demande d'un parent).
- 💡 Le réglage est porté par le combattant de la compétition (pas l'inscription) : il vaut pour toutes ses disciplines.
  Il se change depuis sa fiche dans Inscriptions, par l'organisateur et la Table centrale.
- 💡 Affichage public : « Combattant masqué » à la place du nom et du prénom, partout (tableaux, files, podiums, historique,
  adversaire d'un autre combattant). Le club reste affiché. Il ne sort jamais dans la recherche et ne peut pas être épinglé.
- Aucun changement côté organisation : impressions et écrans internes gardent le nom.
- 💡 Le réglage voyage avec la compétition et reste après l'effacement des 13 mois (il protège l'historique).

## 5. Heures prévues

### 5.1 Heures de début ✅

- **Heure de début prévue** ✅ : saisie à l'avance, **par vague** 💡 (chaque vague a déjà sa pesée et son lancement ;
  l'utilisateur n'a pas demandé d'heure par zone). Vague implicite : une heure pour la compétition.
- **Heure effective de démarrage** ✅ : par vague, modifiable. 💡 Un bouton « Maintenant » la remplit ; si elle est vide
  quand le premier résultat de la vague arrive, elle est estimée à « heure de ce résultat − durée de ce combat » et
  affichée comme estimée jusqu'à ce que quelqu'un la saisie.
- **Finales** ✅ : par défaut, les finales d'une vague commencent à la fin estimée des combats éliminatoires de cette vague
  (✅ « généralement on les démarre à la fin des rounds éliminatoires ») ; l'organisateur peut fixer leur propre heure ✅,
  💡 une par vague (les finales passent à la fin de chaque vague dans l'ordre de passage).
- 💡 Ces heures se saisissent dans l'onglet Vagues (là où se trouve le lancement), par l'organisateur et la Table centrale.

### 5.2 Durée d'un combat

Durée = rounds × durée d'un round + repos entre les rounds + temps de changement entre deux combats.

- ✅ Paramétrable **globalement sur la compétition**, **sur un tableau** précis, et **sur un combat** précis ✅ (par exemple une
  finale en 3 rounds dans un tableau en 2). Le plus précis l'emporte : combat, puis tableau, puis compétition.
- 💡 Valeurs par défaut tirées du règlement (« Règlement Shidokan Triathlon Martial 2026.10.13 », p. 38 à 44 ; fichier
  local de l'utilisateur, non versionné) :

  | Groupe | Rounds | Durée | Repos entre rounds | Prolongation (non comptée) |
  |---|---|---|---|---|
  | moins de 14 ans | 2 | 1 min 30 | 30 s | 1 min |
  | 14 à 17 ans | 2 | 2 min | 1 min | 1 min |
  | 18 ans et plus (Jiyu et Shobu) | 2 | 2 min | 1 min | 2 min |
  | Triathlon | 3 | 2 min | 1 min | 2 min |

  Les trois disciplines (karaté, Shido-Boxing, Shido-Mix) ont les mêmes temps. Triathlon en 6 rounds = changement de
  réglage. Le groupe d'âge vient de la tranche d'âge de la catégorie 💡 (sa borne haute, ou un choix fait dans la grille).
- 💡 Temps de changement entre deux combats : 1 min par défaut, réglable sur la compétition. Le constructeur regarde ce que
  signifie `noRest` dans l'ordre de passage et le réutilise s'il dit « pas de pause ».
- 💡 Kata : une durée par passage (1 min 30 par défaut), multipliée par le nombre de passages du bloc.
- 💡 Les prolongations ne sont pas comptées à l'avance : le recalcul au fil des résultats les absorbe. Elles sont gardées
  dans le réglage pour l'affichage (« prolongation possible : 1 min ») si le constructeur le juge utile.
- Ces durées sont aussi affichées aux spectateurs (« Durée prévue : 2 × 1 min 30 »).

### 5.3 Calcul 💡

**Une ligne de temps par vague et par zone**, dans l'ordre de passage figé. ✅ Les vagues sont **indépendantes** : un retard
pris dans une vague ne décale pas la suivante (l'application ne sait pas si la suivante a lieu l'après-midi ou le lendemain ;
on ne suppose rien) :

1. Point de départ d'une vague sur une zone = son heure effective de démarrage, sinon celle estimée d'après son premier
   résultat (§5.1), sinon son heure prévue ; aucune : pas d'heures pour cette vague. La fin de la vague précédente n'entre
   pas en compte.
2. Pour les combats déjà joués, on prend l'heure de saisie du résultat (`match_results.created_at`, et l'équivalent pour le
   kata) comme heure de fin.
3. 💡 (relecture finale du 2026-11-09) Le premier combat sans résultat après le dernier combat joué est le **combat en
   cours** : il commence à la fin du dernier combat joué (+ changement), et, dans une vague **démarrée** (heure effective
   saisie ou un résultat), sa **fin** estimée n'est jamais avant maintenant (départ ≥ maintenant − sa durée) ; une vague pas
   encore démarrée garde ses heures prévues. Chaque combat suivant commence à la fin du précédent (durée + changement). Un
   combat sans résultat placé **avant** un combat joué de la même vague sur la zone (résultat ou notes saisis en retard)
   n'a pas d'heure et ne décale rien, jusqu'à ce que son résultat soit saisi. Aucune heure déjà passée n'est montrée
   (Zones, Suivis, finale d'un tableau) : le combat dont le départ estimé est passé est sur le tatami, sans heure (vérification
   sur iPhone du 2026-11-09 : avec un kata saisi en retard, le combat en cours n'était pas en tête de zone et gardait une
   heure dépassée).
4. Un combat dont les combattants ne sont pas encore connus (« vainqueur du n° 12 ») a quand même une heure.
5. Finales d'une vague, sur la zone des finales : elles commencent au plus tard entre la fin de ce qui les précède sur cette
   zone et, soit l'heure fixée par l'organisateur pour la vague, soit à défaut la fin estimée la plus tardive des combats
   non-finales de la vague sur les autres zones. 💡 (relecture finale du 2026-11-09) Seule la première finale attend ; une
   fois les finales commencées, elles s'enchaînent. La « finale vers » d'un tableau est celle de son premier combat de
   finale pas encore joué (rien une fois la finale jouée).
6. Heures arrondies à la minute ; « vers » devant. Avance / retard d'une zone = heure estimée du prochain combat − heure
   qu'il aurait avec les seules heures prévues (sans résultat ni heure effective) ; le prochain combat est le premier après
   le dernier joué.
7. Une vague pas encore lancée n'a pas d'heures par combat ; elle n'entre dans la ligne de temps qu'à son lancement.

Le calcul est **pur** (domaine, testable sans base), comme `src/domain/passages/`.

## 6. Mention sur les données personnelles 💡

Le texte par défaut de la page d'inscription des clubs dit que les résultats sont « conservés comme archive sportive ». Il
doit dire aussi qu'ils sont **publiés sur le site** (nom, prénom, club, catégorie, résultats), et qu'on peut demander à
l'organisateur de masquer un nom. On change le texte par défaut ; si l'installation a gardé l'ancien texte par défaut, on le
remplace ; s'il a été modifié, les Réglages affichent un rappel. À faire valider par Shidokan France, comme le reste de la
mention.

## 7. Contraintes

- Interface en français, mêmes composants et thème que le reste (`src/web/components/ui/`, jetons `--sk-*`), clair et
  sombre, utilisable à 360 px de large sans défilement horizontal.
- **Routes publiques à part**, en lecture seule, qui ne renvoient que les champs publics (liste blanche, pas un filtre des
  routes de l'organisation). Une compétition privée ou inconnue répond 404 de la même façon. À ajouter à `isPublicRoute`
  (`src/server/auth/guard.ts`). 💡 Pas la limite des pages des clubs (300 requêtes / 10 min / adresse) : des centaines de
  téléphones peuvent sortir par la même adresse (Wi-Fi de la salle, réseau mobile). Une limite par adresse très large, ou
  aucune pour les lectures publiques, et la protection vient du cache.
- ✅ Le jour J, les spectateurs **n'utilisent pas le même Wi-Fi** que la Table centrale et les zones.
- **Charge** : quelques centaines de téléphones le jour J. 💡 Les données publiques d'une compétition sont calculées une fois
  et gardées en mémoire jusqu'au prochain changement ; le flux public prévient sans renvoyer toutes les données ; les
  téléphones relisent une réponse petite, avec un ETag (304 si rien n'a changé), et les relectures après un changement sont
  étalées sur quelques secondes pour ne pas arriver toutes en même temps.
- Les comptes Zone et Table centrale n'ont rien de nouveau à faire pour que la page vive : leurs saisies suffisent.
- Migration de base pour : visibilité, heures des vagues (prévue, effective, finales), durées sur la compétition et sur un
  tableau, masquage d'un combattant. Les durées de la compétition peuvent aller dans `settings_json`.
- Le paquet de synchronisation, les sauvegardes et la restauration transportent les nouvelles colonnes.
- Vérification sur Chrome (Claude in Chrome) de chaque changement visible, y compris sur une largeur de téléphone.

## 8. Livraison ✅ pour le 22 novembre 2026

✅ Le mode spectateur doit être prêt pour la compétition du 22 novembre 2026. 💡 Pour que la compétition reste sûre, en deux
lots, chacun livré, vérifié sur Chrome et poussé avant de commencer le suivant :

- **Lot 1 (indispensable)** : visibilité privée / publique, page d'accueil publique, onglets Suivis (avec recherche et
  « Suivre tout le club »), Zones (numéros et ordre, sans heures), Tableaux, Résultats, historique, masquage d'un nom,
  mention, mise à jour en direct, routes publiques et cache.
- **Lot 2** : heures (prévue, effective, finales par vague), durées (compétition, tableau, combat), heures affichées dans
  Suivis et Zones, avance / retard.
- 💡 Aucun nouveau changement après le **18 novembre** : les jours restants servent à une répétition complète sur le serveur
  (une compétition de démonstration rendue publique, plusieurs téléphones, saisies depuis des comptes Zone). Si le lot 2
  n'est pas prêt à cette date, il attend la compétition suivante.
- Le chantier des finales (`2026-11-08-finales-des-que-pretes-design.md`) vient après.

## 9. Hors champ

- Comptes spectateurs, notifications sur le téléphone, partage d'un lien vers un combattant (💡 possible plus tard).
- Chronomètre ou indication qu'un combat a commencé : il faudrait une saisie de plus sur les zones.
- Photos, vidéos, diffusion.
- Garantie sur les heures : ce sont des estimations (« vers »).
- Plusieurs jours de compétition.

## 10. Laissé au constructeur

- Adresses exactes des pages et des routes publiques, forme des données publiques, découpage en composants.
- Détail des filtres, des textes d'état et des pastilles, dans l'esprit de la maquette.
- Où se règlent les durées d'un tableau (onglet Tableaux, dialogue du tableau).
- Le découpage en tâches et l'ordre de livraison.
