# Plan d'ensemble de la réaffectation — conception

**Date :** 2026-10-25 · **Complète :** `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` (§9 recasement, §10 tableau de bord), `docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md` (sessions) et `docs/superpowers/specs/2026-10-25-categories-fermees-et-cartes-de-cote-design.md` (cartes fermées, mises de côté).

Légende : ✅ demandé ou validé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

Vocabulaire : dans l'app, « réaffectation » (code : `replacement`), « session » (code : `wave`). Maquettes de la discussion : `.superpowers/brainstorm/17415-1792954094/content/` (`pyramide-v2.html`, `plan.html`), non versionnées.

---

## 1. Pourquoi

✅ Le but premier de l'app est de **trouver un adversaire à chaque combattant**. Aujourd'hui, on règle le problème **carte par carte** : chaque carte ne voit que son combattant, et l'organisateur doit deviner quelles actions sont les meilleures. Le bouton « Tout classer automatiquement » ne fait pas mieux : il prend les cartes **dans l'ordre alphabétique**, applique la meilleure proposition de chacune et ne revient jamais en arrière (`bulkPlan` / `nextBulkStep` dans `src/domain/replacement/apply.ts`). Le premier servi peut prendre la place qui aurait sauvé quelqu'un d'autre, ou faire monter l'écart de poids d'une catégorie et fermer la porte au suivant.

✅ On veut un calcul qui regarde **tous les cas en même temps**, **dans les règles établies**, et qui laisse **le moins possible de combattants seuls**. Les cartes une par une restent pour les cas particuliers.

**Réussi si :**
- l'organisateur voit d'un coup d'œil combien de combattants restent seuls selon les concessions qu'il accepte, et choisit jusqu'où il va ;
- l'app peut dire « dans ces règles, on ne peut pas faire mieux que N seuls », et c'est vrai ;
- le plan n'est jamais moins bon que l'ancien « Tout classer automatiquement » sur les mêmes données ;
- on peut tout relire et appliquer d'un coup, ou régler quelques déplacements (validation, refus, autre catégorie) et appliquer le reste d'un coup ; un déplacement « à valider » n'est jamais appliqué sans un clic sur « Valider ».

**Échec même si « ça marche » :**
- un plan qui utilise une règle désactivée ou placée sous la ligne de coupure ;
- un plan qui propose ce que les cartes interdisent (contraintes absolues de l'ancien §9.4) ;
- un recalcul qui défait un déplacement que l'organisateur avait validé à la main ;
- deux calculs sur les mêmes données qui donnent deux plans différents ;
- « on ne peut pas faire mieux » affiché alors que le calcul s'est arrêté avant la fin ;
- une règle rare (mélange filles/garçons, mineurs/adultes) activée par oubli dans une nouvelle compétition.

## 2. La liste des règles

### 2.1 Les règles ✅ / 💡
Une **règle** est une façon de trouver un adversaire. Chacune correspond à un ou plusieurs types de proposition existants (§9.3 du document principal). Liste et ordre par défaut 💡 :

| # | Règle | Types | Validation | Active par défaut |
|---|---|---|---|---|
| 1 | Retour dans la catégorie d'origine | R | sans | oui |
| 2 | Catégorie de poids voisine, écart ≤ réglage | A | sans | oui |
| 3 | « Split » de la catégorie du dessous (le ou les deux plus lourds), écart ≤ réglage | A tirés (`pullProposals`) | sans | oui |
| 4 | Catégorie de poids voisine, écart > réglage (y compris un split au-dessus du réglage) | B | à valider | oui |
| 5 | Tranche d'âge au-dessus | C | à valider | oui |
| 6 | **Tranche d'âge au-dessous** (nouvelle, §2.2) | C↓ | à valider | oui |
| 7 | Mélange seniors / vétérans | D | à valider | oui (comme aujourd'hui) |
| 8 | Autre discipline, selon les préférences du combattant | H | à valider | oui |
| 9 | Shobu → jiyu | G | à valider | non |
| 10 | Mélange filles / garçons (tranches choisies) | F | à valider | non |
| 11 | Mélange mineurs / adultes | E | à valider | non |

- ✅ L'écart de poids est **celui des paramètres actuels** (`weightGapMaxKg` enfants / adultes), pas une valeur propre à la liste.
- ✅ **Deux sortes de déplacements seulement** (cela remplace l'idée d'« accord coach » des maquettes) :
  - **sans validation** : le combattant ne change **que de catégorie de poids** (même tranche d'âge, sexe, discipline et règlement), et l'écart de poids de la catégorie d'arrivée respecte le réglage. Cela couvre les règles 1 à 3 et la correction d'un poids hors catégorie quand l'écart reste dans le réglage ;
  - **à valider** : tout le reste, y compris une tranche d'âge au-dessus ou au-dessous à moins de 5 kg (💡 lecture du rédacteur, à confirmer en relisant).
- ✅ Si le club a donné son **pré-accord**, la ligne porte « pré-accord coach ». C'est une **indication** : le déplacement reste à valider. 💡 Comme aujourd'hui, elle porte sur les déplacements d'âge et de poids (règles 4 à 7 et 11) ; le pré-accord ne dit rien d'un changement de discipline, de règlement ou de mixité.
- 💡 Les **cartes** suivent la même règle : le drapeau `manual` d'une proposition = « à valider » au sens ci-dessus. Le split dans l'écart réglé devient donc un cas simple sur sa carte aussi (il était toujours manuel, décision du 2026-10-23 revue ici).
- 💡 Le **retour** (règle 1) reste en tête et ne se désactive pas : le document principal le traite comme décidé (un combattant recasé revient quand sa catégorie d'origine a un adversaire). Il s'affiche dans la liste, sans poignée ni interrupteur. Dans le plan, un retour possible est **toujours inclus** (comme `bulkPlan` aujourd'hui, qui le fait en premier), même s'il ne change pas le nombre de seuls ; on peut le refuser comme tout déplacement.
- 💡 La **correction d'un poids hors catégorie** (cas `weight_out`) n'est pas une règle : elle s'impose. Le plan l'inclut toujours : sans validation si l'écart reste dans le réglage, **à valider** sinon (✅ règle des deux sortes ci-dessous ; aujourd'hui elle est toujours de type A). Si elle est impossible dans le plan (catégorie du poids réel fermée, lancée, ou dans une autre session), le combattant n'entre pas dans le plan et garde sa carte ; il est listé à part (« À traiter sur sa carte »), pas compté parmi les seuls.
- 💡 Pour un combattant shobu qui « accepte le jiyu en priorité », les règles 8 et 9 échangent leur **rang de préférence** pour lui seul (G préféré à H, critère 2 du §5.2), comme aujourd'hui. Les interrupteurs et la ligne de coupure, eux, restent ceux de la liste affichée : il a droit à H si la règle 8 est active et au-dessus de la ligne, à G si la règle 9 l'est.
- 💡 Un déplacement qui relève de **plusieurs règles à la fois** (autre discipline et tranche au-dessus, mélange filles/garçons et tranche d'âge, autre discipline avec un écart au-dessus du réglage…) n'est permis que si **toutes** ces règles sont actives et au-dessus de la ligne ; il compte au rang de **la plus basse** d'entre elles. Le plan affiche la règle la plus basse, et les autres en petit. Les cartes appliquent la même exigence aux interrupteurs (pas à la ligne).
- Les **contraintes absolues** du §9.4 restent absolues, quelle que soit la liste : shobu pour un mineur, jiyu → shobu, plus d'une tranche d'âge d'écart, discipline non acceptée, catégorie lancée ou d'une session lancée, catégorie fermée.

### 2.2 Nouvelle règle : tranche d'âge au-dessous ✅
✅ Mêmes conditions que la tranche au-dessus, juste en dessous dans la liste : **une seule tranche** d'écart, **écart de poids ≤ réglage**, **à valider** (§2.1). Le combattant seul rejoint une catégorie de la tranche **juste plus jeune** (par exemple un minime seul rejoint des benjamins).
- Aujourd'hui, seul le déplacement manuel permet de descendre d'une tranche (`ageCompatibility(..., { bothWays: true })`). La règle 6 l'ouvre aux propositions, donc aussi aux cartes.
- Les réglages de mélange s'appliquent de la même façon : descendre de seniors à juniors franchit la limite mineurs/adultes et relève alors de la règle 11 ; descendre de vétérans à seniors relève de la règle 7 💡.
- L'alerte d'écart d'âge sur la fiche du combat (§9.4) s'applique comme pour la tranche au-dessus.
- 💡 Hors champ : un « split » entre deux tranches d'âge (prendre des combattants d'une tranche plus jeune pour les donner à un aîné seul).

### 2.3 Activer, ranger, couper ✅
- Chaque règle (sauf la 1) a un **interrupteur** et une **poignée** pour la ranger.
- Une **ligne de coupure** (« je m'arrête ici ») se place entre deux règles. Le plan n'utilise que les règles **actives et au-dessus de la ligne**.
- 💡 Les réglages actuels deviennent les interrupteurs de la liste, **sans double saisie** : `mixMinorsAdults` = règle 11, `mixSeniorsVeterans` = règle 7, `mixSexes.enabled` = règle 10 (le choix des tranches reste dans les paramètres de la compétition), `shobuToJiyu` = règle 9. Une seule source de vérité, lue par les cartes et par le plan. Les règles 2 à 6 et 8 gagnent un interrupteur qui n'existait pas.
- 💡 Les **cartes** suivent les interrupteurs (une règle désactivée n'est plus proposée sur les cartes, comme aujourd'hui pour les mélanges), mais **pas** la ligne de coupure ni l'ordre : la ligne et l'ordre ne servent qu'au plan. Les cartes gardent leur classement actuel.

## 3. Réglages par défaut ✅

Trois niveaux :
1. **Réglages de l'application** (`AppSettingsPage`) : une section « Règles de réaffectation par défaut » avec la même liste (ordre, interrupteurs, ligne de coupure). On la règle une fois.
2. **Création d'une compétition** : la compétition **copie** ces réglages (`createCompetition`, aujourd'hui `defaultSettings()` dans `src/server/repositories/competitions.ts`). 💡 Changer les réglages par défaut ensuite **ne touche pas** les compétitions déjà créées.
3. **Le jour J, onglet Réaffectation** : on peut encore ranger, activer, désactiver et déplacer la ligne. Cela ne change que **cette compétition**. Un lien « Revenir aux réglages par défaut » recopie ceux de l'application.

- Les valeurs par défaut de l'application, avant toute modification, sont celles du tableau §2.1 (ligne de coupure 💡 après la règle 8).
- ✅ **Pas de bandeau** qui signale une règle rarement activée. La protection contre l'oubli, c'est que ces règles sont désactivées par défaut et rangées en bas.
- 💡 La page Paramètres de la compétition garde ses interrupteurs actuels (ce sont les mêmes valeurs, §2.3) ; elle peut renvoyer vers l'onglet Réaffectation pour l'ordre et la ligne.

## 4. L'écran du plan d'ensemble

### 4.1 La liste et son diagramme ✅
Dans l'onglet **Réaffectation**, en haut, pour la **session choisie** (comme les boutons actuels) : une seule liste, une ligne par règle (maquette `pyramide-v2.html`).
- Chaque ligne : poignée, numéro, nom de la règle (avec « à valider » si elle l'est), interrupteur, **barre « restent seuls »**, et ce que ça demande (« 17 déplacements · 6 à valider »).
- Une première ligne « Sans rien changer » donne le nombre de seuls au départ.
- ✅ Les barres sont **alignées à gauche** (un diagramme en barres, pas une pyramide centrée). La barre d'une ligne = le nombre de seuls du **meilleur plan** qui utilise cette règle et toutes les règles actives au-dessus.
- Une règle désactivée est grisée, sans barre.
- La ligne de coupure se déplace (glisser, ou clic sur la ligne où l'on s'arrête). Le bouton dessous : « Voir le plan jusqu'à la règle 5 (17 déplacements, 7 seuls) ».
- Sous le bouton, quand c'est prouvé : « Aucune combinaison dans ces règles ne laisse moins de 7 seuls. » (§5.4).
- Tout changement (ordre, interrupteur, ligne) recalcule les barres.

### 4.2 Le plan ✅
« Voir le plan » affiche les déplacements (maquette `plan.html`) :
- un résumé : restent seuls (et combien au départ), déplacements, déplacements validés / à valider ;
- groupe **« À valider »**, puis groupe **« Sans validation »** ; chaque ligne : combattant et club, déplacement (catégorie de départ → catégorie telle qu'elle sera), règle utilisée, « pré-accord coach » le cas échéant ;
- groupe **« Restent seuls »** avec les noms ; 💡 chacun garde sa carte dans la liste actuelle.

Actions sur chaque déplacement ✅ :
- **Valider** (déplacements à valider seulement) : le déplacement est **validé et épinglé**. Aucun recalcul ne le défait. On peut annuler la validation.
- ✅ **Chaque geste recalcule le meilleur plan** autour des choix fixés : valider, annuler une validation, refuser, annuler un refus, modifier, annuler un choix. Seul l'organisateur défait ce qu'il a fixé, jamais le calcul. Tant que le plan n'est pas appliqué, rien n'est écrit (sauf les refus) ; après l'application, chaque déplacement s'annule un par un dans l'historique, comme aujourd'hui.
- **Refuser** : le plan est recalculé sans ce déplacement. 💡 Le refus est enregistré comme aujourd'hui (table des refus), donc la carte ne le propose plus non plus ; « annuler le refus » le retire.
- **Modifier** : on choisit soi-même la catégorie (même liste que le déplacement manuel actuel : d'abord les catégories conformes, puis « Toutes les catégories » avec les règles enfreintes). Le choix est épinglé, le reste est recalculé. ✅ On peut **annuler le choix** (« essayer pour voir ») : le plan revient au meilleur plan sans lui.

💡 **Épingles et règles.** Une épingle (« Valider ») ou un choix « Modifier » est une décision de l'organisateur : c'est une donnée d'entrée fixe du calcul, jamais défaite par un recalcul (l'organisateur peut l'annuler), **même si sa règle est ensuite désactivée ou passe sous la ligne**, et même si « Modifier » a choisi une catégorie qui enfreint des règles (comme le déplacement manuel actuel). La ligne porte alors « règle désactivée » ou « hors règles » pour qu'on le voie. Ce n'est pas le calcul qui propose ces déplacements, donc le critère « jamais une règle inactive » vaut pour ce que le calcul choisit lui-même. Les barres et la phrase « Aucune combinaison… » sont calculées **avec les épingles et les choix en place**.

Après un recalcul, un message dit **ce qui a changé** (« Inès M. passe en -45 kg au lieu de -40 kg ») et les lignes changées sont surlignées.

**Appliquer le plan** ✅ applique d'un coup les déplacements **sans validation** et les déplacements **à valider sur lesquels on a cliqué « Valider »** (ou choisis par « Modifier »), qu'on ait tout relu ou seulement réglé quelques lignes. ✅ Un déplacement à valider non validé **n'est pas appliqué** ; il reste en attente.
- 💡 Comme les déplacements dépendent les uns des autres (deux seuls qui se rejoignent, un écart qui change), appliquer une partie du plan peut changer le reste. Au clic, l'app recalcule donc le plan **sans les déplacements à valider non validés** (pour cette fois seulement, ce n'est pas un refus), validés et choix épinglés, puis montre dans la confirmation **exactement ce qui sera appliqué** (et ce qui diffère de l'écran). Les déplacements non validés réapparaissent dans le plan recalculé après l'application.
- 💡 Le plan est refusé s'il est périmé (les données ont changé ailleurs : empreinte `stateFingerprint`, comme aujourd'hui) ; il est alors recalculé, épingles et choix gardés quand ils sont encore possibles.
- 💡 Chaque déplacement appliqué entre dans l'historique comme aujourd'hui (« en masse », annulable un par un tant que la catégorie n'est pas lancée). Un déplacement validé à la main est noté comme tel dans l'historique (avec « pré-accord coach » le cas échéant).
- 💡 Épingles et choix « Modifier » vivent dans la page jusqu'à l'application (gardés en `sessionStorage` du poste, protégés par try/catch), les refus sur le serveur.

### 4.3 Ce qui disparaît ✅
Le plan d'ensemble **remplace** les deux boutons « Classer automatiquement tous les cas simples » et « Tout classer automatiquement » (et la route `POST /replacement/bulk`, ou son contenu 🔧). Les cartes une par une, la validation unitaire, le déplacement manuel, « Ne combat pas » et « Mettre de côté » restent.

## 5. Le calcul

### 5.1 Qui peut bouger 💡
Les mêmes que l'app sait déplacer aujourd'hui, pas plus :
- les combattants des cas de la session choisie (`detectCases` : seul, poids hors catégorie, retour possible, catégorie fermée), sauf les **cartes mises de côté** ;
- pour la règle 3, les un ou deux plus lourds de la catégorie de poids juste en dessous, aux conditions du « split » actuel (`pullProposals`) ;
- 💡 un combattant que le plan **laisse seul en cours de route** (le seul autre membre de sa catégorie est parti : correction de poids, retour, combattant d'une catégorie fermée) devient lui aussi « à placer », comme `bulkPlan` aujourd'hui qui recalcule les cas après chaque étape ;
- jamais un combattant déjà recasé (`placementLocked`) hors retour, jamais une catégorie lancée ou d'une session lancée, jamais une catégorie fermée comme cible.

Un combattant d'une **catégorie fermée** compte comme « à placer » : s'il ne trouve pas de place, il reste dans « Restent seuls » avec sa carte « Catégorie fermée » (où l'on peut choisir « Ne combat pas »).

Les cas « écart de poids » (`weight_gap`) ne sont pas traités par le plan (leur carte reste), mais le plan **ne doit jamais créer** de catégorie dont l'écart dépasse le réglage, sauf par un déplacement à valider de la règle 4 (B) ou une correction de poids à valider.

💡 Un déplacement qui changerait un combattant de session (ou en emmènerait d'autres) n'entre pas dans le plan, comme aujourd'hui en masse ; il reste proposé sur la carte.

### 5.2 Ce que le calcul cherche
Pour un ensemble de règles autorisées (actives et au-dessus de la ligne), parmi tous les plans possibles, dans cet ordre de priorité :
1. ✅ **le moins de combattants seuls**, comptés **dans l'état final** de la session (un combattant à placer sans adversaire, y compris d'une catégorie fermée, compte comme seul) ;
2. ✅ à égalité, le plan qui utilise les règles **les plus hautes dans la liste** : 💡 comparer d'abord le nombre de déplacements de la règle la plus basse utilisée, puis de la suivante, etc. (un plan avec un seul déplacement en règle 8 perd contre un plan avec trois déplacements en règles 2 à 5) ;
3. 💡 à égalité, le moins de combattants déplacés ;
4. 💡 à égalité, le respect des préférences de discipline, puis le plus petit écart de poids total ;
5. 💡 enfin un départage fixe (identifiants), pour que le même état donne toujours le même plan.

Chaque déplacement du plan doit être une proposition que les cartes pourraient faire (mêmes vérifications que `evaluate` dans `src/domain/replacement/propose.ts`), **évaluée dans l'état où le plan l'applique** (les catégories ont déjà reçu les déplacements précédents du plan). Deux combattants seuls peuvent se rejoindre (fusion), comme aujourd'hui.

### 5.3 Les barres
La barre de la ligne k = l'optimum du §5.2 (critère 1) avec les règles actives 1 à k. Le plan affiché = l'optimum complet avec les règles jusqu'à la ligne de coupure, en tenant compte des épingles, des choix « Modifier » et des refus.

### 5.4 Fiabilité
- 🔧 La méthode (recherche exhaustive avec élagage, programmation en nombres entiers, autre) est au choix du constructeur, **sans service extérieur** : tout tourne sur le PC, hors ligne, dans le code métier `src/domain/replacement/` (indépendant de l'interface et de la base, comme le reste).
- 💡 Ordre de grandeur à tenir : environ 500 inscriptions, quelques dizaines de cas par session ; la liste et ses barres en **moins de 2 secondes** sur le PC de la table centrale.
- 💡 Si le calcul atteint sa limite de temps, il rend le meilleur plan trouvé, et l'écran **ne dit pas** « on ne peut pas faire mieux » (il dit « meilleur plan trouvé »). La phrase « Aucune combinaison… » n'apparaît que si l'optimum est prouvé.
- Tests (le calcul est la partie critique) : contre-exemples de l'approche carte par carte (Alice/Bruno/Chloé ; un déplacement qui fait monter l'écart et bloque le suivant) ; **jamais pire que l'ancien `bulkPlan`** sur des états générés au hasard (garder l'ancien calcul dans les tests comme référence) ; jamais une règle inactive ou sous la ligne ; épingles jamais défaites ; même entrée → même plan.

## 6. Autour

- **Aide** (`src/web/help.ts`) : réécrire le passage sur les boutons en masse ; expliquer la liste, la ligne de coupure et le plan.
- **Document principal** : mettre à jour §9.2 (réglages), §9.3/§9.4 (règle « tranche au-dessous »), §10 (plan d'ensemble à la place du bouton global) une fois construit.
- **Droits** (`src/server/auth/permissions.ts`) : les nouvelles routes ont les mêmes droits que les routes de réaffectation actuelles. ✅ Le compte **Table centrale peut tout changer dans la liste** (ordre, interrupteurs, ligne), y compris les interrupteurs qui sont aussi des paramètres de la compétition (mélanges, shobu → jiyu) ; le reste des paramètres de la compétition reste réservé à l'Organisation.
- **Synchronisation** : les nouveaux réglages font partie des réglages de la compétition et voyagent avec elle (paquet `src/server/sync/package.ts`, copie de secours, PC de zone) ; la lecture tolérante `readStoredSettings` donne les valeurs par défaut aux compétitions existantes.
- **Compétitions existantes** 💡 : à la mise à jour, elles reçoivent l'ordre et la ligne par défaut ; leurs interrupteurs de mélange gardent leur valeur actuelle.

## 7. Hors champ

- Déplacer des combattants qui n'ont pas de problème au-delà du « split » actuel (chaînes de déplacements).
- Un « split » entre deux tranches d'âge.
- Traiter les cas « écart de poids » dans le plan.
- Un plan sur plusieurs sessions à la fois.
- Un bandeau qui signale les règles rarement activées (✅ refusé).
