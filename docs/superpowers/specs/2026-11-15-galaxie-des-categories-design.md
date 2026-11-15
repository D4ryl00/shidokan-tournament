# Galaxie des catégories — conception

Date : 2026-11-15. Suite de la planche (`2026-11-07-planche-et-historique-design.md`) et du plan d'ensemble de la
réaffectation (`2026-10-25-plan-d-ensemble-reaffectation-design.md`, ordre des règles).
✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant).

Maquette validée par l'utilisateur (« c'est bien ») : `.superpowers/brainstorm/63519-1794775947/content/galaxie-v14.html`
(fichier local, git-ignoré ; s'ouvre directement dans un navigateur ; vue **D · Nuage à plat**). Elle fait foi pour le
comportement (zoom, rapprochement des voisines, couleurs) et les textes, pas pour le code ; ses données sont inventées et
ses voisinages simplifiés. Les vues A, B et C de la maquette ont été écartées.

## 1. Pourquoi

✅ Dans l'onglet Tableaux, quand un combattant est seul (par exemple « Karaté · Jiyu — Cadets F · -54 kg »), on ne voit
pas facilement **comment sont les catégories proches** : la même en Shido-mix-martial, le poids au-dessus, la tranche
d'âge voisine… La planche range les catégories par groupe (discipline · règlement · tranche), donc deux catégories
voisines pour la réaffectation peuvent être très loin l'une de l'autre à l'écran.

✅ L'utilisateur veut une **galaxie** (inspiration : une vidéo de site web où une galaxie de points nommés s'agrandit en
zoomant) : chaque catégorie est une étoile, reliée à ses catégories voisines, et **plus on s'éloigne en âge, en poids ou
en discipline, plus les catégories sont éloignées**. De loin, de petits points avec leurs noms ; plus on zoome, plus ça
grossit et devient lisible.

**Réussi si**, à la table centrale :

- on trouve d'un coup d'œil les catégories à un seul combattant et ce qu'il y a autour d'elles ;
- un clic sur l'une montre ses voisines en cartes lisibles, avec leurs combattants, sur un seul écran ;
- on déplace un combattant vers une voisine par glisser-déposer, exactement comme dans la planche (confirmation,
  historique, « Annuler ») ;
- une catégorie garde toujours la même place dans la galaxie, d'un poste à l'autre et pendant toute la journée.

**Échec même si « ça marche » :** une galaxie illisible (traits partout, noms qui se chevauchent, cartes empilées une
fois rapprochées) ; un lien affiché entre deux catégories que les règles de la compétition interdisent de relier, ou un
lien manquant entre deux catégories qu'elles relient ; une catégorie qui change de place parce qu'une autre s'est vidée ;
un déplacement fait depuis la galaxie qui ne passe pas par le même chemin que la planche (pas d'historique, pas
d'« Annuler », dépôt accepté sur une catégorie lancée) ; une page qui rame sur le PC du jour J.

**Non-objectifs :** la galaxie ne remplace ni la planche ni la Réaffectation ; elle ne propose pas de déplacements (c'est
le rôle du plan d'ensemble) ; pas de 3D.

## 2. Place dans l'appli

✅ Une **troisième vue de l'onglet Tableaux** : le sélecteur « Planche / Liste » devient « Planche / Liste / Galaxie »
(`BracketsPage`, `View`, clé locale `tableaux-vue` : la vue choisie reste retenue par poste).

✅ **Lien depuis la Réaffectation** : chaque carte de cas (« ② Cas un par un ») porte un lien « Voir dans la galaxie »
qui ouvre `…/tableaux?vue=galaxie&categorie=<id de la catégorie actuelle du combattant>` : la galaxie s'ouvre et
sélectionne cette catégorie (§4.3). 💡 Si la catégorie n'est pas dans la session affichée, la portée passe à « Toutes »
(même règle que « Voir » de l'historique). Un cas sans catégorie (`categoryId` nul) n'a pas ce lien. 💡

Inversement, chaque carte de la galaxie a « Voir dans la planche » (ouvre la vue Planche sur cette carte, comme « Voir »
de l'historique) et la carte sélectionnée a « Réaffectation ↗ » si elle a des cas à traiter (le badge « n cas à
traiter » de `CategoryCard` le fait déjà). 💡

## 3. Ce qu'on voit

### 3.1 Barre d'outils

💡 Reprend celle de la planche : **session** (chaque session, « En attente (n) », « Toutes » — `useSelectedWave`),
**recherche** « Chercher une catégorie ou un combattant » (mêmes règles que la planche : tous les mots, sans accents ni
casse ; les étoiles trouvées gardent leur nom affiché, les autres pâlissent ; une seule trouvée = on y va),
**Seulement les seuls** (💡 pâlit les autres étoiles sans les cacher — ce sont les cibles — et cadre la vue sur les
catégories à un seul combattant), **Tous les liens** (désactivé par défaut), **Historique (n)**. La légende (§3.4) est en bas à
droite.

### 3.2 Les étoiles

- ✅ Une étoile par catégorie de la portée choisie (les mêmes que la planche affiche, tableaux libres compris).
- 💡 Couleur de l'étoile = la discipline (une teinte par discipline · règlement, comme la maquette) ; taille selon le
  nombre d'inscrits présents.
- ✅ Catégorie à un seul combattant présent (`activeEntrantCount === 1`, la même que « Sans adversaire » de la
  planche) : **anneau blanc qui pulse** et nom en gras. Le rouge est réservé aux liens éloignés (§3.3).
- ✅ Le nom est écrit à côté de l'étoile ; de loin, seuls les noms qui ne se chevauchent pas sont écrits (les catégories
  à un seul combattant en priorité), puis tous à mesure qu'on zoome. 💡 Libellé « Discipline · Tranche Sexe · Poids »
  (« Karaté J · Cadets F · -54 kg »), comme la maquette.
- ✅ En zoomant, l'étoile devient une **carte** (titre, discipline, nombre d'inscrits), puis une carte avec les noms des
  combattants. Les cartes ne se chevauchent jamais à leur place (le placement les écarte, §5.2).
- 💡 Le fond est un ciel sombre étoilé dans les deux thèmes (clair et sombre) : c'est l'identité de la vue. Les cartes
  posées dessus gardent le thème de l'appli.
- 💡 Une catégorie lancée ou terminée reste affichée, plus pâle ; sa carte est verrouillée comme dans la planche.

### 3.3 Les liens

✅ Deux catégories sont reliées quand **une règle de réaffectation active de la compétition** permet de passer de l'une
à l'autre (détail en §5.1). Un lien n'existe pas si la règle est désactivée.

✅ **Couleur selon l'ordre des règles de la compétition** (`settings.replacementRules.order`) : la première règle
active est verte, puis vert-jaune, jaune, orange, et la dernière avant la ligne de coupure est rouge (dégradé continu
réparti sur les règles actives jusqu'à `cutAfter`). « Le vert fait positif, plus c'est éloigné plus c'est rouge. » Un
lien qui demande plusieurs règles (ex. tranche au-dessus + mélange mineurs / adultes) prend la couleur de **la plus
basse dans la liste**. 💡 Un lien qui ne passe que par des règles au-delà de la coupure est rouge et **en pointillés**.

✅ Les liens n'apparaissent qu'au survol d'une étoile ou pour l'étoile sélectionnée (et ses voisines), sauf si « Tous les
liens » est coché (alors tous, très légers). Survoler une étoile met en avant ses voisines et pâlit le reste.

### 3.4 Légende

💡 En bas à droite : les teintes des disciplines, l'anneau « un seul combattant », et **la liste des règles actives dans
leur ordre, chacune avec sa couleur de lien** (au lieu du simple dégradé de la maquette : l'ordre change d'une
compétition à l'autre, il faut pouvoir lire quelle couleur est quelle règle). Elle s'efface quand une catégorie est
rapprochée (§4.2), comme dans la maquette.

## 4. Ce qu'on fait

### 4.1 Se déplacer

- Molette (ou pincement au doigt) = zoom autour du pointeur ; glisser le fond = déplacer. 💡 Au doigt : un doigt
  déplace, deux doigts zooment.
- ✅ **Zoom maximal = celui des cartes rapprochées** (§4.2) : on ne peut pas zoomer plus loin.
- À l'ouverture, la vue cadre toutes les étoiles de la portée. 💡 Changer de session recadre.

### 4.2 Sélectionner une catégorie : les voisines se rapprochent

✅ Clic sur une étoile :

1. **On zoome dessus, en restant dans la galaxie**, avec une animation un peu lente qui donne l'effet de plongée (≈ 1,1
   à 1,8 s selon la distance, accélération puis ralentissement, zoom progressif) ; on arrive au zoom maximal.
2. Pendant ce zoom, **ses voisines viennent se ranger autour d'elle en cartes**, sur un seul écran : la catégorie au
   centre, les voisines dans des cases autour (gauche, droite, dessus, dessous, puis les coins, puis une colonne de plus
   de chaque côté s'il y en a plus de 8). ✅ Les voisines reliées par les règles les plus hautes dans la liste prennent
   les cases les plus proches. Chaque lien garde sa couleur et porte le nom de sa règle.
3. Les catégories **non liées restent à leur place**, plus pâles mais avec leur nom.

✅ **Dézoomer** fait rapetisser les voisines et les renvoie progressivement à leur place d'origine, ce qui laisse voir les
catégories non liées autour de la sélection. Rezoomer les rapproche à nouveau. Le rapprochement dépend donc du seul
niveau de zoom (nul en vue d'ensemble, complet au zoom maximal), pas d'un mode à part.

- Clic sur le titre d'une voisine : elle devient la sélection (on navigue de proche en proche).
- Clic dans le vide ou Échap : plus de sélection.
- ✅ **Voisines hors de la session affichée** (autre session, « En attente ») : quand une catégorie est sélectionnée, ses
  voisines apparaissent **quelle que soit leur session**, à leur place, se rapprochent en cartes comme les autres et
  acceptent un dépôt ; elles portent un badge de session (« Session 2 », « En attente »). La confirmation du dépôt dit le
  changement de session (`DropConfirmDialog` le fait déjà). Sans sélection, la galaxie ne montre que la portée choisie.
- 💡 Une catégorie a rarement plus de 14 voisines ; au-delà, les 14 premières (dans l'ordre des règles) sont rapprochées,
  les autres restent à leur place, reliées.
- Accepté par l'utilisateur dans la maquette : pendant le dézoom, les cartes en chemin peuvent se chevaucher un instant.

### 4.3 Déplacer un combattant

✅ Les cartes rapprochées sont **les cartes de la planche** (`CategoryCard`), avec ses pastilles et son glisser-déposer
(`useDragMove`) : glisser une pastille sur une autre carte = déplacement ; sur une pastille d'une autre carte = échange ;
dans la même carte = échange de places ; et le clic-clic (choisir une pastille, puis la cible) marche aussi, au doigt
comme à la souris. Même confirmation (`DropConfirmDialog`), même historique, même message « Annuler »
(`useUndoToast`), mêmes refus (catégorie lancée, poste de Zone en lecture seule).

💡 Après un déplacement, la galaxie se met à jour (les étoiles se vident, se remplissent, perdent ou gagnent l'anneau)
sans que les places changent (§5.2), et la sélection reste sur la même catégorie. Exception assumée : un dépôt qui
**élargit la clé** d'une catégorie (regroupement de tranches ou de poids, catégorie qui devient mixte) la déplace au
milieu de ses nouvelles cases (§5.2) ; la caméra la suit en douceur. On ne fige pas les places par identifiant de
catégorie (il faudrait partager cet état entre postes).

💡 Seules la catégorie sélectionnée et ses voisines rapprochées sont de vraies cartes `CategoryCard` (où l'on dépose).
Les autres catégories, même dessinées en cartes au zoom maximal, sont des dessins du canevas : on les regarde, on clique
dessus pour les sélectionner, on n'y dépose rien.

💡 Les cartes rapprochées sont compactes : au plus 4 combattants listés puis « + n autres » ; « Agrandir » (tableau) de
la planche n'y est pas, « Voir dans la planche » sert à ça.

## 5. Le calcul

### 5.1 Les voisinages (domaine, pur)

Une fonction pure dans `src/domain/` (💡 `src/domain/galaxy/`) donne, pour une liste de clés de catégories, la grille et
les réglages de la compétition, la liste des liens `{ a, b, rules: RuleId[] }`. Elle suit les règles telles que le
moteur de réaffectation les applique (`src/domain/replacement/propose.ts` : `evaluate`, `ageCompatibility` ;
`src/domain/ages.ts` : `ageMove` ; `src/domain/weights.ts` : `neighborWeightClasses`), au niveau des catégories et non
d'un combattant :

| Règle (`RuleId`) | Deux catégories sont reliées si… |
|---|---|
| `weight` | même discipline, règlement, sexe et tranche ; classes de poids voisines dans la grille (`neighborWeightClasses`) |
| `ageUp` / `ageDown` | même discipline, règlement et sexe ; tranches reliées par un lien `C` de la grille (`ageLinks`), dans un sens ou dans l'autre ; poids le plus proche (en kg) de l'autre tranche |
| `seniorsVeterans` | comme ci-dessus avec un lien `D` (seniors ↔ vétérans) |
| `minorsAdults` | s'ajoute aux règles d'âge quand le lien traverse mineurs / adultes (`crossesMinorAdult`) |
| `discipline` | même sexe, tranche et poids le plus proche ; deux disciplines « dans les préférences » (`DISCIPLINES[x].inPreferences` : pas le kata) |
| `shobuToJiyu` | même discipline, sexe, tranche et poids ; shobu ↔ jiyu |
| `mixSexes` | même discipline, règlement et tranche, sexes différents, tranche cochée dans `mixSexes.ageBandCodes` ; poids le plus proche |

- Une règle désactivée (`isRuleOn` faux) ne crée aucun lien ; ses interrupteurs propres (`mixMinorsAdults`,
  `mixSeniorsVeterans`, `mixSexes.enabled`, `shobuToJiyu`) comptent comme dans le moteur.
- `return`, `split` et `weightGap` ne relient pas deux catégories (ils parlent d'un combattant ou d'un écart de poids
  dans une catégorie) : pas de lien. 💡
- Une règle mineurs/kata du moteur s'applique aussi : pas de lien vers une catégorie shobu pour une tranche mineure. 💡
- Rang d'un lien = rang de sa règle **la plus loin dans la liste** (la plus coûteuse, l'indice le plus grand, comme le
  coût d'un déplacement dans le moteur) dans `replacementRules.order` (`ruleRank`, sans le cas particulier « accepte le
  jiyu en priorité », qui dépend d'un combattant). Au-delà de `cutAfter` : pointillés.
- 💡 **Sens.** Certaines règles ont un sens : entre deux tranches, c'est `ageUp` vu de la plus jeune et `ageDown` vu de
  la plus âgée ; `shobuToJiyu` ne va que du shobu vers le jiyu. Un lien est donc calculé **vu de chaque côté** :
  `{ a, b, rulesFromA, rulesFromB }` (règles pour aller de a vers b, et de b vers a ; vide si ce sens est interdit). Le
  lien existe si au moins un sens est possible. Il est coloré **vu de l'étoile survolée ou sélectionnée** (« ce que
  coûte d'aller d'ici à là ») ; si ce sens est interdit (jiyu → shobu), on prend l'autre sens (quelqu'un de là-bas peut
  venir ici). Avec « Tous les liens » et sans sélection, le meilleur des deux sens. Désactiver `ageDown` laisse le lien
  entre deux tranches (via `ageUp` vu de la plus jeune).
- Catégorie regroupée (plusieurs tranches ou plusieurs poids) : reliée si l'une de ses cases l'est. Tableau libre : aucun
  lien. 💡
- Ce sont des voisinages **de principe** : « autre discipline » ne dit pas si ce combattant-là l'a dans ses
  préférences, et l'écart de poids réel n'est pas vérifié. La confirmation du déplacement (§4.3) montre, comme dans la
  planche, les règles enfreintes. 💡 À dire dans l'aide de la vue.

### 5.2 Les places (domaine, pur et déterministe)

✅ **Places fixes** : le placement est calculé sur **toutes les catégories possibles de la grille** (chaque discipline ×
règlement × sexe × tranche × classe de poids ; le kata sans poids ; le shobu seulement pour les tranches adultes), pas
seulement sur celles qui ont des inscrits. On n'affiche que les catégories de la portée. Une catégorie garde donc sa
place quand d'autres apparaissent ou se vident, et la même place sur tous les postes.

💡 Le placement ne dépend que de la grille de la compétition, pas de l'ordre ni de l'activation des règles : les liens
qui servent à placer sont tous les voisinages possibles (§5.1 avec toutes les règles actives, comme `withAllRules`), et
leur longueur suit un ordre naturel fixe (poids voisin le plus court, puis âge, shobu ↔ jiyu, autre discipline,
filles / garçons le plus long — les longueurs relatives de la maquette : 1 ; 1,6 ; 2,2 ; 2,8 ; 3,2). Changer l'ordre des
règles change les **couleurs**, pas les **places**. Changer la grille (rare, avant la compétition) peut tout déplacer.

- Méthode (maquette) : ressorts sur les liens + répulsion entre étoiles, puis un écartement qui garantit qu'aucune carte
  ne chevauche une autre à sa place (rectangles : largeur de carte, hauteur selon le nombre de lignes). 💡 La hauteur
  réservée est celle d'une carte pleine (au plus 4 noms + « + n autres ») pour qu'aucune carte ne grandisse au point de
  chevaucher.
- Déterministe : même grille ⇒ mêmes places (graine fixe, ordre de parcours stable). Testé.
- Catégorie regroupée : au milieu de ses cases (barycentre) ; une catégorie mixte (sexe `X`) au milieu de ses cases F et
  M. Tableaux libres : un petit amas à part, à côté de la
  galaxie, rangés par nom. 💡 Si deux catégories réelles tombent au même endroit (regroupement), l'écartement s'applique
  aussi à elles.
- Coût : la grille FFK donne plusieurs centaines de catégories possibles. 💡 Le calcul ne doit pas bloquer l'écran plus
  d'environ 1 s sur le PC du jour J ; résultat gardé en mémoire tant que la grille ne change pas (et, au choix du
  constructeur, en stockage local ou dans un worker).

### 5.3 Le dessin (web)

✅ Approche choisie (sur trois : dessin maison ; d3-force pour le placement ; bibliothèque de graphes complète) :
**dessin maison**. Les étoiles, noms et liens sont dessinés dans un `<canvas>` ; les cartes rapprochées sont de vraies
`CategoryCard` React posées par-dessus et repositionnées à chaque image. Aucune dépendance ajoutée. d3-force n'apportait
pas l'écartement des cartes (le point délicat) ; une bibliothèque complète se serait battue avec le rapprochement des
voisines et les cartes React par-dessus, et pèse lourd au chargement.

## 6. Contraintes

- Écran du PC de la table centrale (≈ 1280 × 720 et plus). 💡 Au téléphone, la vue marche (déplacement, pincement,
  clic-clic) sans débordement horizontal de la page.
- Poste de Zone : la galaxie se regarde, rien ne se déplace (comme la planche).
- Mise à jour en direct comme les autres vues (les données de catégories et d'inscriptions déjà suivies par SSE).
- Textes en français, ton de l'appli ; aide en ligne (`Help`) pour la vue, qui dit ce que veulent dire les couleurs et
  que les liens sont « possibles en principe ».

## 7. Laissé au constructeur

- Le découpage du code (domaine `src/domain/galaxy/`, composant `src/web/components/galaxy/`), la caméra, le seuil où
  l'étoile devient carte, les animations exactes.
- La forme de la légende des règles et du libellé d'un lien rapproché.
- Les tests : unitaires sur les voisinages (chaque règle, désactivation, coupure, regroupements, tableaux libres) et sur
  les places (déterministes, aucun chevauchement de cartes, indépendantes des inscrits) ; e2e : choisir la vue Galaxie,
  sélectionner une catégorie (par la recherche ou le lien de la Réaffectation), voir ses voisines en cartes, déplacer un
  combattant au clic-clic, l'annuler. Le canevas n'étant pas lisible par Playwright, prévoir de quoi trouver une étoile
  (attributs de test ou liste cachée accessible).

## 8. Approches envisagées

1. **Dessin maison + vraies cartes de la planche par-dessus** — retenue ✅ (réutilise `CategoryCard`, `useDragMove`,
   `DropConfirmDialog` ; pas de dépendance ; déjà prouvée par la maquette ; on écrit soi-même zoom et déplacement).
2. **d3-force pour le placement**, dessin maison — dépendance pour peu de gain : l'écartement des cartes reste à écrire.
3. **Bibliothèque de graphes complète** (sigma.js, react-force-graph…) — zoom fourni, mais incompatible avec le
   rapprochement des voisines selon le zoom et les cartes React, et lourde.

Formes de galaxie essayées dans la maquette et écartées par l'utilisateur : A carte à plat par discipline (axes âge ×
poids), B étages en 3D, C nuage libre en 3D. Retenue ✅ : D nuage à plat sans axes.
