# Réaffectation : un diagramme et une page qui se lisent — conception

Date : 2026-10-27. Suite du plan d'ensemble (`2026-10-25-plan-d-ensemble-reaffectation-design.md`, appelé ci-dessous « le
plan d'ensemble »), après un essai de l'utilisateur sur la page Réaffectation. ✅ = décidé par l'utilisateur, 💡 = choix du
constructeur (à vérifier en lisant).

## 1. Pourquoi

Quatre incompréhensions constatées à l'écran :

1. **Le diagramme se lit à l'envers.** La barre « restent seuls » est longue et verte quand il reste beaucoup de combattants
   seuls : une grande barre pleine se lit comme un but atteint, le vert comme « c'est bien ». La couleur voulait dire « règle
   peu coûteuse » (concession), mais la barre mélange deux sens : sa longueur est le problème, sa couleur le coût.
2. **La ligne 1 monte au-dessus du départ.** « Sans rien changer : 3 », puis « 1. Retour dans la catégorie d'origine : 6 ». La
   ligne 1 contient aussi les corrections de poids hors catégorie, imposées ; rien ne le dit, et l'on ne comprend pas qu'une
   « règle » ajoute des seuls.
3. **Un refus dans le plan ne s'annule pas simplement**, et l'on ne peut pas recommencer le plan : « Annuler le refus » est
   sous les groupes du plan, et « Repartir de zéro » (tout en bas, dans l'historique) annule toutes les réaffectations validées
   de la compétition, ce qui n'est pas « recommencer le plan ».
4. **Deux façons de régler les cas, sans distinction.** Le plan automatique et les cartes combattant par combattant se suivent
   sans séparation visible ; les compteurs, entre les deux, ne disent rien de ce rôle.

✅ Le plan automatique est le cas général ; les cartes servent quand le plan ne traite pas tous les cas.

**Réussi si**, à la table centrale, sans explication : on voit d'où l'on part ; on comprend que chaque règle permise case des
combattants et à quel prix ; on revient sur un refus ou on recommence le plan sans peur de défaire ce qui est appliqué ; on sait
qu'on passe aux cartes pour ce qui reste.

**Échec même si « ça marche » :** une barre qui grandit quand la situation empire ; une couleur de succès sur un problème ; un
bouton du plan qui touche aux cartes ou aux réaffectations déjà appliquées.

## 2. La page

✅ Disposition « deux étapes l'une sous l'autre » (maquette A), de haut en bas :

1. Le choix de la session (inchangé).
2. **Les compteurs** (Présents, Absents, Non pesés, Cas à traiter, Mises de côté, Catégorie fermée, Sans adversaire, Sans
   solution automatique, Catégories lancées), ✅ remontés **au-dessus des règles** : on sait de combien de combattants seuls on
   part sans rien toucher. Ils montrent la situation réelle, jamais celle du plan ; 💡 leurs calculs ne changent pas.
3. **Bloc ① « Plan automatique »**, encadré, avec une phrase : « Le cas général : choisissez jusqu'où vont les règles, vérifiez
   le plan, puis appliquez-le. » Il contient la coche du §5, le tableau des règles (§3), « Revenir aux réglages par défaut »,
   « Voir le plan… » et « Recommencer le plan » (§4), puis le plan ouvert.
4. **Bloc ② « Cas un par un : ce que le plan ne règle pas »**, encadré d'une autre couleur, avec une phrase : « Une fois le
   plan appliqué, les combattants encore seuls sont ici, carte par carte. » Il contient les filtres, les cartes et 💡 la
   section « Mises de côté » (ce sont des cartes).
5. 💡 L'historique des réaffectations (avec « Repartir de zéro ») reste en dessous, hors des deux blocs : il vaut pour les deux.

💡 Les deux blocs utilisent les éléments communs de `src/web/components/ui/` (`SectionCard` ou équivalent) avec un titre
numéroté ; couleurs de bordure prises dans les jetons `--sk-*` (le violet de l'accent pour ①, une couleur d'attention douce pour
②), lisibles en clair et en sombre. Mise en page correcte à la largeur d'un téléphone (règle de la refonte UI).

## 3. Le diagramme des règles

✅ Option « B » : une barre qui **se remplit** à mesure que les règles casent des combattants ; la barre pleine est le but.
✅ Présenté en **tableau avec une ligne d'en-tête**.

### 3.1 Colonnes

En-tête (petites capitales, comme les titres de groupes existants) :

| (poignée, ↑ ↓) | N° | Règle | Coût | Active | Combattants : casés · restent seuls | Déplacements |
|---|---|---|---|---|---|---|

- **Coût** : la pastille de couleur actuelle (groupe de coût de la règle, `costBand`), avec son libellé en infobulle.
- **Active** : l'interrupteur actuel.
- **Déplacements** : « 3 », ou « 3 · **1 à valider** » quand il y en a (💡 colonne à part ; c'était sous le nom).
- Une **légende** au-dessus du tableau : une pastille par couleur de « casés » présente, et les hachures « restent seuls ».
- 💡 Sur un écran étroit, le tableau passe en lignes empilées (comme aujourd'hui) ; l'en-tête peut alors se réduire à la
  légende. Aucun défilement horizontal de la page.

### 3.2 Ligne de départ : « Au départ, corrections imposées »

✅ (solution 2) La ligne « Sans rien changer » disparaît (les compteurs, §2, disent d'où l'on part). La première ligne du
tableau devient **« Au départ, corrections imposées »**, sur fond légèrement grisé, sans poignée, sans numéro, sans
interrupteur :

- elle compte les seuls du plan qui ne contient que ce qui s'impose : les **retours** dans la catégorie d'origine et les
  **corrections de poids hors catégorie** (c'est le calcul de l'actuelle ligne « 1. Retour » : `level = 'return'`) ;
- sous son nom, ce qu'elle contient : « 1 retour · 1 poids hors catégorie » (les déplacements de ce plan, comptés par sorte ;
  💡 « aucune correction » s'il n'y en a pas) ;
- 💡 les choix du plan (Valider, Modifier, §4) y sont déjà en place, comme dans toutes les lignes (`solvePlan` les épingle
  d'abord) : ils comptent dans le détail (« 1 retour · 1 poids hors catégorie · 2 choix du plan ») et le titre devient
  « Au départ, corrections imposées et vos choix » quand il y en a. Ainsi les barres ne remontent jamais : `D` change avec les
  choix, comme toutes les lignes ;
- sa barre est **entièrement hachurée rouge** : « 6 seuls ». C'est le nombre à caser, et l'échelle de toutes les barres ;
- colonne Déplacements : le nombre de déplacements de ce plan.

💡 La règle « Retour » ne s'affiche plus comme une ligne numérotée : elle est dans la ligne de départ. Les règles affichées
sont numérotées à partir de 1 (« Catégorie de poids voisine » devient 1). Dans les données, `return` reste en tête de
`replacementRules.order` (rien ne change côté réglages) ; seul l'affichage la retire et décale les numéros. Les numéros des
règles dans le plan (pastilles des déplacements, titres des groupes « règles 1–3 ») suivent la même numérotation, et le
bouton « Voir le plan jusqu'à la règle k » aussi.

💡 La ligne « je m'arrête ici » peut se placer juste sous la ligne de départ (c'est `cutAfter = 'return'` : seulement les
corrections imposées) ; un clic sur la ligne de départ l'y met, comme sur une règle.

### 3.3 La barre d'une règle

Soit `D` le nombre de seuls de la ligne de départ, et `S(k)` celui de la ligne de la règle k (calcul inchangé : le meilleur
plan avec les règles actives jusqu'à k, plan d'ensemble §5.3). La barre de la ligne k fait toute la largeur et se compose de :

- **casés** = `D − S(k)`, colorés, à gauche ;
- **restent seuls** = `S(k)`, hachurés rouge, à droite, avec le texte « 4 seuls ».

✅ Les casés sont **découpés par couleur** : chaque règle active j ≤ k apporte `S(j−1) − S(j)` combattants casés (j−1 : la
ligne active au-dessus, ou la ligne de départ), dans la couleur de coût de **la règle j**. Une règle qui ne case personne
n'ajoute rien ; sa ligne garde les couleurs des règles au-dessus. Ainsi, une règle rouge qui n'apporte rien ne peint rien en
rouge. Chaque morceau porte son nombre s'il a la place. 💡 Le calcul se fait à l'affichage, à partir des lignes déjà reçues ;
le serveur ne change pas pour cela.

- Les barres ne remontent jamais à partir de la ligne de départ (plan d'ensemble §5.3 : chaque ligne part du plan de la ligne
  active au-dessus) : `S(j−1) − S(j) ≥ 0`. 💡 Si cela arrivait quand même (garde-fou), le morceau est compté 0.
- `D = 0` : pas de barre ; la ligne de départ dit « Aucun combattant seul » et les lignes des règles n'ont pas de barre.
- Règle désactivée : ligne grisée, sans barre (inchangé). Ligne pas encore calculée : barre en attente « … » (inchangé).
- Pendant un calcul, les lignes du plan précédent restent grisées (inchangé).
- Couleurs : celles des groupes de coût existants (`--sk-cost0..4`) ; hachures rouges à partir du jeton de danger existant.
  Contraste vérifié en clair et en sombre (texte sur les morceaux, texte rouge sur les hachures).

## 4. Les décisions prises dans le plan restent dans le plan

✅ **Valider, Modifier et Refuser**, faits dans le plan, ne valent **que pour le plan** : rien n'est enregistré pour la
compétition, les cartes n'en voient rien. Seul « Appliquer le plan » change les catégories. Après un refus ou une modification,
la suite du plan est recalculée (comme aujourd'hui).

- Valider et Modifier sont déjà ainsi (`usePlanChoices`, `sessionStorage` du poste, par compétition et session).
- **Refuser** rejoint ce fonctionnement : le refus devient un choix du plan, gardé avec les autres sur le poste, envoyé au
  calcul et à l'application. 💡 Nouveau genre de choix `{ kind: 'refuse', proposalId, caseId }` dans `PlanChoice` (même
  validation zod, même limite de 500). Le plan n'utilise plus les routes `refuse` / `unrefuse` (elles restent pour les cartes).
- Le calcul écarte les propositions refusées dans le plan exactement comme il écarte aujourd'hui `state.refused` (même
  identifiants de proposition).
- La section **« Refusés »** du plan liste les refus du plan, chacun avec **« Annuler le refus »** (retire le choix ; recalcul).
  💡 Un refus du plan dont la proposition n'existe plus est retiré de la liste, avec le message existant « Certains choix ne
  sont plus possibles et ont été retirés ».
- ✅ **Les refus du plan survivent à « Appliquer le plan »** : ils ne partent qu'avec « Recommencer le plan », « Annuler le
  refus », ou quand la proposition n'existe plus. Aujourd'hui, après l'application, `PlanView` remplace les choix par
  `waiting` : les refus doivent être gardés à part (choix restants = `waiting` + refus du plan). Valider et Modifier, eux,
  partent comme aujourd'hui une fois appliqués.
- Comme pour les autres choix, ces refus ne sont visibles que sur ce poste (✅ accepté). Un refus fait dans le plan ne
  s'affiche plus sur la carte du combattant.
- 💡 Les refus déjà enregistrés depuis le plan avant ce changement restent des refus de carte (on ne sait pas les distinguer) ;
  pas de migration.

### « Recommencer le plan »

✅ Un bouton **« Recommencer le plan »** à côté de « Voir le plan… » : il efface d'un coup, pour la session affichée, les
validations, modifications et refus faits dans le plan, puis recalcule. Les réaffectations appliquées, les cartes, leurs refus,
les mises de côté et les règles ne changent pas.

- 💡 Pas de fenêtre de confirmation : rien de ce qui est enregistré n'est touché. Désactivé quand le plan n'a aucun choix.
- 💡 La coche du §5 garde sa position.
- « Repartir de zéro » (historique) ne change pas ; il oublie toujours les choix du plan du poste (`clearPlanChoices`), refus
  du plan compris.

## 5. Coche « Tenir compte des décisions prises sur les cartes »

✅ Une coche, dans le bloc ①, au-dessus du tableau des règles : **« Tenir compte des décisions prises sur les cartes »**.

- **Cochée** (💡 par défaut) : comme aujourd'hui, le plan écarte les propositions refusées sur les cartes et laisse de côté
  les cas des cartes mises de côté.
- ✅ **Décochée** : le plan ignore les refus faits sur les cartes (il peut reproposer ces déplacements) **et ignore les mises
  de côté** (il traite ces combattants comme si leur carte ne l'était pas). Les cartes elles-mêmes ne changent pas : refus et
  mises de côté restent enregistrés.
- Les réaffectations déjà appliquées ne sont jamais concernées : le plan part toujours de la situation réelle.
- Cocher ou décocher recalcule le diagramme et le plan.
- 💡 La coche est gardée sur le poste, par compétition et session, comme les choix du plan (`sessionStorage`).
- 💡 Dans le calcul : décochée, l'état donné au plan a `refused = []` et `setAside = []` (avant d'ajouter les refus du plan,
  §4). Le même réglage est envoyé à l'application du plan et entre dans l'empreinte du plan (`hash`) : un plan calculé
  décoché ne s'applique qu'avec la coche décochée.
- 💡 Application d'un plan décoché qui déplace un combattant dont la carte était mise de côté : la mise de côté suit la règle
  existante (une carte dont le cas disparaît n'est plus listée ; si le cas demeure, elle reste de côté).

## 6. Ce qui ne change pas

Le calcul du plan (critères, budget de nœuds, calcul à part et sa progression, épingles), les règles et leurs réglages, les
cartes et leurs boutons, « Repartir de zéro », les compteurs (leur calcul), les droits (Table centrale).

## 7. Laissé au constructeur

- Les libellés exacts des phrases d'aide et de la légende, en restant court.
- Le rendu exact des hachures et des nombres dans les morceaux étroits (masquer le nombre s'il ne tient pas ; l'infobulle de la
  barre donne « 2 casés par les règles 1–3 · 2 par la règle 4 · 2 seuls »).
- Les identifiants de test : adapter les tests e2e existants (`ladder-start`, `ladder-alone`, `plan-unrefuse`…) et ajouter de
  quoi vérifier : ligne de départ et son détail, barre casés/seuls découpée, numérotation sans « Retour », refus local au plan
  (la carte ne le voit pas), « Recommencer le plan », coche décochée (refus de carte et mise de côté ignorés), compteurs
  au-dessus des règles, deux blocs.
- La mise à jour du plan d'ensemble (§4 « liste des règles », §5.3) et de la conception principale, plus le bilan et la feuille
  de route (étape suivante).
