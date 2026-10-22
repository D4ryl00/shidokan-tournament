# App de tableaux pour compétitions Shidokan : document de conception

> **Statut : conception validée le 2026-10-21, construite** (étapes 1 à 14, voir `docs/superpowers/plans/2026-10-21-00-feuille-de-route.md`). Complétée par `docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md` (vagues, zones de combat, ordre de passage, aides) : en cas de différence, ce second document fait foi.
> Dernière mise à jour : 2026-10-23. Mainteneur : Remi.
>
> Légende : ✅ décidé par l'équipe · 🟡 présumé, en attente de confirmation de la personne qui fait les tableaux · 💡 choix de Claude, à valider ou à corriger
>
> Ce document sert aussi au **suivi du projet** : questions ouvertes, décisions et prochaines étapes sont en fin de document (§18 à §20).

---

## 1. Le problème

Le matin de la compétition, après la pesée, il y a toujours :
- des **absents** ;
- des combattants qui **ne font pas le poids** pour lequel ils se sont pré-inscrits.

Beaucoup de catégories n'ont que 1 à 3 combattants au départ. Sur l'export de la dernière Coupe Shidokan (`coupe-shidokan.xlsx`), on compte :
- Karaté : **25 catégories sur 53** avec un seul combattant ;
- Boxe : **16 sur 18** ;
- Mix : **7 sur 9**.

Il faut alors **refaire à la main et dans l'urgence** une bonne partie des tableaux, ce qui fait perdre énormément de temps juste avant le début.

Aujourd'hui, pour recaser un combattant seul, on :
1. le change de catégorie de poids (au-dessus ou en dessous) ;
2. si nécessaire, le monte d'une catégorie d'âge, avec l'accord des coachs ;
3. le passe en jiyu s'il combattait en shobu, ou dans une autre discipline, s'il est d'accord.

## 2. Ce qu'on construit, et pourquoi

Une application de gestion de compétition **pensée pour les sports de combat** (modèle : [Smoothcomp](https://smoothcomp.com)), qui couvre toute la chaîne : inscriptions, pesée, tableaux, résultats, podiums. Elle apporte une fonction que les autres outils n'ont pas :

**Le recasement assisté.** Chaque combattant indique à l'avance, **par ordre de préférence**, dans quelles autres disciplines il accepte de combattre. Le jour J, après la pesée, l'app **repère les combattants à recaser, propose des solutions classées, montre un aperçu des changements**, et l'organisateur valide. Les tableaux se régénèrent alors automatiquement.

### Objectifs ✅
- Gérer les absents et les erreurs de poids **en quelques minutes** le matin de la compétition.
- Tout faire depuis **un seul PC, sans internet** : import des inscriptions, pesée, recasement, tableaux, saisie des résultats, podiums.
- Pouvoir **adapter les règles** à chaque compétition (seuils, mixité, formats, catégories).

### Principe directeur ✅
L'app **ne change jamais un combattant de place sans validation humaine**. Même les cas simples passent par un bouton, avec aperçu et confirmation.

### Ce qui ferait échouer le projet, même si « ça marche » 💡
- Le jour J, il faut plus de temps qu'à la main : écrans trop lents, trop de clics, aperçus illisibles.
- Une coupure d'internet, ou un plantage du PC, fait perdre des données ou bloque la compétition.
- Un recasement est appliqué sans que l'organisateur ait vu ce qui change.
- L'import des fichiers réels (FFK, fiches clubs) demande des retouches manuelles importantes.

### Hors périmètre de la 1re version 💡
- Paiement en ligne, inscription en ligne par les clubs.
- Chronomètre et tableau de score en direct pendant les combats, arbitrage électronique.
- Diffusion en direct, application mobile, comptes utilisateurs.
- Plusieurs postes en réseau : l'architecture le permettra (§15), mais la 1re version vise un seul PC.

## 3. Utilisateurs et contexte

- **L'organisateur**, au PC de la table centrale : c'est le seul utilisateur de l'app en 1re version.
- **Les coachs** n'utilisent pas l'app. Ils remplissent la fiche de pré-inscription club (§7) et l'envoient par mail. Le jour J, on vient les voir pour les accords.
- **Le public et les combattants** voient les tableaux imprimés et affichés dans le gymnase.
- **Le jour J** ✅ : **un PC**, **internet pas fiable**, donc l'app fonctionne **entièrement hors ligne**.
- **Taille** 💡 : environ 150 inscriptions sur l'exemple réel. Prévoir jusqu'à environ 500 inscriptions et une compétition sur une seule journée.
- **Langue de l'interface :** français.

## 4. Le domaine

### 4.1 Disciplines ✅
| Discipline | Code fiche club | Recasement | Notes |
|---|---|---|---|
| Karaté | 1 | oui | |
| Shido-boxing | 2 | oui | appelée « Boxe » dans l'export FFK |
| Shido-mix-martial | 3 | oui | appelée « Kmix » / « Mix Martial » dans l'export FFK |
| Triathlon | — | **non** | très exceptionnel ; 3 rounds (1 par discipline) ou 6 rounds (2 par discipline) ; réglable pour la compétition ou la catégorie 💡 |
| Kata | — | **non** | individuel, noté par des juges, sans catégorie de poids (format §12) |

- **Une seule discipline de combat par jour et par combattant** par défaut ✅. Une option de la compétition permet d'en autoriser plusieurs.
- **Le kata ne compte pas** dans cette limite : kata et combat le même jour sont possibles ✅.
- **Origine des inscriptions** ✅ : pour **toutes** les disciplines, y compris le kata et le triathlon, les inscriptions peuvent venir de l'**export FFK**, des **fiches club** ou d'une **saisie manuelle**.

### 4.2 Règlements ✅
Valables pour les disciplines de combat :

| Règlement | KO | Public |
|---|---|---|
| **Jiyu ippon kumite** | non | mineurs et adultes |
| **Shobu ippon kumite** | oui | **adultes uniquement** |

- Le combattant choisit son règlement. **On ne tient pas compte du grade ni du niveau.**
- Passage de **shobu à jiyu** : possible, avec validation, **seulement si le réglage de la compétition l'autorise** ✅ (2026-10-23, désactivé par défaut). Passage de **jiyu à shobu** : jamais.
- Le règlement fait partie de la catégorie : une catégorie jiyu et une catégorie shobu sont deux tableaux distincts.
- 💡 Règlement absent de l'import (cas fréquent dans l'export FFK) : **jiyu par défaut**. On le complète avec la fiche club, sinon on le corrige à la main.

### 4.3 Catégories ✅
Une catégorie (un tableau ou une poule) = **discipline + règlement + sexe + catégorie d'âge + catégorie de poids**. Pour le kata : discipline + sexe + catégorie d'âge.

- **Grille âge et poids : celle du règlement FFK 2026-2027** (§17) ✅. **La même grille** pour karaté, shido-boxing et shido-mix-martial ✅. Elle est **entièrement modifiable** : ajout, suppression, changement des bornes. Tout changement se répercute dans le reste de l'app.
- 💡 Les exports réels contiennent parfois des catégories absentes de la grille FFK (par exemple poussins -20 kg). **À l'import, une catégorie inconnue est créée automatiquement**, et l'organisateur en est averti. Une grille modifiée peut être enregistrée comme **modèle** pour les compétitions suivantes.
- **Âges** : tranches de 2 ans chez les jeunes. Les données ne donnent que la **catégorie d'âge**, pas la date de naissance.
- 💡 **Mineurs** = jusqu'à junior inclus. **Adultes** = espoir, senior, vétérans. La liste est modifiable.
- 💡 **Ordre des tranches d'âge** (pour « une tranche au-dessus »), modifiable : mini-poussin → poussin → pupille → benjamin → minime → cadet → junior → espoir → senior. Puis, pour les vétérans : senior ↔ V1 ↔ V2 ↔ V3 ↔ V4 ↔ V5.
  - Junior → espoir ou senior : type C, **et** il franchit la limite mineurs/adultes. Il n'est donc proposé que si l'option E est activée.
  - Espoir → senior : type C. Les espoirs (18-20 ans) font partie des seniors (18+).
  - Senior ↔ V1 : type D (mélange seniors/vétérans).
  - Entre deux vétérans voisins (V1 ↔ V2…) : type C, dans les deux sens, puisque chez les vétérans le plus âgé descend vers le plus jeune.
  - L'export FFK peut indiquer un simple « Veteran » sans numéro : l'aperçu d'import le signale, et l'organisateur choisit V1 à V5 (V1 par défaut). Les poids sont les mêmes pour V1 à V5.

### 4.4 Combattant et inscriptions 💡
- **Combattant** : nom, prénom, sexe, club, n° de licence FFK s'il est connu, catégorie d'âge.
- **Inscription** : un combattant dans une discipline, avec règlement et catégorie de poids prévue. Un combattant peut avoir plusieurs inscriptions (kata + combat, ou plusieurs combats si l'option est activée).
- **Préférences** (venant de la fiche club) : liste ordonnée d'autres disciplines (codes 1, 2, 3) ; pour un combattant shobu, « accepte le jiyu en priorité » oui ou non.
- **Club** : nom, coach (nom, téléphone, e-mail), **pré-accord global** oui ou non.
- **Données du jour J** : présent ou absent, poids réel, catégorie finale, historique des recasements.

## 5. Déroulé complet

| Quand | Étape | § |
|---|---|---|
| Plusieurs semaines avant | Créer la compétition et ses paramètres. Générer le **modèle de fiche club**, l'envoyer aux clubs. | §14, §7 |
| Au fil des retours | **Importer les fiches club** renvoyées. | §7 |
| Clôture des inscriptions | **Importer l'export FFK**, puis rapprocher avec les fiches club. Générer les **tableaux provisoires**. **Recasement anticipé** ✅ des combattants déjà seuls (accords des coachs par mail). Imprimer les **feuilles de pesée**. | §6, §7, §9, §11 |
| Jour J, pesée | Saisir **présences et poids réels**. | §8 |
| Jour J, fin de pesée | **Recasement** au tableau de bord. Les tableaux se régénèrent. **Impression** des tableaux pour le gymnase. | §9, §10, §13 |
| Jour J, compétition | Lancer les catégories, **saisir les résultats**. | §12 |
| Jour J, remises | **Export des podiums**. | §13 |

Inscription sur place ✅ : on peut ajouter un combattant à tout moment, jusqu'au lancement de sa catégorie.

## 6. Import de l'export FFK ✅

### 6.1 Ce que contient le fichier (exemple : `coupe-shidokan.xlsx`)
- **Un onglet par discipline** (« Coupe Shidokan Karate », « Boxe », « Mix Martial »). Les noms et le nombre d'onglets peuvent changer.
- **Colonnes :**
  - `Nom`, `Prenom` ;
  - `Numero` : la licence ;
  - `Entite rattachement` : « code club + nom », par exemple « 0060893 TANI DOJO DRAP » ;
  - `Genre` : « Masculin » / « Feminine » ;
  - `Type` : la discipline (« Karate », « Boxe », « Kmix ») ;
  - `Age` : le nom de la catégorie d'âge ;
  - `Categorie` : le poids, par exemple `-35` ou `+84` ;
  - `Discipline` : contient en fait **le règlement** (« Ji Yu », « Shobu »), presque toujours vide.
- **Particularités** :
  - lignes vides entre les catégories ;
  - `Nom` contient souvent « NOM PRÉNOM » avec un `Prenom` vide, mais pas toujours ;
  - `Categorie` mélange des nombres et du texte ;
  - casse incohérente (« Junior » / « JUNIOR ») ;
  - champs parfois manquants ;
  - une même licence peut apparaître dans plusieurs onglets.
- **Ce qui manque** : date de naissance, poids réel, préférences, coach.

### 6.2 Fonctionnement
- **Formats acceptés : .xlsx, .ods et .csv**, sans conversion préalable. Pour le CSV : détection automatique du séparateur (`,` ou `;`) et de l'encodage.
- **Indépendant des noms d'onglets et de l'ordre des colonnes** :
  1. on choisit les onglets à importer ;
  2. l'app reconnaît les colonnes d'après leurs titres et propose une **correspondance**, que l'on peut corriger ;
  3. la correspondance est **mémorisée** ;
  4. la discipline vient de la colonne `Type`, ou à défaut du nom de l'onglet.
- **Normalisation** : lignes vides ignorées, casse et accents unifiés, `-35` / `+84` reconnus, valeurs connues associées (« Kmix » → shido-mix-martial, « Ji Yu » → jiyu).
- **Aperçu avant import**, avec les problèmes signalés : champ manquant, catégorie inconnue (créée automatiquement, §4.3), doublon, combattant inscrit dans **deux disciplines de combat** alors que l'option est désactivée.
- **La licence identifie le combattant** : une même personne présente dans plusieurs onglets n'est créée qu'une fois. **Réimporter** un export mis à jour ajoute, modifie ou retire des inscriptions **sans créer de doublons**, après un aperçu des différences 💡.

## 7. Fiche de pré-inscription club ✅

### 7.1 Chronologie
1. La fiche club arrive **en premier**, par mail.
2. L'export FFK arrive **en dernier**, à la clôture. **Il fait foi** pour les inscriptions officielles.
3. L'app **rapproche** les deux.

### 7.2 La fiche
- L'app génère un **modèle vierge**, identique pour tous les clubs, au format **OpenDocument tableur (.ods)** 💡. Il s'ouvre dans LibreOffice et dans Excel, et l'app peut le **relire automatiquement**.
- La fiche reste **simple** ✅. Listes déroulantes et validation des cellules.
- **Une fiche remplie sur ordinateur s'importe en un clic** ✅, avec aperçu des erreurs. Une fiche remplie à la main se saisit dans un **écran de saisie rapide** 💡.
- 💡 Le modèle est conçu une fois dans LibreOffice, avec ses listes déroulantes, et livré avec l'app. L'app le complète (nom et date de la compétition, listes de catégories) au moment de le générer.

**En-tête :**
- nom du club ;
- coach : nom, téléphone, e-mail 💡 ;
- **pré-accord global du coach** ✅ : une seule case, valable pour tous les combattants du club. Elle signifie que le coach accepte les recasements en âge et en poids sans être recontacté.

**Une ligne par combattant :**
| Colonne | Saisie | Statut |
|---|---|---|
| Nom, prénom | texte | ✅ **pas de numéro de licence** |
| Sexe | liste | 💡 |
| Catégorie d'âge, catégorie de poids | listes | 💡 |
| Discipline (karaté, shido-boxing, shido-mix-martial, triathlon, kata), règlement (jiyu / shobu, sauf kata) | listes | ✅ toutes les disciplines ; 💡 une ligne par inscription (kata + combat = deux lignes) |
| Autres disciplines, **par ordre de préférence** | chiffres 1, 2, 3, par exemple « 32 » ; vide = ne change pas de discipline | ✅ |
| Si shobu : accepte le **jiyu en priorité**, avant de changer de discipline | Oui / Non | ✅ |
| Poids actuel approximatif | kg, facultatif | 💡 |

Kata et triathlon : inscription possible sur la fiche ✅, mais **jamais dans les préférences** de recasement ✅.

### 7.3 Rapprochement avec l'export FFK 💡
- Faute de licence sur la fiche, le rapprochement se fait par **nom + prénom + club**, complétés par le sexe et la catégorie d'âge.
- **Noms** normalisés : casse, accents, ordre nom/prénom, prénom collé au nom.
- **Clubs** : l'organisateur associe une fois chaque club de fiche à son « Entite rattachement » FFK. L'association est mémorisée d'une compétition à l'autre.
- Rapprochements **sûrs** : automatiques. **Douteux** (homonymes, fautes de frappe) : proposés pour confirmation.
- Ensuite, l'app signale :
  - **inscrit FFK sans fiche club** : on peut compléter à la main ; sinon aucune préférence ;
  - **fiche club sans inscription FFK** : non inscrit officiellement, **inscriptible sur place le jour J** ✅ ;
  - **différences** de catégorie ou de discipline : l'export FFK fait foi, mais l'écart reste visible.

## 8. Pesée 💡

- ✅ (2026-10-22) La pesée se fait **par vague** (« Samedi matin », « Dimanche »…) quand la compétition en a : liste, compteurs, feuilles de pesée et clôture ne portent que sur les catégories de la vague choisie. La **présence est tenue par inscription** : un combattant inscrit en kata le matin et en combat l'après-midi est pointé dans chaque vague ; son poids relevé reste le même. Détails : second document, §1.3 et §1.4.
- Écran de pesée rapide : recherche par nom ou club, saisie du poids, case « présent ».
- **Tolérance** réglable, par défaut 300 g pour les hommes et 500 g pour les femmes (FFK).
- ✅ (2026-10-23, règle FFK confirmée) La limite fait partie de la catégorie : en -40 kg, 40,0 kg reste en -40 kg (et jusqu'à 40,3 kg pour un homme). La dernière catégorie, ouverte (« +84 kg »), prend tous les poids au-dessus.
- Un poids hors de la catégorie (tolérance comprise) crée **une proposition de recasement** vers la catégorie qui correspond au poids réel. Rien n'est appliqué sans validation (§2).
- À la clôture de la pesée (de la vague), l'organisateur confirme que les non-pesés sont **absents** ; un combattant déjà présent (inscrit ensuite sur place) le reste.
- Feuilles de pesée imprimables, par club ou par catégorie.
- Kata : pas de pesée, seulement la présence.

## 9. Recasement

### 9.1 Quand et quoi
✅ (2026-10-22) Avec des vagues, le tableau de bord traite **la vague choisie**. Une proposition qui ferait changer un combattant de vague (ou qui emmène d'autres combattants dans une autre vague) est marquée « change de vague », jamais pré-approuvée ni validée en masse ; validée une par une, l'inscription repasse « non pesé » dans sa nouvelle vague. Une vague **lancée** est fermée au recasement tant qu'on ne la rouvre pas. Détails : second document, §1.5.

Le recasement est possible **dès que les inscriptions sont connues, avant le jour J** ✅, puis à nouveau après la pesée, et jusqu'au lancement des catégories. L'app repère :
- les **combattants seuls** dans leur catégorie (à cause d'un absent, d'un changement de poids, ou dès l'inscription) ;
- les **poids hors catégorie** (§8) ;
- 💡 les catégories dont l'**écart de poids réel** dépasse le seuil après une modification ;
- ✅ les **retours possibles** : un combattant recasé dont la **catégorie d'origine** a de nouveau un adversaire (nouvelle inscription, inscription sur place, autre recasement) doit **revenir dans sa catégorie d'origine**. L'app le propose (type **R**, « Retour ») comme toute autre proposition, avec aperçu et validation (§2). La catégorie d'origine est donc toujours mémorisée ;
- 💡 les **recasements anticipés remis en cause** par la pesée (absent, poids réel trop éloigné). Ils sont signalés en priorité sur le tableau de bord, avec de nouvelles propositions.

### 9.2 Paramètres ✅
Tous réglables **pour chaque compétition**.

| Paramètre | Défaut |
|---|---|
| Écart de poids max **entre deux combattants**, enfants | 5 kg |
| Écart de poids max entre deux combattants, adultes | 5 kg |
| Changement de tranche d'âge | une seule, vers le haut |
| Mélange mineurs / adultes | **désactivé** (si activé : proposé, validation manuelle) |
| Mélange seniors / vétérans | **activé** 🟡, désactivable, validation manuelle |
| Mélange filles / garçons | **désactivé** ; si activé, choix des catégories concernées |
| Passage de shobu à jiyu (type G) | **désactivé** ✅ (2026-10-23) ; si activé : proposé, validation manuelle |
| Plusieurs disciplines de combat le même jour | désactivé |

💡 L'écart de poids d'une catégorie se mesure entre **le plus léger et le plus lourd** de ses combattants, avec les poids réels de la pesée (ou la limite de la catégorie si le combattant n'est pas encore pesé).

### 9.3 Types de recasement et validation
| # | Type | Validation |
|---|---|---|
| A | Catégorie de poids voisine, même âge, écart ≤ seuil (y compris la correction d'un poids hors catégorie) | **cas simple** : bouton « Valider » (2026-10-23, auparavant « Classer automatiquement ») ✅ |
| B | Catégorie de poids voisine, écart > seuil | manuelle ✅ |
| C | Tranche d'âge au-dessus (une seule) | manuelle, avec l'accord des deux coachs ✅ |
| D | Mélange seniors / vétérans | manuelle, si l'option est activée 🟡 |
| E | Mélange mineurs / adultes | manuelle, si l'option est activée ✅ |
| F | Mélange filles / garçons | manuelle, si l'option est activée pour la catégorie ✅ |
| G | Shobu → jiyu | manuelle ✅, seulement si le réglage l'autorise |
| H | Autre discipline, selon les préférences | manuelle ✅ |
| R | **Retour dans la catégorie d'origine** | 💡 cas simple, comme A ✅ (le retour lui-même est décidé) |

### 9.4 Génération des propositions 💡
- Une **proposition** = un ou plusieurs combattants déplacés vers une catégorie cible. La cible peut être une catégorie existante ou une **fusion de deux catégories** (par exemple deux combattants seuls en -30 kg et en -35 kg réunis).
- Chaque proposition indique son **type** (A à H), son **motif**, les **contrôles** (écart de poids, écart d'âge) et son **effet** sur les tableaux.
- **Ordre de classement** : R en premier, puis A, B, C/D, G, H, et enfin E et F (seulement si activés). Ajustements :
  - un combattant shobu qui accepte le jiyu en priorité : G passe avant H ;
  - sinon : H passe avant G ;
  - pour H, l'ordre des disciplines suit les préférences du combattant ;
  - dans la nouvelle discipline, le combattant **garde son règlement**. S'il est shobu et accepte le jiyu, le jiyu est aussi envisagé.
- **Contraintes absolues**, jamais proposées :
  - shobu pour un mineur ;
  - jiyu → shobu ;
  - plus d'une tranche d'âge d'écart ;
  - une discipline que le combattant n'a pas acceptée ;
  - une option de la compétition désactivée ;
  - une catégorie **déjà lancée** (§11.3).
- ✅ (2026-10-23) **« Split »** : un combattant **seul** peut aussi recevoir le plus lourd, ou les deux plus lourds (pour former une poule de 3), de la catégorie de poids **juste en dessous** (même discipline, règlement, sexe et tranche d'âge), s'il y en reste au moins deux. Jamais dans l'autre sens (on ne fait pas descendre un combattant vers une catégorie plus légère). Ces combattants n'avaient pas de problème : la proposition est **toujours manuelle**, jamais validée en masse, et ils ne « reviennent » pas d'eux-mêmes. Chacun a sa ligne dans l'historique (annulable).
- Si le club a donné son **pré-accord**, les propositions C et B portent la mention « pré-accord coach ».
- **Écart d'âge** : quand un combattant affronte un plus jeune, une alerte s'affiche sur la fiche du combat. Le coach du plus âgé lui demande en général d'y aller plus doucement.
- Si aucune solution n'existe : le combattant est signalé « **sans adversaire** ». L'organisateur peut le déplacer à la main n'importe où (avec avertissement si une règle est enfreinte), ou le retirer.
- ✅ (2026-10-23) **Poids hors catégorie, catégorie du poids réel vide** : la proposition « vers la catégorie du poids réel » indique qu'il y sera seul et passe en dernier ; avant elle, les catégories existantes où il aurait un adversaire (sa catégorie de poids est corrigée dans tous les cas), jamais une catégorie trop légère pour son poids pesé.
- ✅ (2026-10-23) **Déplacement manuel** : la liste ne propose d'abord que les catégories **cohérentes avec les réglages** ; « Toutes les catégories » ajoute les autres, marquées « règle(s) enfreinte(s) », avec le détail avant confirmation. En déplacement manuel, deux tranches d'âge **voisines** se mélangent **dans les deux sens** sans avertissement (une benjamine avec des pupilles) ; les propositions automatiques, elles, ne font toujours que monter d'une tranche.
- ✅ (2026-10-23) Chaque cas affiche le combattant en une ligne : tranche d'âge et sexe, discipline et règlement, catégorie de poids, poids (pesé ou approximatif), disciplines acceptées.

### 9.5 Validation
- Chaque proposition peut être **validée**, **refusée** ou **modifiée** à la main, après avoir vu un **aperçu**.
- Les validations sont **enregistrées** : qui, quand, motif. Une validation peut être **annulée** tant que la catégorie n'est pas lancée.
- Les propositions sont **recalculées** après chaque validation, puisqu'un déplacement peut résoudre ou créer d'autres cas.

## 10. Tableau de bord du jour J ✅

- **Liste des cas à traiter**, combattant par combattant, avec les propositions classées et un **aperçu avant validation** : qui bouge, quels tableaux changent, qui rencontre qui.
- **Cas simples (A)** : bouton « Valider » → aperçu → « Êtes-vous sûr ? » → application. ✅ (2026-10-23) Chaque proposition nomme la catégorie **telle qu'elle sera après le déplacement** (« Benjamins / Minimes M · -45 / -50 kg ») et les adversaires qu'il y rencontrera ; l'écart de poids affiché est celui entre le plus léger et le plus lourd de cette catégorie.
- **Bouton global « Tout classer automatiquement »** → aperçu global → confirmation. Il applique la meilleure proposition à **tous** les cas, **y compris ceux qui demandent normalement une validation manuelle**. L'organisateur en prend la responsabilité.
  - 💡 L'aperçu global sépare les cas simples des cas qui auraient dû être validés un par un.
- **Repérage visuel des combattants reclassés et du motif**, partout où ils apparaissent :
  - **badge = couleur + icône + texte court** (« ⚖ +3 kg », « ↑ Âge », « ⇄ Discipline », « Shobu → Jiyu », « ⚥ Mixte ») ;
  - la **couleur indique le type** de changement (poids, âge, discipline, règlement, mixité), 5 couleurs au maximum ;
  - le **remplissage indique l'état** : contour pour « en attente », plein pour « validé », grisé pour « refusé » 💡 ;
  - au clic : catégorie d'origine et d'arrivée, motif, qui a validé et quand ;
  - **filtres** par type et par état.
- Le tableau de bord reste **uniquement à l'écran**, il n'est jamais imprimé.
- 💡 Un **résumé** en haut de page : nombre de présents, d'absents, de cas en attente, de combattants sans adversaire, de catégories prêtes ou lancées.

## 11. Tableaux et poules

### 11.1 Formats (modèle Smoothcomp) ✅
| Format | Usage |
|---|---|
| Élimination directe | combat |
| Double élimination | combat |
| Poule (tous contre tous) | combat, **par défaut pour 3 combattants** ✅ |
| 3 combattants avec repêchage | combat |
| Multi-étapes (poules puis tableau final) | combat |
| 2 combattants, au meilleur des trois | combat |
| **Kata en deux tours** (§12) : classement par notes, puis finale à deux | kata ✅ |

- **Format par défaut selon le nombre** 💡 (réglable) :
  - 2 combattants : **un seul combat** 🟡 ;
  - 3 : poule ✅ ;
  - 4 et plus : élimination directe.
- **Options** réglables pour la compétition, et modifiables pour un tableau en particulier ✅ :
  - **repêchage** : **désactivé par défaut** ;
  - **combat pour la 3e place** : 💡 désactivé par défaut, c'est-à-dire deux médailles de bronze.
- *Repêchage :* ceux qui ont perdu contre l'un des deux finalistes se rencontrent dans un petit tableau à part, et les gagnants prennent le bronze.

### 11.2 Génération 💡
- **Tirage au sort**, en **séparant les combattants d'un même club** au premier tour autant que possible.
- Pour le kata : ordre de passage tiré au sort.
- Tout tableau peut être **modifié à la main** (échanger deux combattants, changer de format) tant qu'il n'est pas lancé.

### 11.3 Cycle de vie d'une catégorie 💡
`provisoire` (avant la pesée) → `prête` (après le recasement) → `lancée` (premier résultat saisi) → `terminée`.
- Un recasement ou une inscription **régénère** automatiquement les tableaux non lancés concernés.
- Une catégorie **lancée** est **verrouillée** : on ne peut plus y recaser personne. Un déverrouillage reste possible, avec avertissement.
- ✅ (2026-10-22) Une catégorie d'une **vague figée** (« Figer et imprimer la vague ») est verrouillée de la même façon : son tableau ne se régénère plus sans confirmation (« Régénérer (renuméroté à la suite) »).

## 12. Déroulé de la compétition et résultats ✅

- ✅ (2026-10-22, remplace l'affectation à la main des tatamis) Les **zones de combat** sont nommées (« Tatami 1 », « Ring »), avec les disciplines qu'elles accueillent. Les catégories de chaque vague sont **réparties automatiquement** sur les zones en équilibrant les combats (ou épinglées à la main). Chaque zone a sa **file numérotée** : kata d'abord, puis les combats « tour par tour » (finales en fin de vague) ou « catégorie par catégorie », avec le signal « pas de repos : prévoir une pause ». Option : finales sur une zone choisie. « Figer et imprimer la vague » fige les numéros ; « Rouvrir » et « Refiger » ; en cas de retard, une catégorie se **déplace** vers une autre zone « à la suite » ou « mélangés », avec aperçu. L'onglet Combats affiche, par zone, la file des prochains combats de la vague dans l'ordre des numéros. Détails : second document, §1.2 et §1.6 à §1.10.
- **Saisie des résultats** au PC central ✅. Pour chaque combat 💡 :
  - **vainqueur** ;
  - **méthode** : points / décision, KO (shobu uniquement), abandon, disqualification, forfait ;
  - **score** facultatif.
- Le vainqueur **avance automatiquement** dans le tableau. On peut **corriger** un résultat déjà saisi : les combats suivants touchés sont signalés.
- **Classement des poules** 💡 : nombre de victoires, puis confrontation directe, puis décision de l'organisateur.
- **Kata** ✅ :
  - **Tour 1** : chaque compétiteur présente un kata, et les arbitres le notent sur 10.
  - **Finale** : seuls les **deux meilleurs** du tour 1 présentent un **deuxième kata**, à nouveau noté sur 10.
  - **Note d'un passage** : le **nombre d'arbitres varie**. S'il y en a **moins de 5**, on fait **la moyenne** des notes. À partir de 5 💡, on retire la note la plus haute et la plus basse, puis on fait la moyenne des autres (méthode FFK).
  - **Classement** : la finale départage les 1er et 2e, avec **la note de la finale seule** ✅. Les 3es sont les suivants du tour 1 : un ou deux bronzes, réglable, deux par défaut.
  - 💡 **Égalité** : on compare d'abord la note la plus basse retirée, puis la plus haute. Si l'égalité persiste, l'organisateur décide ou fait repasser les compétiteurs.
  - Avec 2 compétiteurs seulement : directement la finale 💡.
- **Absence en cours de journée** : le combat est perdu par forfait.

## 13. Impressions et exports ✅

- **Tableaux et poules pour le gymnase** : simples, lisibles de loin. Noms, clubs, rencontres, résultats. ✅ (2026-10-23) L'élimination directe s'affiche en **arbre relié** (un trait mène chaque paire au combat suivant), à l'écran comme à l'impression ; une poule imprimée liste aussi **ses combats dans l'ordre des numéros** sous la grille. **Sans** badges ni motifs de recasement. ✅ (2026-10-22) Chaque tableau porte **le nom de sa zone** et, sur chaque combat, son **numéro de passage** (« Combat 31 ») ; une finale déplacée porte « Zone des finales : Ring » ; un tableau renuméroté après le figeage porte « mis à jour à HH:MM ». Impression vague par vague.
- **Podiums** ✅ : par catégorie, 1er, 2e, 3e (deux 3es s'il n'y a pas de combat pour la 3e place), avec le club.
  - Formats 💡 : **PDF** pour l'annonce et la remise des médailles, **.ods / .xlsx** pour l'archivage et la fédération.
  - 💡 **Classement des clubs** par médailles (or, argent, bronze) dans le même export.
- **Feuilles de résultats** ✅ (1re version) : elles **reprennent le format des tableaux de combat** (arbre, poule, kata), remplis avec les résultats : vainqueur, méthode et score, ou notes des arbitres pour le kata. C'est un **mode d'affichage et d'impression** des tableaux, pas un document à part. En PDF. 💡 Plus un export tableur (.ods / .xlsx) de tous les résultats, pour l'archivage.
- **Feuilles de pesée** (§8).
- **Modèle de fiche club** (§7).
- 💡 **Sauvegarde complète** de la compétition dans un fichier, à restaurer sur un autre PC.

## 13 bis. Interface ✅

- **Thème clair et thème sombre**. Par défaut, celui du système ; un bouton permet de forcer l'un ou l'autre, et le choix est mémorisé sur le PC.
- **Logo Shidokan France** : `assets/brand/shidokan-france-logo.webp`. C'est une version optimisée pour le web, de 512 × 512 px, à fond transparent, tirée du PNG d'origine.
  - Il apparaît dans l'**en-tête** de l'app et comme **icône d'onglet**. 💡 Il figure aussi en en-tête des **impressions**.
  - ⚠️ L'anneau et le texte du logo sont **noirs sur fond transparent** : en thème sombre, il est posé sur un **disque blanc**, sinon il est illisible.
  - Le SVG d'origine **n'est pas utilisé**. Son texte circulaire dépend de polices non incluses dans le fichier (Noto Sans JP Heavy) et ne s'affiche pas, et le logo est placé au milieu d'une page A4. Pour s'en servir un jour, il faudrait convertir le texte en tracés et recadrer la page dans Inkscape.
- **Navigateur de référence : Google Chrome**. Les tests d'interface automatisés tournent sur Chrome, dans les deux thèmes.

## 14. Paramètres d'une compétition (récapitulatif) 💡
- Nom, date, lieu.
- ✅ (2026-10-22) Zones de combat (noms, ordre, disciplines accueillies) ; vagues (nom, ordre, règles par tranche d'âge et par discipline, catégories ajoutées ou retirées) ; ordre de passage des combats (tour par tour / catégorie par catégorie) ; finales sur une zone (et finales de kata). Récapitulatif : second document, §1.11.
- Grille de catégories (âges, poids, liste des mineurs et adultes), modifiable et enregistrable comme modèle.
- Disciplines proposées ; triathlon (3 ou 6 rounds).
- Seuils et options de recasement (§9.2).
- Tolérance de pesée (§8).
- Formats par défaut, repêchage, combat pour la 3e place (§11.1).
- Notation du kata (§12).

## 15. Architecture technique

### Décidé ✅
- **TypeScript** pour toute l'app. **Remi maintient l'app.**
- **Fonctionnement 100 % local, hors ligne**, sur un PC.
- Doit pouvoir évoluer vers une **base de données partagée entre plusieurs PC**, hébergée.

### Proposé 💡
- **Application web servie par un serveur local** sur le PC central : on lance l'app, puis on l'utilise dans le navigateur.
- **Base SQLite** (un fichier), via une couche d'accès qui supporte **aussi PostgreSQL**, pour passer plus tard à une base hébergée sans réécriture.
- Évolution prévue :
  1. un PC en local ;
  2. d'autres postes (tatamis, écran d'affichage) se connectent au PC central par le réseau local, **sans internet** ;
  3. le serveur est hébergé en ligne, avec PostgreSQL.
- La **logique métier** (recasement, génération des tableaux, avancement des vainqueurs, classements) est **indépendante de l'interface et de la base**, et **couverte par des tests**. C'est la partie critique.
- **Sauvegarde automatique** régulière de la base pendant la compétition. Toute action est enregistrée (journal), pour pouvoir revenir en arrière.
- **Docker** ✅ : l'app (serveur + interface) est livrée sous forme d'**image Docker**, pour tourner de la même façon sous **Windows, macOS et Linux**.
  - La base SQLite et les sauvegardes sont dans un **volume** monté sur un dossier du PC, visible et copiable sur clé USB.
  - 💡 Lancement par un `docker compose up` (ou un petit script à double-cliquer), puis l'app s'ouvre dans le navigateur.
  - ⚠️ Sous Windows et macOS, il faut **Docker Desktop**, avec la virtualisation activée et parfois des droits administrateur. L'image doit être **téléchargée avant le jour J**, puisqu'il n'y a pas d'internet sur place. À tester sur le PC de la table centrale bien avant le 22 novembre.
  - 💡 Le serveur reste exécutable sans Docker (Node.js), pour le développement et en solution de secours.

## 16. Laissé au constructeur
- Choix des frameworks et bibliothèques (interface, serveur, ORM, lecture et écriture des tableurs, génération des PDF).
- Partir de zéro ou réutiliser une bibliothèque de tableaux existante (par exemple pour l'élimination directe et les poules). À évaluer, mais la logique de recasement est à écrire.
- Algorithme exact de génération et de classement des propositions, en respectant §9.3 et §9.4.
- Mise en page détaillée des écrans et des impressions.
- Détails de l'image Docker et du script de lancement.

## 17. Référence : règlement FFK 2026-2027
Source : `docs/ffk/Reglement-des-competions-karate-2026-2027-2.pdf`. Le shidokan n'y est pas mentionné : **nous fixons nos propres limites** et la FFK sert de valeurs par défaut.
- **Pesée** (p. 19) : poids ≤ limite de la catégorie et > limite de la catégorie inférieure. Tolérance de 300 g pour les hommes et 500 g pour les femmes. Si le poids ne correspond pas, passage dans la catégorie du poids réel.
- **Surclassement d'âge** (art. 8, p. 20) : une seule catégorie.
- **Regroupements** (section body-karaté, p. 60 et 63) : catégorie supérieure ou la plus proche, en privilégiant la cohérence d'âge, de niveau et de sécurité.
- **Grille âge et poids** (p. 17) :
  - âges : mini-poussins 4-5, poussins 6-7, pupilles 8-9, benjamins 10-11, minimes 12-13, cadets 14-15, juniors 16-17, espoirs 18-20, seniors 18+, vétérans V1 35-45, V2 46-55, V3 56-65, V4 66-75, V5 76+ ;
  - poids selon l'âge et le sexe : voir le PDF.

Produits étudiés : [evroon/bracket](https://github.com/evroon/bracket), [netomacedo/bjj-tournament-system](https://github.com/netomacedo/bjj-tournament-system), [Smoothcomp](https://smoothcomp.com). Aucun ne gère les préférences de discipline ni le recasement assisté.

## 18. Questions ouvertes

### Pour la personne qui fait les tableaux (WhatsApp du 2026-10-21, sans réponse)
Hypothèses à faire confirmer (🟡) :
- [ ] 5 kg pour tout le monde, au-delà validation manuelle
- [ ] Mineurs et adultes jamais ensemble par défaut ; seniors et vétérans possible avec autorisation
- [ ] Filles et garçons jamais ensemble par défaut
- [ ] Changement de discipline et shobu → jiyu : avec validation
- [ ] Poule pour 3
- [ ] À 2 combattants : un seul combat (défaut actuel) ou au meilleur des trois ?
- [ ] À partir de combien de combattants passe-t-on à l'élimination directe ou au multi-étapes ?

### Pour nous
- (rien en attente)

## 19. Décisions prises
| Date | Décision |
|---|---|
| 2026-10-21 | Nous gérons nos propres limites, réglables pour chaque compétition ; la FFK sert de valeurs par défaut. |
| 2026-10-21 | Écart de poids max par défaut : 5 kg entre deux combattants, réglable séparément pour les enfants et les adultes. Au-delà : validation manuelle. |
| 2026-10-21 | Changement d'âge : une seule tranche au-dessus, toujours en validation manuelle, avec l'accord des deux coachs. |
| 2026-10-21 | Pas de prise en compte du grade ou du niveau ; le combattant choisit son règlement (jiyu ou shobu). |
| 2026-10-21 | Shobu (avec KO) réservé aux adultes. Shobu → jiyu possible avec validation ; jiyu → shobu jamais. |
| 2026-10-21 | Changement de discipline : toujours en validation manuelle. |
| 2026-10-21 | Mineurs/adultes : désactivé par défaut, activable. Seniors/vétérans : activé, désactivable. Mixité : désactivée par défaut, activable par catégorie. |
| 2026-10-21 | Une discipline de combat par jour par défaut, plusieurs en option. Le kata ne compte pas. |
| 2026-10-21 | Aucun recasement sans validation humaine ; boutons « classer automatiquement » (un cas ou tous) avec aperçu et confirmation. Le bouton global s'applique à tous les cas, y compris ceux qui demandent une validation manuelle. |
| 2026-10-21 | Tableau de bord uniquement à l'écran (badges couleur + icône + texte). Impressions : tableaux simples pour le gymnase. |
| 2026-10-21 | Catégories FFK par défaut, entièrement modifiables, avec répercussion dans toute l'app. |
| 2026-10-21 | Formats de type Smoothcomp, y compris pour le kata ; poule pour 3 ; repêchage désactivé par défaut ; repêchage et 3e place réglables pour la compétition ou pour un tableau. |
| 2026-10-21 | Triathlon : 3 ou 6 rounds ; exclu du recasement. |
| 2026-10-21 | Kata : individuel, noté par les juges, inscription à part, cumulable avec le combat. |
| 2026-10-21 | Import de l'export FFK indispensable (.xlsx / .ods / .csv, indépendant des noms d'onglets). |
| 2026-10-21 | Fiche de pré-inscription club générée par l'app, reçue **avant** l'export FFK, simple, sans licence, importable en un clic ; préférences codées 1/2/3 ; choix shobu → jiyu en priorité ; pré-accord du coach en une case globale. |
| 2026-10-21 | Combattants d'une fiche club absents de l'export FFK : inscriptibles sur place. |
| 2026-10-21 | Jour J : un PC central, 100 % hors ligne ; architecture évolutive vers une base partagée et hébergée. |
| 2026-10-21 | TypeScript ; Remi maintient l'app. |
| 2026-10-21 | 1re version complète : import, fiches club, pesée, recasement, tableaux, saisie des résultats, export des podiums. |
| 2026-10-21 | **Prochaine compétition : 22 novembre 2026.** Plans découpés de façon logique, pour développer et tester par étapes. |
| 2026-10-21 | Grille âge et poids FFK, identique pour karaté, shido-boxing et shido-mix-martial. |
| 2026-10-21 | Recasement possible avant le jour J ; un combattant recasé revient dans sa catégorie d'origine si un adversaire y apparaît. |
| 2026-10-21 | Kata et triathlon : inscriptions par export FFK, fiche club ou saisie manuelle, comme les autres disciplines. |
| 2026-10-21 | Kata : 1er et 2e départagés par la note de la finale seule. |
| 2026-10-21 | Export des feuilles de résultats (scores) dans la 1re version. |
| 2026-10-21 | Livraison en image Docker (Windows, macOS, Linux). |
| 2026-10-21 | Thèmes clair et sombre ; logo Shidokan France (WebP optimisé) ; interface testée sur Chrome. |
| 2026-10-21 | Feuilles de résultats = mode d'affichage et d'impression des tableaux de combat, remplis avec les résultats. |
| 2026-10-21 | Kata : tour 1 pour tous (note sur 10), finale à deux avec un 2e kata ; nombre d'arbitres variable ; moyenne simple s'il y a moins de 5 arbitres. |
| 2026-10-23 | Pesée : règle FFK gardée (poids ≤ limite, tolérance comprise). Shobu → jiyu : réglage de la compétition, désactivé par défaut. « Split » vers la catégorie du combattant seul, jusqu'à une poule de 3, toujours manuel. Tranches voisines dans les deux sens en déplacement manuel seulement. |

## 20. Prochaines étapes
1. ~~Valider ce document~~ ✅ validé le 2026-10-21.
2. Récupérer les réponses WhatsApp et mettre à jour les 🟡.
3. ~~Plan de développement~~ ✅ étapes 1 à 14 réalisées (feuille de route et bilan dans `docs/superpowers/plans/`).
4. Répétition générale sur le PC de la table centrale (Docker, sans internet), puis compétition le 22 novembre 2026.
