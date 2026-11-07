# Planche des tableaux et historique annulable — conception

Date : 2026-11-07. Suite de `2026-11-06-placements-manuels-design.md` (déplacements manuels, tableaux libres, échanges
gardés) et du plan d'ensemble (`2026-10-25-plan-d-ensemble-reaffectation-design.md`).
✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant).

Maquette validée par l'utilisateur (✅ « C'est bon », puis historique et cascade validés) :
`.superpowers/brainstorm/39331-1794069140/content/planche-historique-v4.html` (fichier local, git-ignoré ; s'ouvre
directement dans un navigateur). Elle fait foi pour la disposition et les textes, pas pour le code.

## 1. Pourquoi

Le jour J, l'organisateur doit **déplacer des combattants** : en changer un de catégorie, en remplacer un par un autre, ou
changer sa place dans un tableau. Aujourd'hui, dans l'onglet Tableaux, on ne voit **qu'un tableau à la fois** : pour
déplacer quelqu'un, il faut le cliquer, choisir une destination dans une liste, puis aller voir l'autre tableau. On n'a
**aucune vue d'ensemble**, et l'**échange entre deux catégories** n'existe pas (il faut deux déplacements).

De plus, **on ne peut pas tout annuler** : les réaffectations ont un historique (section « Réaffectations validées » de la
Réaffectation), mais il oblige à annuler dans l'ordre (« Annulez d'abord la réaffectation plus récente de ce combattant »),
et les **échanges de places, nouveaux tirages et changements de format ne laissent aucune trace**.

✅ L'utilisateur veut :

1. **Glisser-déposer** les combattants : vers une autre place du même tableau, sur un autre combattant (n'importe quelle
   catégorie) pour les échanger, ou dans une autre catégorie.
2. **Voir tous les tableaux en même temps** pour glisser de l'un à l'autre et comprendre ce qui se passe, en retrouvant
   **toujours facilement** une catégorie précise.
3. **Un historique de tout** ce qui change les tableaux, depuis n'importe quelle page, **tout annulable**, avec une
   annulation **en cascade** et la **mise en évidence** de ce qui partira avec.

**Réussi si**, à la table centrale :

- on voit d'un coup d'œil toutes les catégories de la session, et les combattants sans adversaire sont à portée de main ;
- on retrouve « Minimes M -50 kg » ou « FONTAINE » en tapant quelques lettres ;
- on échange deux combattants de deux catégories en un seul glisser-déposer suivi d'une confirmation ;
- on rattrape une erreur en un clic (message « Annuler » juste après l'action) ou plus tard depuis l'historique ;
- avant d'annuler, on voit exactement ce qui va revenir en arrière, y compris ce qui part en cascade.

**Échec même si « ça marche » :** une annulation qui laisse un tableau incohérent (un combattant inscrit dans une catégorie
mais absent de son tableau, ou présent deux fois) ; une cascade qui emporte une action sans l'avoir montrée avant ; un
dépôt accepté sur une catégorie lancée ; une catégorie introuvable parce que la planche est trop chargée ; une action qui
change un tableau sans apparaître dans l'historique.

**Déjà fait** (2026-11-07, `main`, 820e861) : la catégorie à un seul combattant affiche sa case dans le tableau, cliquable
pour le déplacer (avant : une phrase seule, sans moyen de le choisir).

## 2. La planche (onglet Jour J → Tableaux)

### 2.1 Place dans l'onglet

💡 L'onglet Tableaux a deux vues, choisies par un sélecteur « Planche / Liste » : **Planche** (nouvelle, par défaut) et
**Liste** (la page actuelle : une catégorie à la fois, format, repêchage, 3e place, « Marquer prête », impression). La vue
choisie est retenue par poste (stockage du navigateur, comme les autres préférences locales). Les réglages d'une catégorie
(format, options, prête, imprimer) restent dans la Liste ; depuis une carte de la planche, un lien ouvre cette catégorie
dans la Liste. 💡

### 2.2 Barre d'outils

De gauche à droite (maquette v4) :

- **Session** : comme aujourd'hui (`useSelectedWave`) — chaque session, « En attente (n) », « Toutes ». Sans sessions, pas
  de sélecteur.
- **Recherche** « Chercher une catégorie ou un combattant » : filtre les cartes dont le libellé ou un combattant contient
  tous les mots tapés (sans accents ni casse, `normalizeName`) ; les combattants trouvés sont surlignés dans leur carte.
- ✅ **Classer par** : **Catégorie** (par défaut) ou **Zone**.
- **Seulement à traiter** : cartes sans adversaire ou avec un cas à traiter.
- **Historique (n)** : ouvre le panneau d'historique (§3) ; n = actions encore en place.

Sous la barre, une **ligne de raccourcis** : un lien par groupe affiché avec son nombre de cartes (« Karaté · Jiyu —
Benjamins (3) »), qui fait défiler jusqu'au groupe.

### 2.3 Ordre et groupes

✅ **Classer par Catégorie** : l'ordre de l'appli (`compareKeys`, `src/domain/categories.ts`) — discipline (Karaté,
Shido-boxing, Shido-mix-martial, Triathlon, Kata), règlement (Jiyu avant Shobu), tranche d'âge (de la plus jeune), sexe
(F, M, mixte), poids croissant ; tableaux libres en dernier, par nom. Un **groupe** = discipline · règlement · tranche
d'âge (« Karaté · Jiyu — Benjamins », « Kata — Minimes ») 💡 ; les tableaux libres forment le groupe « Tableaux libres ».
Une catégorie dont la tranche est un regroupement (« Benjamins / Minimes ») va dans le groupe de sa première tranche 💡.

✅ **Classer par Zone** : un groupe par zone (ordre des zones de la compétition), « Sans zone » en dernier ; dans une
zone, l'ordre des catégories ci-dessus. La zone d'une catégorie = celle du plan de passage (`categoryPassages`, zone
épinglée ou automatique). ✅ Pas de classement par ordre de passage (les combats des catégories d'une zone sont mêlés).

### 2.4 Bac « Sans adversaire »

À gauche, toujours visible (collé en haut au défilement ; au-dessus de la planche sur un écran étroit) : un combattant par
catégorie qui n'a qu'un présent, avec le nom de sa catégorie au-dessus, pour la session affichée **et** celles en attente
(avec le nom de la session quand ce n'est pas celle affichée) 💡. On le glisse comme une pastille de la planche (§2.6).
Vide : « Tout le monde a un adversaire. »

### 2.5 Cartes

Une carte par catégorie affichée (une catégorie sans aucun inscrit présent n'a pas de carte 💡, sauf un **tableau libre**, qui a toujours sa carte, même vide, pour qu'on puisse y déposer des combattants ; il apparaît dans sa session — `waveOverride` — ou « En attente » 💡) :

- titre (libellé sans la discipline quand le groupe la donne déjà, ex. « Benjamins F · -35 kg ») et discipline · règlement
  en dessous (en classement par zone : le groupe « Karaté · Jiyu — Benjamins ») ;
- badges : zone (en classement par catégorie), nombre d'inscrits (+ absents), état (Provisoire / Prête / Lancée 🔒 /
  Terminée, couleurs de `STATUS_TONES`), « Sans adversaire », « n cas à traiter » (lien vers la Réaffectation), format
  imposé s'il y en a un ;
- **contenu réduit** : les combattants en **pastilles** (nom, club, badge **M** si placé à la main, badge de réaffectation
  comme aujourd'hui), dans l'ordre du tableau : par combat du premier tour (« COMBAT 1 », « EXEMPT »), en poule, ou
  « SANS ADVERSAIRE » ;
- **Agrandir / Réduire** : la carte prend toute la largeur et montre le **vrai tableau** (`BracketView`, arbre, poules,
  kata), dont les combattants se glissent aussi ; une carte agrandie a un bouton **Nouveau tirage** (si non lancée).
- **Catégorie lancée ou terminée** (ou session lancée, `launchLocked`) : carte grisée, pastilles non déplaçables, dépôt
  refusé (« Catégorie lancée : déverrouillez-la d'abord »).
- les absents ne sont pas des pastilles (ils restent comptés dans le badge) 💡.

### 2.6 Glisser-déposer ✅ (maquette)

| On dépose une pastille… | Effet | Confirmation |
|---|---|---|
| sur un autre combattant **du même tableau** | les deux **échangent leur place** (existant : `swapEntrants`) | aucune, tout de suite (comme aujourd'hui) ; message « Annuler » |
| sur un combattant **d'une autre catégorie** | **échange** : chacun prend **la place exacte** de l'autre ; les autres ne bougent pas | fenêtre « Échanger deux combattants » |
| sur une **carte** d'une autre catégorie (hors pastille) | **déplacement manuel** (existant : `manualMove`, type `M`) ; il prend une place libre du tableau d'arrivée | fenêtre « Déplacement manuel » |
| sur sa propre carte, ou sur lui-même | rien | — |
| sur une carte lancée | refusé, la carte le montre pendant le survol | — |

- Pendant le glisser, la cible est surlignée (pastille : contour pointillé ; carte : bordure + « Déposer ici : déplacer
  dans cette catégorie »).
- **Fenêtre de confirmation** (déplacement et échange) : pour chaque combattant « De … ➜ Vers … » ; **Règles enfreintes**
  en orange (mêmes avertissements que `moveTargetsFor` aujourd'hui) ; **changement de session** en bleu (comme
  `WaveChangeWarning`) ; l'aperçu de la réaffectation (`ProposalPreview`) comme dans `MoveEntrantPanel` 💡 ;
  « Annuler » / « Confirmer le déplacement » ou « Confirmer l'échange ».
- ✅ **Les places sont gardées** pour tout ce qui est fait **à la main** — déplacement et échange, depuis la planche comme
  depuis « Déplacer vers… » (Liste, Réaffectation) : dans les deux tableaux, les autres combattants ne bougent pas, le
  partant laisse une place libre, l'arrivant prend une place libre (en évitant son club si une place le permet 💡). Les deux
  tableaux deviennent « arrangés » (`categories.arranged`, `keepPlaces`) jusqu'au prochain « Nouveau tirage ». Le **plan**
  et les **réaffectations validées** depuis les cartes de la Réaffectation refont le tirage, comme aujourd'hui ✅.
- Un **échange entre catégories** est **une seule action** (atomique, une seule ligne d'historique) ; les deux combattants
  deviennent « placés à la main » (`placementLocked`, type `M`) comme un déplacement manuel.
- Si l'action met **deux combattants du même club face à face** (§2.7), la fenêtre l'écrit en orange (« BERNARD Léa et
  DUBOIS Lucas (Tani Dojo) se rencontrent au 1er tour. ») ; pour un échange de places dans un tableau (sans fenêtre), le
  message de 5 s le dit. Ça n'empêche rien.
- Après chaque action : un message en bas « … » avec **Annuler** pendant 5 secondes (annule cette action, §3.4).
- **Écran tactile / téléphone** : clic sur une pastille (elle est choisie, un bandeau dit « X choisi(e) : cliquez sur un
  autre combattant pour échanger, ou sur une catégorie pour l'y déplacer », Échap ou re-clic pour annuler), puis clic sur
  la destination ; mêmes effets. Ce mode marche aussi à la souris.
- **Poste Zone** : planche en lecture seule (pas de glisser, pas de choix), comme la Liste aujourd'hui.

### 2.7 Même club face à face ✅

Parfois voulu (on ne peut pas faire autrement), parfois une erreur : il faut **s'en rendre compte**, sans être bloqué.

- **Ce qui compte** 💡 : deux combattants du même club qui se rencontrent dans un **combat du premier tour** d'un tableau
  à élimination (directe ou double, y compris repêchage s'il est joué d'office au premier tour). Pas en poule (tout le
  monde s'y rencontre), pas en kata, pas au-delà du premier tour (on ne sait pas qui gagnera).
- **Où ça se voit** :
  - sur les deux **pastilles** de la planche et dans le **tableau** (`BracketView`, planche agrandie, Liste et Combats à
    l'écran, pas à l'impression 💡) : le nom du club en **surbrillance orange** ;
  - sur la **carte** : badge orange « Même club » (avec le club au survol) ;
  - dans la **fenêtre de confirmation** et le **message de 5 s** (§2.6).
- Pas d'acquittement à donner, pas de blocage ; « Seulement à traiter » ne les ajoute pas 💡.

## 3. L'historique

### 3.1 Ce qui est enregistré ✅ « tout, depuis n'importe quelle page »

Toute action qui change **qui est dans quel tableau** ou **le tableau lui-même**, quelle que soit la page :

| Type (étiquette) | Actions |
|---|---|
| **Plan** | « Appliquer le plan » : **un bloc** avec ses déplacements |
| **Réaffectation** | une proposition validée à l'unité depuis une carte de la Réaffectation |
| **À la main** | déplacement manuel (planche, Liste via « Déplacer vers… », Réaffectation) |
| **Échange** | échange de deux combattants entre deux catégories (planche) |
| **Ne combat pas** | « Ne combat pas » (déjà journalisé aujourd'hui) |
| **Places** | échange de places dans un même tableau (planche ou Liste) |
| **Tirage** | « Nouveau tirage » (planche ou Liste) |
| **Format** | changement de format, de repêchage ou de combat pour la 3e place (Liste) |
| **Tableau libre** | changement de la discipline ou du règlement d'un tableau libre (onglet Catégories) 💡 |

💡 **Pas enregistré** : « Marquer prête » / « Repasser en provisoire » (réversibles par le même bouton, ne changent pas le
tableau), « Déverrouiller », « Régénérer » d'une session lancée, les saisies de résultats, et ce qui vient d'ailleurs que
ces écrans (pesée, modification d'une inscription, présences, import) — ces changements-là restent hors historique.

Chaque ligne garde : l'heure, le type, le ou les combattants, « de ➜ vers » (libellés au moment de l'action), la raison
(comme aujourd'hui pour les réaffectations), la session d'où l'action a été faite (pour « Repartir de zéro » par session),
l'état (en place / annulée + heure d'annulation), et **de quoi remettre exactement l'état d'avant** (§3.4).

### 3.2 Où le voir

- **Planche** : panneau **Historique** qui s'ouvre à droite (la planche se resserre sur un écran large ; par-dessus sur un
  écran étroit ; plein écran sur téléphone) 💡.
- **Liste** (vue actuelle des tableaux) : même panneau, ouvert par le même bouton 💡.
- **Réaffectation** : la section « Réaffectations validées » est **remplacée** par cet historique (même contenu, mêmes
  boutons), en gardant « Repartir de zéro » à sa place 💡.

Le panneau suit la **session choisie** comme les autres listes (« Toutes » : tout) 💡, et se met à jour en direct quand un
autre poste agit (SSE existant).

### 3.3 Affichage (maquette v4)

- Du plus récent au plus ancien. Filtres : **Tout / Plan / À la main / Tableaux** (« Plan » = Plan + Réaffectation ;
  « À la main » = À la main + Échange + Ne combat pas ; « Tableaux » = Places + Tirage + Format) 💡.
- Une ligne : heure, étiquette de type, ce qui a changé en gras (« PETIT Inès ↔ MOREAU Jade », « Nouveau tirage »,
  « Format changé »), le détail (« Cadets F · -50 kg ➜ Cadets F · -54 kg », « Benjamins F · -35 kg : places échangées
  dans le tableau », « Kata · Benjamins F : Automatique ➜ Tour 1 puis finale à deux »), la raison en petit.
- Le **plan** : un bloc « Plan d'ensemble appliqué · n déplacements » avec ses lignes dedans, et **Annuler tout le plan…**.
- **Voir** : fait défiler la planche jusqu'aux cartes concernées et les entoure ~2 s (passe la session sur « Toutes » si
  elles n'y sont pas ; sur la Liste ou la Réaffectation : ouvre la planche 💡).
- **Annuler…** sur chaque ligne encore en place ; une ligne annulée reste, barrée et grisée, avec « Annulée à hh:mm ».
- Impossible à annuler : bouton grisé et la raison écrite (« Cadets M · -63 kg est lancée : déverrouillez-la pour
  annuler. ») ; sur le bloc du plan : « n ne peut pas être annulé (catégorie lancée) ».

### 3.4 Annuler ✅ en cascade

- **Effet** : remettre les catégories touchées **exactement comme avant l'action** : mêmes inscrits, mêmes places, même
  format ; un combattant déplacé retrouve sa catégorie et ses valeurs d'avant (comme `undoRecasement` aujourd'hui), un
  échange remet chacun à sa place, un tirage ou un échange de places remet le tableau d'avant, un format revient à sa
  valeur d'avant. Les tableaux concernés sont à réimprimer s'ils l'étaient (le texte le rappelle).
- ✅ **Cascade** : si des actions **plus récentes, encore en place, touchent les mêmes catégories** (de proche en proche :
  ce qu'elles touchent compte aussi), elles sont **annulées aussi, en premier** (de la plus récente à la plus ancienne).
  « Toucher » une catégorie = l'avoir changée (catégorie de départ ou d'arrivée, tableau refait, format) 💡.
  Cela remplace le blocage actuel « Annulez d'abord la réaffectation plus récente de ce combattant ».
- **Blocage** : si l'action ou une action de sa cascade touche une catégorie **lancée/terminée** ou une **session lancée**,
  rien n'est annulé (même règle qu'aujourd'hui), avec la raison. Pour « Annuler tout le plan », les déplacements bloqués
  (et leurs cascades) restent en place, les autres sont annulés, et la fenêtre dit ce qui reste.
- **Changement fait hors historique** (§3.1) depuis l'action : 💡 un déplacement s'annule comme aujourd'hui (d'après
  l'inscription) ; un échange de places ou un tirage dont le tableau n'a plus la même composition (pesée, absence…)
  **ne peut pas** être annulé : bouton grisé, raison « Le tableau a changé depuis (inscrits différents) : refaites le tirage
  ou échangez à la main. » ; un format s'annule toujours.
- **Une annulation n'est pas elle-même une ligne** : la ligne d'origine passe à « annulée » ; pas de « Rétablir » ✅
  (non demandé).
- Le message **Annuler** de 5 s après une action annule cette action seule (elle est la plus récente, donc sans cascade
  dans le cas normal ; si un autre poste a agi entre-temps sur les mêmes tableaux, la fenêtre de confirmation s'ouvre
  comme depuis l'historique).

### 3.5 Mise en évidence de la cascade ✅

1. **Au survol** de « Annuler… » / « Annuler tout le plan… » (ou focus clavier) : l'action choisie a un bord rouge et
   l'étiquette « Sera annulée » ; celles de la cascade sont surlignées en orange avec « Sera annulée aussi » ; sur la
   planche, les cartes concernées sont entourées en orange.
2. **Sous le bouton, toujours visible** : « Annule aussi : 09:52 · BLANC Zoé ↔ GUERIN Emma (places), … » (la ligne liée
   peut être hors écran, et le survol n'existe pas au doigt).
3. **Fenêtre « Annuler cette action ? » / « Annuler tout le plan d'ensemble ? »** : les actions dans l'ordre où elles
   seront annulées, chacune avec ce qui revient (« GUERIN Emma retourne en Minimes F · -38 kg. »), étiquetée
   « demandée » (rouge) ou « annulée aussi » (fond orange) ; une phrase explique la cascade ; « Reste en place : … » pour ce
   qui est bloqué ; un changement de session au retour est signalé ; boutons « Garder » / « Annuler ces n actions ».
   Pendant que la fenêtre est ouverte, la mise en évidence reste dans le panneau et sur la planche.

### 3.6 Supprimer un tableau libre 💡

Supprimer un tableau libre (onglet Catégories) renvoie ses combattants d'où ils viennent : c'est **l'annulation, en
cascade, des actions qui les y ont mis**, avec la même fenêtre de confirmation et la même mise en évidence (§3.5) ; ces
lignes passent à « annulée ». Un combattant arrivé par un **échange** fait revenir aussi l'autre combattant de l'échange
(l'échange est une seule action), et la fenêtre le montre. Si une de ces annulations est bloquée (catégorie lancée), la
suppression est refusée avec la raison. La suppression elle-même n'est pas une ligne d'historique.

### 3.7 « Repartir de zéro »

Garde son rôle actuel (réaffectations, déplacements manuels, refus, cartes de côté de la session choisie, historique de ces
actions effacé). 💡 Les lignes **Places / Tirage / Format** ne sont pas annulées par « Repartir de zéro » et restent dans
l'historique ; s'il les rend impossibles à annuler (composition changée), elles le disent (§3.4). Les échanges entre
catégories sont annulés avec les déplacements manuels.

## 4. Contraintes

- **Échéance** : la compétition est le **22/11/2026** ; l'appli actuelle doit rester utilisable à tout moment sur `main`.
- **Postes et rôles** : chaque action et chaque annulation demande les mêmes droits que l'action d'origine aujourd'hui
  (`src/server/auth/permissions.ts`) ; la Table centrale garde ce qu'elle peut faire aujourd'hui, pas plus 💡. Poste Zone :
  lecture seule.
- **Plusieurs postes** : versions de lignes (If-Match / 409) et SSE existants ; une annulation calculée sur un état
  périmé est refusée proprement (« Un autre poste a modifié ces tableaux : la liste est mise à jour »), jamais appliquée à
  moitié. Toute annulation est **tout ou rien** (une transaction).
- **Données** : le nouvel historique est une donnée de la compétition : inclus dans les sauvegardes, le paquet de
  synchronisation (`src/server/sync/package.ts`, avec ses contrôles de références), la purge RGPD avec la compétition, et
  le mode « main ailleurs » (lecture seule). Une migration (0033) ; les lignes de `recasements` existantes restent lisibles
  dans le nouvel historique.
- **Interface** : composants partagés (`src/web/components/ui/`), jetons `--sk-*` (thèmes clair et sombre), lisible à
  360 px de large sans débordement (`clipped()` des e2e), textes en français comme le reste.
- **Nombre** : une compétition réelle ≈ 80–150 inscrits, ≈ 30–60 catégories ; la planche doit rester fluide à 150 inscrits.

## 5. Non-objectifs

- Déposer un combattant **entre** deux places d'un tableau d'une autre catégorie (insertion à une place précise) : on le
  dépose sur la carte, puis on l'échange dans le tableau.
- Rétablir une action annulée (« Refaire »).
- Historique des pesées, inscriptions, présences, résultats, zones et sessions.
- Changer le format ou les options depuis la planche (ils restent dans la Liste).
- Classement par ordre de passage.

## 6. Laissé au constructeur

- Le stockage de l'historique (nouvelle table ou extension de `recasements`), le contenu exact de « l'état d'avant »
  (tableau, inscriptions, clés de catégories, places arrangées `categories.arranged` / `keepPlaces`), et le calcul des
  catégories touchées — tant que §3.4 est tenu, y compris quand une catégorie a disparu ou s'est reformée entre-temps.
- La bibliothèque de glisser-déposer (ou l'API HTML native), tant que la souris et le mode clic-clic marchent.
- Le découpage en étapes et l'ordre de livraison (l'historique peut précéder la planche).
- Les identifiants de test (`data-testid`) et la répartition des tests (unitaires pour la cascade et la restauration,
  e2e pour le glisser, l'échange, l'annulation en cascade et sa mise en évidence).

## 7. Choix du concepteur à vérifier (💡)

1. Planche par défaut, Liste gardée pour les réglages et l'impression (§2.1).
2. Groupes « discipline · règlement · tranche » ; regroupements de tranches dans leur première tranche (§2.3).
3. Le bac montre aussi les combattants seuls des catégories en attente (§2.4).
4. Pas d'historique pour « Marquer prête », « Déverrouiller », « Régénérer », ni pour la pesée et les inscriptions (§3.1).
5. Le panneau d'historique dans la planche, dans la Liste, et à la place de « Réaffectations validées » (§3.2).
6. Filtres Tout / Plan / À la main / Tableaux (§3.3).
7. Échange de places ou tirage non annulable si la composition du tableau a changé hors historique (§3.4).
8. « Repartir de zéro » ne touche pas aux places, tirages et formats (§3.7).
9. Un tableau libre a toujours sa carte, même vide (§2.5) ; changer sa discipline ou son règlement est dans l'historique
   (§3.1) ; le supprimer passe par l'annulation en cascade de ce qui y a mis ses combattants (§3.6).
10. L'arrivant d'un déplacement manuel prend une place libre en évitant son club si possible (§2.6).
11. « Même club » : seulement les combats du premier tour à élimination ; surbrillance à l'écran, pas à l'impression ; ni
    blocage, ni acquittement, pas dans « Seulement à traiter » (§2.7).
