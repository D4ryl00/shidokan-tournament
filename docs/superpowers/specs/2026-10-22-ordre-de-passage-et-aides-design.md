# Vagues, ordre de passage par zone de combat, et aides à l'écran — conception

**Date :** 2026-10-22 · **Complète :** `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` (remplace le premier point du §12 sur l'affectation des tatamis ; modifie la pesée §8 et le recasement §9 pour les rattacher aux vagues).
**Échéance :** compétition du 22 novembre 2026, avec une répétition générale avant.

> **Vocabulaire (2026-10-23)** : dans l'app, « vague » se dit désormais **« session »** et « recasement » **« réaffectation »** (verbe « réaffecter », badge « réaffecté »). Ce document garde les anciens termes, qui restent aussi dans le code (`wave`, `replacement`), la base et l'API. Onglets : `/sessions` et `/reaffectation` (les anciennes adresses `/vagues`, `/recasement` et `?vague=` sont redirigées).

Deux parties indépendantes :
- **Partie 1 — Vagues et ordre de passage par zone** (demandes 1 et 2 de l'organisateur, et la compétition sur plusieurs jours) : la plus grosse.
- **Partie 2 — Aides à l'écran** (demande 3) : plus petite. **À faire en premier**, parce qu'elle sert dès la répétition générale.

Légende : ✅ décidé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

---

## Partie 1 — Vagues et ordre de passage par zone de combat

### 1.1 Pourquoi

Dans le gymnase, chaque zone de combat (« Tatami 1 », « Ring »…) a sa propre file de combats. Les coachs regardent les tableaux affichés au mur pour savoir **quand** leur combattant va passer, et l'échauffer au bon moment. Aujourd'hui l'app affecte une catégorie à un tatami à la main et liste les combats catégorie par catégorie : un vainqueur peut remonter sur le tapis juste après son combat, sans repos, et rien n'indique aux coachs le rang de passage.

Par ailleurs, on ne fait jamais combattre toutes les catégories en même temps : par exemple les 6-11 ans le matin, les plus grands l'après-midi, et parfois la compétition dure **deux jours**. Chaque groupe de catégories a sa propre pesée, son propre recasement, puis se lance pendant que le suivant se pèse.

**Réussi si :** le jour J, chaque tableau affiché porte le nom de sa zone et un **numéro de passage** par combat (« combat 31 — Tatami 1 ») ; un combattant a au moins un combat de repos entre deux passages quand c'est possible ; on pèse, recase et lance un groupe de catégories sans toucher aux autres ; si une zone prend du retard, on en déplace des combats sans semer la confusion.

**Échec même si « ça marche » :** des numéros déjà affichés qui changent sans que la table le voie venir ; la clôture de la pesée du matin qui marque absents les combattants de l'après-midi ou du lendemain ; un combattant changé de vague sans validation ; du shido-boxing envoyé ailleurs que sur le ring ; une zone qui finit une heure après les autres alors qu'on pouvait équilibrer.

### 1.2 Zones de combat ✅
- Le « nombre de tatamis » devient une **liste de zones nommées**, modifiable : nom libre (« Tatami 1 », « Tatami 2 », « Ring »), ordre d'affichage.
- Les compétitions existantes reprennent leurs tatamis sous les noms « Tatami 1 » à « Tatami N » ; les catégories déjà affectées gardent leur zone.
- Le nom de la zone est **imprimé** sur chaque tableau affiché.

### 1.3 Vagues ✅
Une **vague** est un groupe de catégories qui se pèsent, se recasent et se lancent ensemble. Il n'y a pas de matin/après-midi ni de journées imposés : on crée autant de vagues que nécessaire, nommées librement (« Samedi matin », « Samedi après-midi », « Dimanche »…), dans l'ordre où elles passent.

- **Constituer une vague** : sélection rapide **par tranche d'âge** (« Poussins », « Pupilles », « Benjamins »…) ou **par discipline**, puis ajout ou retrait **catégorie par catégorie**. Le découpage par âge se fait par tranche entière (on ne coupe pas une tranche de deux ans).
- Une catégorie appartient à **une vague au plus**. Sans vague, elle reste **en attente** : pas de pesée, pas de zone, pas de numéro.
- 💡 Les choix « par tranche » et « par discipline » sont mémorisés comme des **règles** de la vague : une catégorie créée plus tard (inscription sur place, nouvelle catégorie de poids) qui y correspond rejoint la vague d'elle-même. Un choix catégorie par catégorie l'emporte sur les règles. Une catégorie qui correspond aux règles de deux vagues va dans la première et l'écran le signale.
- 💡 Une catégorie qui réunit plusieurs tranches (après un recasement) garde la vague de la catégorie d'arrivée.
- Une compétition sans vague définie se comporte comme aujourd'hui : une seule vague implicite avec toutes les catégories.

**États d'une vague :**
1. **En préparation** : on règle ses catégories.
2. **Pesée** : la pesée de la vague est ouverte (1.4), puis close.
3. **Recasement** : tableau de bord des catégories de la vague (1.5).
4. **Lancée** : répartition sur les zones, ordre de passage, « Figer et imprimer » (1.9). Ses combats commencent. Pendant ce temps, la vague suivante peut déjà passer à la pesée.
5. **Terminée** : tous ses podiums sont complets.

🔧 Les états 1 à 3 peuvent se chevaucher en pratique (on peut consulter le tableau de bord pendant la pesée, comme aujourd'hui) ; seuls le lancement et la clôture de la pesée sont des actions explicites.

**Rouvrir une vague lancée** ✅ (par exemple fermée par erreur) : bouton « Rouvrir la vague », avec confirmation (« des tableaux déjà affichés pourront changer »).
- Les catégories **sans aucun résultat** redeviennent modifiables : on peut y recaser ou y ajouter des combattants, et leurs tableaux se régénèrent.
- Les catégories **déjà commencées** restent verrouillées (le déverrouillage manuel avec avertissement existe déjà).
- Quand on **refige** la vague, seules les catégories modifiées sont renumérotées, comme pour un déplacement en cours de compétition (1.10) : **à la suite** par défaut, **mélangés** au choix, avec aperçu, et les tableaux réimprimés portent « mis à jour à HH:MM ».

### 1.4 Pesée par vague ✅
- La liste de pesée, les feuilles de pesée et **« Clôturer la pesée »** ne portent que sur les combattants **des catégories de la vague**. Clôturer la pesée d'une vague ne marque jamais absent un combattant d'une autre vague.
- 💡 La **présence est tenue par vague** : un combattant inscrit en kata dans une vague et en combat dans une autre est pointé dans chacune, et peut être présent dans l'une et absent dans l'autre. Le poids relevé, lui, reste celui du combattant (une seule pesée suffit s'il est pesé deux fois le même jour : la dernière valeur fait foi).
- Compétition sans vague : comportement actuel.

### 1.5 Recasement par vague ✅
- Le tableau de bord du recasement traite les cas **des catégories de la vague** en cours.
- Un recasement peut envoyer un combattant vers une catégorie d'une **autre vague** (plus tardive) : l'app peut le **proposer**, mais :
  - la proposition est marquée **« change de vague : Samedi matin → Dimanche »** ;
  - elle n'est **jamais pré-approuvée** et **jamais appliquée par la validation globale** : il faut la valider **une par une** ;
  - le combattant est alors pesé et pointé avec sa nouvelle vague (son poids déjà relevé est conservé).
- S'il y a **plusieurs propositions** (par exemple changer de discipline en restant dans la vague et la même catégorie de poids, ou changer de catégorie et donc de vague), elles s'affichent toutes et l'organisateur **choisit** celle qu'il préfère, comme aujourd'hui sur le tableau de bord.
- 💡 Une vague **lancée** est fermée au recasement (on ne peut plus y faire entrer personne) tant qu'on ne la rouvre pas (1.3). Une catégorie d'une vague **en attente** ou pas encore lancée peut recevoir un combattant, avec la même validation « change de vague ».

### 1.6 Répartition des catégories entre les zones ✅
- **Contraintes**, facultatives :
  - **par discipline** : la liste des zones autorisées (exemple : shido-boxing → Ring seulement) ;
  - **par catégorie** : épingler une catégorie sur une zone (prioritaire sur la règle de discipline).
- **Répartition automatique** au lancement d'une vague : l'app place les catégories non épinglées sur leurs zones autorisées en **équilibrant le nombre de combats** de chaque zone, pour que les zones finissent à peu près ensemble. 💡 On compte les combats sans pondérer par la durée. 🔧 Algorithme libre (glouton « plus grosse catégorie d'abord » suffit).
- **Une catégorie se dispute entière sur une seule zone**, sauf sa finale si l'option « finales sur une zone » est active (1.8).
- L'organisateur peut **déplacer** une catégorie d'une zone à une autre. Tant que la vague n'est pas figée, l'ordre de passage se recalcule librement.
- Une contrainte impossible (discipline autorisée sur aucune zone) est signalée et bloque le lancement de la vague.

### 1.7 Ordre de passage d'une zone ✅
Chaque zone a **sa propre numérotation**. 💡 Elle continue d'une vague à l'autre sur une même zone ; au lancement d'une vague, une case **« reprendre les numéros à 1 »** permet de repartir de zéro (nouveau jour).

**Kata d'abord** ✅ : dans chaque vague, sur chaque zone, les catégories de kata passent **avant** les combats. Une catégorie de kata se déroule **en entier sur une seule zone**, sans être découpée en tours. Dans l'ordre de passage, elle forme **un bloc numéroté** (« n° 14 — Kata Benjamins F, 8 katakas ») 💡. Les zones sans kata commencent directement leurs combats ✅.

**Deux modes pour les combats**, réglage de la compétition ✅ :
- **Tour par tour** (par défaut) : on passe tous les combats d'un même tour de toutes les catégories de la zone, puis le tour suivant. Exemple : tous les 8es de finale, puis tous les quarts, puis toutes les demies… 💡 Les tours sont alignés **à partir de la fin** (finale, demies, quarts, 8es…) pour que les catégories de tailles différentes se rejoignent ; les poules s'insèrent elles aussi tour par tour (journée 1 de la poule, journée 2…). Les **finales passent à la fin de la vague** ✅.
- **Catégorie par catégorie** : une catégorie va jusqu'à sa finale, puis on commence la suivante. 💡 Les catégories s'enchaînent dans l'ordre de la grille, modifiable à la main.

**Repos** ✅ : un combattant doit avoir **au moins un combat** entre deux passages, et autant que possible davantage (c'est le but du mode « tour par tour »). Ce n'est **pas bloquant** : quand c'est impossible (catégorie seule sur sa zone, mode « catégorie par catégorie »…), l'app accepte l'enchaînement et le **signale** sur le combat concerné (« pas de repos : prévoir une pause »), pour que la table marque une pause.
- Le repos se juge sur la **structure du tableau** (le vainqueur du combat X dispute le combat Y), pas sur les noms : l'ordre est connu avant les résultats.
- 🔧 Placement fin libre (ordre à l'intérieur d'un tour, alternance des catégories) tant que la règle de repos est respectée au mieux. Repêchages, combats pour la 3e place, double élimination, poules puis tableau, meilleur des trois : chaque combat reçoit une « distance à la fin » cohérente avec ses dépendances.
- Les **exemptions** ne reçoivent pas de numéro. 💡 La 3e manche d'un meilleur des trois reçoit un numéro même si elle peut ne pas être disputée (trou toléré).

### 1.8 Finales sur une zone choisie ✅
- Option de la compétition : **« Finales sur la zone… »** (aucune par défaut). Si elle est réglée, le **combat pour la 1re place** de chaque catégorie de combat quitte la zone de sa catégorie et passe sur la zone choisie, **à la fin de la vague**, l'une après l'autre, numérotées dans la suite de cette zone.
- Les combats pour la 3e place, les repêchages et le reste de la catégorie restent sur leur zone.
- Option distincte : **« Finales de kata aussi sur la zone des finales »**, désactivée par défaut (d'habitude, tout le kata reste sur un tatami). Si elle est activée, la finale de kata (les deux finalistes) forme un bloc sur la zone des finales, à la fin de la vague.
- 🔧 Ordre des finales entre elles : libre (par exemple l'ordre des catégories dans la grille).

### 1.9 Ce qu'on voit, ce qu'on imprime, et le figeage ✅
- **Tableaux affichés** : les mêmes tableaux que ceux des catégories (arbre, poule en grille, kata), avec **le nom de la zone** et, sur chaque combat, **son numéro de passage**. Une finale déplacée porte le nom de la zone des finales.
- **Écran des combats** (onglet « Combats ») : par zone, la file des prochains combats de la vague **dans l'ordre des numéros**, avec le signal « pas de repos ». Il remplace la liste actuelle catégorie par catégorie.
- On imprime et on affiche **vague par vague**, avec le bouton **« Figer et imprimer la vague »** :
  - **avant** : tout se recalcule (pesée, recasements, changements de zone, régénération des tableaux) ;
  - **après** : les numéros de la vague ne changent plus, sauf par un déplacement en cours de compétition (1.10) ou une réouverture (1.3).
- 💡 Figer exige que toutes les catégories de la vague aient une zone et soient au moins « prêtes ». Si une catégorie d'une vague figée doit être régénérée (absent tardif, déverrouillage), l'app demande confirmation et la traite comme un déplacement « à la suite » sur sa propre zone.
- 💡 Une liste imprimable de l'ordre de passage par zone (pour la table) n'est pas demandée ; elle pourra s'ajouter si la répétition générale le réclame.

### 1.10 Déplacer des combats en cours de compétition ✅
Quand une zone prend du retard :
- On déplace **une catégorie entière**, ou **les combats qui lui restent** si elle est lancée, vers une autre zone. Pas de combats isolés d'une même catégorie sur deux zones.
- Les combats **déjà joués** (résultat saisi) gardent leur numéro et leur zone. 💡 Sur la zone de départ, les numéros des combats partis deviennent des **trous** (pas de renumérotation).
- **Deux modes, choisis au moment du déplacement, « À la suite » par défaut** :
  - **À la suite** : les combats déplacés prennent les numéros suivant le dernier numéro de la zone d'arrivée. Les autres numéros de cette zone ne changent pas ; on ne réimprime que les tableaux déplacés.
  - **Mélangés** : l'app refait l'ordre de **tous les combats non joués** de la zone d'arrivée, avec la règle de repos, à partir du numéro qui suit le plus grand numéro déjà joué sur cette zone. Mieux réparti, mais des numéros déjà affichés changent : il faut réimprimer tous les tableaux de la zone.
- **Aperçu avant de valider** : combats renumérotés (ancien → nouveau numéro) et tableaux à réimprimer.
- Les tableaux réimprimés portent **« mis à jour à HH:MM »**.
- 🔧 Un combat en cours sur le tapis n'a pas encore de résultat : l'aperçu « Mélangés » le montre renuméroté ; à l'organisateur de choisir « À la suite » dans ce cas.

### 1.11 Réglages ajoutés (récapitulatif)
| Réglage | Défaut |
|---|---|
| Zones de combat (noms, ordre) | d'après le nombre de tatamis existant : « Tatami 1 »… |
| Vagues (nom, ordre, règles par tranche / discipline, catégories ajoutées ou retirées) | aucune (une vague implicite) |
| Zones autorisées par discipline | toutes |
| Mode d'ordre de passage | tour par tour |
| Finales sur la zone… | aucune |
| Finales de kata aussi sur cette zone | non |

### 1.12 Hors périmètre
- Horaires estimés de passage, durée des combats, pondération par discipline.
- Écran d'affichage dynamique (TV) ; l'affichage reste papier.
- Déplacer des combats isolés d'une catégorie.
- Deux vagues lancées en même temps sur des zones différentes 💡 (une vague se lance quand la précédente est lancée ; elles peuvent se chevaucher dans le temps, mais l'ordre de passage d'une zone les enchaîne).

### 1.13 Laissé au constructeur 🔧
- Schéma de données (zones, vagues et leurs règles, présence par vague, numéros de passage figés, historique des déplacements), migration depuis `competitions.tatami_count`, `categories.tatami` et `fighters.presence`.
- Le calcul de l'ordre (domaine pur dans `src/domain`, couvert par des tests unitaires : repos, alignement des tours, kata d'abord, finales déplacées, modes « à la suite » et « mélangés »).
- L'adaptation du recasement (filtre par vague, marque « change de vague », exclusion de la validation globale) dans `src/domain/replacement`.
- Présentation exacte des écrans, tant qu'ils suivent la Partie 2 (aides).

---

## Partie 2 — Aides à l'écran

### 2.1 Pourquoi ✅
Le jour J, des **bénévoles découvrent l'app** (pesée, saisie des résultats, tables de zone). Ils doivent comprendre seuls ce qu'ils voient et quoi faire, sans appeler l'organisateur. Les écrans de préparation (grille, réglages, import FFK) servent surtout à l'organisateur, mais certains termes y sont obscurs (exemple : « C : tranche au-dessus, D : seniors / vétérans »).

**Échec même si « ça marche » :** des aides longues que personne ne lit ; du jargon technique ou des codes internes ; des textes éparpillés impossibles à relire d'un coup.

### 2.2 Ce qu'on ajoute ✅
- **Une phrase d'aide sous le titre de chaque section**, en mots simples : à quoi sert la section, quoi faire. Exemple (pesée) : « Tapez le poids lu sur la balance puis Entrée : le combattant est marqué présent. »
- **Un bouton ⓘ à côté du titre** qui ouvre une aide plus complète : étapes une par une, sens des badges et des couleurs, cas particuliers (absent, hors catégorie, égalité…).
- **Priorité aux écrans des bénévoles** : pesée, saisie des résultats, notation kata, combats par zone. Les écrans de préparation ont aussi leurs aides, plus détaillées.
- Tous les onglets sont couverts : compétitions, réglages, grille, inscriptions, clubs, fiche club, import FFK, pesée, recasement, tableaux, combats, podiums, impressions, sauvegardes — et les écrans de la Partie 1 (vagues, zones) au fil de leur réalisation.
- 💡 Les textes sont regroupés dans un seul fichier, pour être relus et corrigés d'un coup. Ils sont rédigés par le constructeur à partir de la spec ; l'organisateur les relit dans l'app.

### 2.3 Passages d'âge dans l'éditeur de grille ✅
Le type de passage reste dans l'éditeur (il sert quand on ajoute une tranche à la grille : c'est là qu'on décide si le passage obéit à l'option seniors/vétérans), mais en clair :
- **« Toujours permis »** (type C : tranche au-dessus) ;
- **« Seulement si le mélange seniors / vétérans est activé »** (type D).

Le ⓘ explique à quoi servent les passages (le recasement ne propose de changer de tranche que par un passage de la liste), la différence entre les deux, et que la grille FFK est déjà réglée.

### 2.4 Laissé au constructeur 🔧
- Composant (info-bulle, panneau latéral, fenêtre), tant que l'aide courte reste visible sans clic et que l'aide complète s'ouvre d'un clic.
- Masquer les aides courtes (option « je connais ») : non demandé.

---

## Ordre de réalisation 💡
1. Partie 2 (aides), y compris l'éditeur de grille.
2. Partie 1, par étapes livrables :
   1. zones nommées ;
   2. vagues (constitution, règles) avec pesée et présence par vague ;
   3. recasement par vague (marque « change de vague », validation une par une) ;
   4. répartition sur les zones, ordre de passage (kata d'abord, tour par tour / catégorie par catégorie, repos), impression avec numéros ;
   5. figeage, réouverture, finales sur une zone ;
   6. déplacements en cours de compétition (« à la suite » / « mélangés »).

   Chaque étape reçoit ses aides au fil de l'eau.
3. ~~Mise à jour de la spec principale (§8, §9, §12, §14) et du bilan.~~ ✅ 2026-10-22.
