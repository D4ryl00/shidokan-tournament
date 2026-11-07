# Placements manuels : déplacer n'importe qui, tableaux libres, échanges gardés — conception

Date : 2026-11-06. Suite de la spec principale (`2026-10-21-tableaux-shidokan-design.md` §10 réaffectation et §11.2
génération des tableaux) et du plan d'ensemble (`2026-10-25-plan-d-ensemble-reaffectation-design.md`).
✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant).

## 1. Pourquoi

L'organisateur doit pouvoir **choisir lui-même qui combat contre qui** dans trois situations ✅ :

1. **Séparer deux combattants d'un même club** au premier tour, quand le tirage n'y arrive pas.
2. **Têtes de série** : écarter les meilleurs pour qu'ils ne se croisent qu'à la fin.
3. **Combats de gala** : des affiches décidées d'avance (A contre B), entre **n'importe quels combattants, même de catégories
   différentes**.

Aujourd'hui :

- L'**échange** de deux combattants dans un tableau existe (onglet Tableaux, clic sur deux inscrits,
  `swapEntrants` dans `src/server/repositories/categories.ts`), mais il est **perdu** dès que le tableau est refait
  (`syncCategories` régénère tout tableau non lancé dont la composition, le format ou les options changent).
- Le **déplacement manuel** existe (`manualMove`, type `M`), mais seulement depuis une carte de la page Réaffectation, donc
  seulement pour un combattant qui a un problème, et seulement vers une catégorie qui existe déjà.
- Un combattant déplacé à la main qui se retrouve **seul**, ou qui crée un **écart de poids**, redevient une carte avec des
  propositions, et le plan peut le redéplacer (`detectCases`, `src/domain/replacement/detect.ts`).

✅ L'utilisateur veut **rester simple** : l'**échange** (existant), le **déplacement** d'un combattant vers n'importe quelle
catégorie, et des **tableaux libres** préparés à l'avance pour les galas.

**Réussi si**, à la table centrale :

- on prépare « Gala 1 » à l'avance, puis on y met A et B, venus de catégories différentes, en deux déplacements ;
- un combattant placé à la main n'est jamais déplacé par la réaffectation automatique, même relancée plusieurs fois ;
- un combattant seul, placé à la main ou dans un tableau libre, est **signalé** (carte « Sans adversaire », compteur) ;
- on peut annuler un déplacement manuel ; le combattant redevient alors un combattant comme les autres ;
- les échanges faits dans un tableau survivent à l'arrivée ou au départ d'un combattant.

**Échec même si « ça marche » :** un « Appliquer le plan » qui sort un combattant placé à la main ou qui touche à un tableau
libre ; un tableau libre qui disparaît tout seul ; un combattant seul qu'on oublie parce qu'aucune alerte ne le montre ; un
tableau échangé qui, après l'arrivée d'un combattant, ne ressemble plus à ce que l'organisateur avait arrangé ; un combattant
inscrit dans une catégorie mais absent de son tableau.

**Hors sujet ✅ :** désigner des têtes de série (l'échange suffit) ; placer un combattant sur une case précise d'un tableau sans
échange (on déplace dans la catégorie, puis on échange) ; une liste « Placements manuels » sur la page Réaffectation ; créer
un tableau libre depuis « Déplacer vers… ».

**Contrainte :** la compétition a lieu le **2026-11-22**. La base de démo et la base réelle doivent migrer sans perte
(nouvelle migration après `0031`).

## 2. Déplacer n'importe quel combattant

### 2.1 Où

- 💡 **Onglet Tableaux** : quand un inscrit est sélectionné (premier clic, celui qui prépare aujourd'hui un échange), une
  ligne d'actions apparaît sous le tableau avec :
  - le texte actuel « Cliquez sur l'inscrit à échanger avec X » (l'échange reste le geste par défaut) ;
  - « **Déplacer vers…** » : les catégories cohérentes avec les réglages et **tous les tableaux libres** (sans avertissement,
    💡 regroupés sous « Tableaux libres »), puis « Toutes les catégories (règles enfreintes) » pour les autres ;
  - « **Annuler son déplacement manuel** » si son placement actuel vient d'un déplacement manuel (§2.4).
  Ça marche pour **tous les inscrits**, avec ou sans problème, dans tous les formats (combat et kata).
- **Page Réaffectation** : le « Déplacer manuellement vers… » des cartes reste, avec la même liste (tableaux libres compris).
- Même aperçu et mêmes avertissements qu'aujourd'hui avant de confirmer (`manualProposal`, règles enfreintes listées) ; aucun
  avertissement de règles vers un tableau libre.
- Mêmes refus qu'aujourd'hui : catégorie de départ ou d'arrivée lancée ou d'une session lancée, catégorie fermée.
- 💡 Mêmes droits que le déplacement manuel actuel (`src/server/auth/permissions.ts`) : Organisation et Table centrale, pas
  un poste Zone ; un poste en lecture seule (main ailleurs) ne voit pas ces actions.

### 2.2 La réaffectation automatique ne le déplace pas ✅

Un combattant dont le **placement actuel vient d'un déplacement manuel** (dernier déplacement validé de type `M`) :

- n'est **jamais déplacé** par le plan, ni pour lui-même ni pour un split ;
- n'a **pas de carte avec propositions** (écart de poids, poids hors catégorie, catégorie fermée, retour) ;
- ne déclenche pas de cas « écart de poids » pour les autres membres de sa catégorie 💡 (l'écart se mesure sans lui) ;
- ne compte pas dans les « restent seuls » du plan ni dans les barres de la liste des règles ;
- 💡 sa catégorie, si c'est une catégorie de la grille, **reste une cible** possible du plan pour d'autres combattants (le plan
  ne le déplace pas, il peut lui amener un adversaire).

💡 Comment le reconnaître : `placementLocked` et `recasementType === 'M'` (pas `original.reason`, qui garde la raison du
**premier** déplacement). Les déplacements manuels déjà faits sur la base réelle sont donc concernés aussi.

### 2.3 Alerte quand il est seul ✅

Un combattant **seul actif** dans sa catégorie, placé à la main (§2.2) **ou** dans un tableau libre (§3), a une **carte
d'alerte « Sans adversaire »** sur la page Réaffectation :

- texte : « Seul dans le tableau libre Gala 1 » ou « Placé à la main, seul dans sa catégorie » 💡 ;
- **aucune proposition**, et le plan ne la prend jamais en compte ;
- actions : « Déplacer manuellement vers… » (pour lui amener quelqu'un ou le mettre ailleurs) et, s'il a été placé à la main,
  « Annuler son déplacement manuel » 💡 ; « Mettre de côté » comme les autres cartes 💡 ;
- elle compte dans les compteurs **« Sans adversaire »** ✅, **« Cas à traiter »** et **« Sans solution automatique »** 💡.

Un tableau libre **vide** ne déclenche aucune alerte 💡 (il est préparé à l'avance).

### 2.4 Annuler un déplacement manuel ✅

- Pas de carte pour ça ✅. Depuis l'onglet Tableaux (« Annuler son déplacement manuel ») et, comme aujourd'hui, depuis
  l'**historique** de la page Réaffectation : c'est la même opération (`undoRecasement` de la ligne d'historique la plus
  récente de ce combattant).
- Le combattant revient là où il était **juste avant** ce déplacement (instantané existant). S'il y était lui-même placé à la
  main (deux déplacements manuels de suite), il reste placé à la main ; sinon il redevient **un combattant comme les autres**,
  et la prochaine réaffectation peut le déplacer si besoin ✅.
- Mêmes refus qu'aujourd'hui (catégorie lancée, session lancée, déplacement plus récent du même combattant à annuler d'abord).

### 2.5 « Repartir de zéro » ✅

« Repartir de zéro » **défait aussi les déplacements manuels**, comme aujourd'hui : c'est le seul moyen de revenir au moment
d'après la pesée, quand on n'a encore rien touché aux affectations. Les tableaux libres restent (vides). Mêmes exceptions
qu'aujourd'hui (session lancée, catégorie commencée). 💡 La fenêtre de confirmation compte à part les déplacements manuels
défaits (« dont 3 déplacements manuels »).

💡 Les échanges faits dans les tableaux ne sont pas des affectations : la remise à zéro ne les efface pas. Les tableaux dont
la composition change sont refaits en gardant les places (§4).

## 3. Tableaux libres ✅

### 3.1 Où on les gère

L'onglet « Grille âge / poids » est **renommé « Catégories »** ✅ et présente trois blocs l'un sous l'autre :

1. **Grille âge / poids** (l'existant) ;
2. **Catégories ouvertes** (le tableau existant) ;
3. **Tableaux libres** (nouveau) : la liste des tableaux libres (nom, discipline, règlement, session, nombre de combattants),
   un bouton « Ajouter un tableau libre », et pour chacun « Modifier » et « Supprimer ».

Les anciennes adresses de l'onglet restent valables (redirection), comme pour les renommages précédents 💡.

### 3.2 Ce qu'est un tableau libre

- Un **nom libre** ✅ : obligatoire, 💡 1 à 60 caractères, unique parmi les tableaux libres de la compétition (sans tenir
  compte de la casse). C'est son libellé partout (Tableaux, Combats, impressions, podiums, palmarès).
- Une **discipline** et un **règlement** ✅, choisis à la création : ils disent sur quelles zones il peut passer et si c'est un
  tableau de combat ou un ordre de passage de kata. ✅ Modifiables tant que le tableau n'est pas verrouillé (lancé, ou session
  lancée : il faut alors le déverrouiller, comme les autres tableaux). 💡 Ses combattants prennent la nouvelle discipline et le
  nouveau règlement (passage au kata : catégorie de poids retirée, comme un déplacement manuel), et le tableau est refait.
- Une **session** ✅ choisie par l'organisateur dans ce bloc ; tant qu'elle n'est pas choisie, il est « En attente » (dans
  aucune session). Elle ne se déduit jamais de ses combattants.
- **Pas lié à l'âge, au poids ni aux règles de réaffectation** ✅ : n'importe qui peut y être déplacé, sans avertissement.
  💡 Le combattant qu'on y déplace prend sa discipline et son règlement (comme un déplacement manuel aujourd'hui, `changes` de
  `manualProposal`) ; l'annulation les lui rend.
- **Créé à l'avance, il existe tant qu'on ne le supprime pas**, même vide ✅. Vide : pas de tableau, pas d'impression.
- 💡 Appartient à **une seule compétition** : il ne fait pas partie des modèles de grille.
- Le **format** se choisit dans l'onglet Tableaux comme pour les autres catégories ✅ (deux combattants : combat unique ;
  trois : poule ; etc.).
- Il suit les mêmes chemins que les autres catégories : zones, ordre de passage, figeage de session, combats, podiums,
  paquet de synchronisation, journal de zone, sauvegardes.

### 3.3 La réaffectation automatique n'y touche pas du tout ✅

- Ni source ni cible du plan, des propositions ou du split.
- Un inscrit n'y arrive **jamais** par sa catégorie naturelle : seulement par un déplacement manuel.
- Ses combattants y sont tous placés à la main : §2.2 et §2.3 s'appliquent (alerte s'il y en a un seul).

### 3.4 Supprimer ✅

« Supprimer » renvoie ses combattants **là où ils étaient juste avant d'y être placés** (annulation de leur déplacement
manuel, §2.4), puis supprime le tableau. Confirmation avant (« 2 combattants retourneront dans leur catégorie précédente »).
Refusé s'il a commencé ou si sa session est lancée 💡 (comme une annulation). 💡 Si l'annulation d'un de ses combattants est
impossible (déplacement plus récent ailleurs : impossible tant qu'il est dans le tableau), la suppression est refusée en entier.

### 3.5 Droits 💡

Créer, modifier, supprimer un tableau libre : Organisation et Table centrale (comme le déplacement manuel), en lecture
seule pour les autres postes.

## 4. Échanges gardés quand le tableau est refait ✅

### 4.1 Principe

✅ L'utilisateur a choisi « **garder les places** » plutôt que « ne plus refaire le tableau tout seul » : quand la composition
d'un tableau **où l'organisateur a fait au moins un échange** change (arrivée, départ, absence), le tableau est refait tout de
suite, en gardant chacun où il avait été mis. Le nouveau venu se glisse à la place libre la plus logique.

Ce qui compte pour l'organisateur, c'est **qui rencontre qui en premier** : les adversaires du premier tour en élimination
directe, les membres de chaque poule, l'ordre de passage en kata.

### 4.2 Comportement attendu

- **Tableau sans échange manuel** : inchangé, nouveau tirage comme aujourd'hui.
- **Départ** d'un combattant (ou absence) : sa place se libère.
  - Élimination : son adversaire du premier tour passe exempt ; si le tableau peut se réduire (8 ➜ 4 places), les paires du
    premier tour qui restent complètes restent ensemble.
  - Poule : il en sort ; les autres restent dans leur poule.
  - Kata : il sort de l'ordre de passage ; les autres gardent leur ordre.
- **Arrivée** d'un combattant :
  - Élimination, même nombre de places (ex. 5 ➜ 6 combattants sur 8 places) : il prend une exemption, en face d'un combattant
    qui était exempt, en évitant son propre club si possible ; les autres combats du premier tour sont gardés.
  - Élimination, tableau qui grandit (ex. 4 ➜ 5, donc 4 ➜ 8 places) : les paires du premier tour sont gardées autant que
    possible, le nouveau venu prend la place la plus logique (en évitant son club), les exemptions sont réparties comme le
    fait le tirage.
  - Poule : il va dans la plus petite poule, en évitant son club si possible.
  - Kata : il passe en dernier.
- **Changement de format** (par l'organisateur, ou format automatique qui change avec le nombre, ex. 2 ➜ 3 : combat unique ➜
  poule) : on garde ce qui a encore un sens (deux combattants qui se rencontraient au premier tour se rencontrent dans le
  premier combat) ; sinon on accepte la place donnée par le tirage.
- **« Nouveau tirage »** ✅ : efface les échanges (demande explicite de tout refaire) ; le tableau redevient « sans échange ».
- **Changement d'option** (repêchage, 3e place) : les places du premier tour ne bougent pas.
- La séparation des clubs ne **défait jamais un échange** ; elle ne joue que pour placer un nouveau venu.
- Tout tableau refait efface ses départages de poule, comme aujourd'hui.

Le mécanisme est laissé au constructeur. Piste : marquer la catégorie « arrangée à la main », puis, à la régénération, partir
des cases du premier tour (ou des poules, ou de l'ordre de kata) du tableau stocké au lieu du tirage.

### 4.3 Sessions figées et catégories lancées

Inchangé : un tableau d'une session figée ou d'une catégorie lancée ne se refait pas tout seul (badge « Inscrits modifiés »,
bouton « Régénérer (renuméroté à la suite) »). « Régénérer » sur un tableau échangé applique la même règle « garder les
places » 💡.

## 5. Aide et textes

- Onglet renommé « Catégories » : `src/web/tabs.ts`, titre et aide (`src/web/help.ts`, entrée de la grille), avec le bloc
  « Tableaux libres ».
- Aide de l'onglet Tableaux : déplacer un inscrit, annuler un déplacement manuel, « les échanges sont gardés quand le tableau
  est refait ; Nouveau tirage les efface ».
- Aide de la page Réaffectation : un combattant placé à la main n'est jamais déplacé par la réaffectation automatique ; s'il
  est seul, une carte d'alerte le signale ; « Repartir de zéro » défait aussi les déplacements manuels.
- 💡 Dans l'onglet Tableaux, un inscrit placé à la main porte une pastille « placé à la main ».

## 6. Mise à jour de la spec principale

Mettre à jour `2026-10-21-tableaux-shidokan-design.md` (§10 déplacement manuel, §11.2 « modifié à la main », §11.3
régénération) avec un renvoi vers ce document.

## 7. Tests et vérification

- Domaine : réaffectation qui ne déplace jamais un placement manuel (seul, écart, plan, split, liste des règles) et le
  signale par une carte d'alerte s'il est seul ; tableau libre jamais naturel ni cible ; régénération qui garde les places
  (départ, arrivée à taille égale et qui grandit, poule, kata, changement de format, « Nouveau tirage »).
- e2e : tableau libre créé dans l'onglet Catégories, deux combattants de catégories différentes déplacés dedans, réaffectation
  relancée sans y toucher, alerte quand il n'en reste qu'un, suppression qui les renvoie ; annulation d'un déplacement manuel ;
  échange gardé après l'arrivée d'un combattant.
- Vérification visuelle sur Chrome (extension Claude in Chrome) de chaque écran touché.
- Migration testée sur une copie de la base de démo.
