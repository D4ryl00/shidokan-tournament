# Détails des cartes de Réaffectation et « Copier pour le club » — conception

Date : 2026-11-18. ✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant).

Maquette validée par l'utilisateur (✅ « ok ») :
`.superpowers/brainstorm/15002-1794961656/content/details-b-v3.html` (fichier local, git-ignoré ; s'ouvre directement dans
un navigateur). Elle fait foi pour la disposition et les textes, pas pour le code ni pour les données (fictives). Les versions
précédentes (`details-layout.html`, `details-b-v2.html`) sont écartées.

## 1. Pourquoi

Sur l'onglet Réaffectation, une proposition de déplacement ne montre qu'un résumé : nom, club, une ligne sur le combattant,
« De ➜ Vers » avec ce qui change surligné, les pastilles des règles. Pour décider, l'organisateur doit aller dans Inscriptions
ou dans Tableaux voir qui est dans la catégorie d'arrivée, qui est ce combattant, à quoi ressemblerait le tableau. ✅

Deux besoins :

1. **Tout voir sans quitter la carte** : la fiche complète du combattant déplacé, ses catégories de départ et d'arrivée en
   détail, tous leurs combattants avec la fiche de chacun, le tableau de chaque catégorie, et un accès à la galaxie. ✅
2. **Écrire vite au club** pour demander l'autorisation du déplacement : un bouton qui met dans le presse-papiers une ligne
   prête à coller dans un message. ✅

La compétition a lieu le 2026-11-22 : la livraison doit être simple et sûre.

## 2. Objectifs, non-objectifs, anti-objectifs

Objectifs :
- Un bouton « Détails » sur chaque proposition, qui déplie sous elle les deux catégories (De / Vers) côte à côte. ✅
- Dans chaque catégorie, une vue au choix **« Combattants | Tableau »** (une seule à la fois) ; un clic sur un nom, dans l'une
  ou l'autre vue, déplie sa fiche. ✅
- Le tableau de la catégorie d'arrivée montre le combattant qui arrive **à la place qu'il prendrait vraiment**, calculé par le
  serveur ; un spinner pendant le calcul. ✅ Exact aussi pour une ligne du plan (le plan est rejoué jusqu'à elle) ✅ et pour
  une catégorie nouvelle (tirage rendu déterministe) ✅ — « fais la meilleure implémentation, même à 4 jours ».
- Un bouton « 📋 Copier pour le club » sur chaque proposition. ✅

Non-objectifs :
- Les coordonnées du club (coach, téléphone, e-mail, pré-accord) dans la fiche : **pas de détail du club** à l'ouverture d'un
  combattant ; seul le nom du club figure, à côté du nom du combattant. ✅
- Modifier un combattant ou une catégorie depuis ces détails : lecture seule. 💡
- Envoyer le message au club depuis l'appli : on copie, l'organisateur colle où il veut. 💡
- La galaxie intégrée dans la carte : elle reste dans Tableaux, ouverte par un lien. 💡

Anti-objectifs (échec même si « ça marche ») :
- La même liste de combattants affichée deux fois (une liste sous le tableau, ou un tableau et une liste côte à côte dans la
  même catégorie). ✅ (refusé sur la v2)
- Un tableau « après » qui ne correspond pas à ce que fera réellement le déplacement.
- Des détails qui ralentissent l'écran ou le plan quand ils sont fermés.

## 3. Approches (pour le tableau « après »)

- **A. Le serveur calcule le tableau d'arrivée « après »** en jouant le déplacement à blanc (`dryRun`, déjà utilisé par
  `sameClubPreview`) et en relisant le tableau de la catégorie où arrive le combattant, avec le même code que l'application
  réelle. Exact par construction ; ajout serveur ; un temps de chargement à l'ouverture. **✅ Retenue.**
  Pour une ligne du plan : **le serveur rejoue le plan jusqu'à cette ligne** (✅ B, préféré à « ce déplacement seul, et le
  tableau actuel quand une ligne précédente touche les mêmes catégories »).
- B. L'écran recalcule le tableau avec les fonctions du domaine (`generateBracket`, `keepPlaces`) : rien côté serveur, mais il
  faudrait refaire le choix du format, les options, le « même club », les places gardées ; un écart avec le serveur afficherait
  un tableau faux. Écartée.
- C. Le tableau actuel sans le combattant, qui n'apparaît que dans la liste (« arrive ») : le plus simple, mais en deçà de la
  maquette validée. Écartée.

Le reste (fiches, copie, lien galaxie) n'a qu'une manière sensée : à partir des données que l'écran a déjà ou peut charger
(inscriptions, catégories, pesée). 💡 Les **colonnes De et Vers elles-mêmes** (membres, infos, tableaux) viennent en revanche
de la réponse du serveur (§7) : dans le plan, la catégorie de départ ou d'arrivée d'une ligne peut déjà avoir été changée par
les lignes précédentes, ou ne pas encore exister à l'écran (`new:…`). 💡

## 4. Où

- **Section ② « Cas un par un »** : chaque proposition d'une carte (`replacement-proposal`, rendue avec `MoveBlocks`) reçoit
  « Détails » et « Copier pour le club ». Une carte peut avoir plusieurs propositions : chacune a ses propres détails (De et
  Vers diffèrent). ✅ (les deux sortes de cartes, proposé et non contesté)
- **Section ① « Plan automatique »** : chaque ligne du plan (`plan-move`) reçoit les mêmes deux boutons. ✅
- Les propositions refusées (grisées) et le sélecteur « Déplacer manuellement vers… » n'en ont pas. 💡

Les boutons se placent avec les autres boutons de la proposition : « Détails ▾/▴ », « 📋 Copier pour le club », puis les
boutons existants (Aperçu, Valider, Refuser… ; Valider, Refuser, Modifier… dans le plan). ✅ (maquette)

## 5. Le dépliant « Détails »

Fermé par défaut ; rien n'est chargé ni calculé tant qu'il est fermé. À l'ouverture, une requête (§7) rapporte De et Vers ;
**spinner** dans les deux colonnes pendant ce temps (✅ spinner). Plusieurs dépliants peuvent être ouverts à la fois. 💡
Leur état ouvert/fermé est un état d'écran (perdu au rechargement). 💡

Sous la proposition, deux colonnes **De** et **Vers** (bordure d'accent sur Vers) ; sur écran étroit, l'une sous l'autre. ✅

Chaque colonne :
- Étiquette « De » / « Vers », libellé de la catégorie.
- Une ligne d'infos : session, zone, format (effectif), état (pas commencée / en cours / terminée), nombre de combattants
  actifs. Pour Vers : « n combattants (n+1 avec lui/elle) ». ✅ (maquette)
- Le sélecteur **« Combattants | Tableau »**, ouvert sur « Combattants » dans les deux colonnes. ✅ (proposé, « ok »)
- Le lien **« ✦ Voir dans la galaxie ↗ »**, qui ouvre Tableaux en vue galaxie centrée sur cette catégorie
  (`/competitions/:id/tableaux?vue=galaxie&categorie=<id>`, session gardée par `withSession`), **dans un nouvel onglet**, pour
  ne perdre ni le dépliant ni les choix du plan. 💡 (annoncé, non contesté)

### 5.1 Vue « Combattants »

Une ligne par combattant de la catégorie : « NOM Prénom · Club », poids à droite (pesé, sinon ≈ déclaré). ✅ (maquette)
- Dans **De**, le combattant déplacé est en tête, sur fond orange clair, marqué « part ». ✅
- Dans **Vers**, le combattant déplacé est ajouté à la liste (dernier), marqué « arrive ». ✅
- Pour un « split » (plusieurs combattants déplacés ensemble, `alsoMoved`), tous sont marqués de la même façon. 💡
- Les absents restent listés, marqués « absent » et grisés. 💡
- Un clic sur une ligne déplie sa fiche juste dessous ; un autre clic la referme ; plusieurs fiches à la fois. ✅

### 5.2 Vue « Tableau »

- **De** : le tableau de la catégorie **juste avant** ce déplacement (pour une carte : le tableau actuel ; pour une ligne du
  plan : après les lignes précédentes), composant `BracketView` en lecture. Le combattant qui part y figure, marqué comme dans
  la liste si le composant le permet sans refonte. 💡
- **Vers** : le tableau **après** le déplacement (§7). Le combattant qui arrive est surligné en orange. ✅ En cas d'erreur, le
  message d'erreur habituel (`ApiErrorAlert`) dans la colonne, avec un bouton « Réessayer ». 💡
- Une catégorie sans tableau (catégorie fermée, vide…) : un texte « Pas de tableau pour cette catégorie ». 💡
- Un clic sur un nom du tableau affiche sa fiche **sous le tableau** (une à la fois ; un autre clic sur le même nom la
  referme). ✅ Le nom choisi est surligné dans le tableau. ✅ (maquette)
- Il n'y a **pas** de liste des combattants sous le tableau. ✅

## 6. La fiche d'un combattant

Pas de section club (✅). Contenu, en lignes « libellé · valeur » ✅ (maquette v3), une valeur absente s'écrit « — » :

| Ligne | Source |
|---|---|
| Sexe · âge | `fighter.sex`, libellé de la tranche (`ageBandLabel`) |
| Licence | `fighter.licence` |
| Grade | `fighter.grade` |
| Présence | présent / absent / non pointé, + « pesé X kg » et « (déclaré ≈ Y kg) » quand ils existent (pesée, `approxWeightKg`) |
| Discipline | discipline · règlement · catégorie de poids **de cette inscription** |
| Accepte aussi | `otherDisciplines` dans l'ordre (« A, puis B ») ; « accepte le jiyu en priorité » si shobu et `acceptsJiyuFirst` |
| Origine | `SOURCE_LABELS[source]`, + « confirmé FFK ✓ » si `ffkConfirmed` |
| Réaffecté | si une réaffectation validée existe (`useRecasementDetails`) : d'où il vient |
| Autres inscriptions | les autres inscriptions du même combattant (discipline, catégorie, session), sinon « aucune » |
| Ne combat pas | si `withdrawn` |

La présence de n'importe quel combattant (pas seulement ceux des cas) vient de la liste de pesée de toute la compétition
(`useWeighIn(id)` sans session) ou d'une source équivalente ; la catégorie (`absentIds`) suffit pour « absent ». 💡

## 7. De et Vers calculés par le serveur

Nouvelle route en lecture : `POST /api/competitions/:id/replacement/details/preview` (le suffixe `/preview` l'exclut de l'événement « change », comme les autres aperçus). Elle répond, pour un déplacement, la
catégorie de départ **juste avant** lui et la catégorie d'arrivée **juste après** lui, chacune avec ce qu'il faut pour
l'écran : id (absent pour une catégorie qui n'existe pas encore en base), libellé, session, zone, format effectif, état,
membres (inscriptions, absents compris et marqués), tableau (`bracket`, pour `BracketView`), et les inscriptions qui bougent.
Rien n'est écrit : tout se passe dans un `dryRun` (rollback ; ni historique ni journal ne restent). 💡

Deux formes de corps :

- **Carte (②)** : `{ proposalId }` (comme `/replacement/preview`). Dans le `dryRun` : lire l'état (De = avant), appliquer la
  proposition comme l'action réelle (`persistAll`, comme `applyProposalById`), lire la catégorie où se trouve ensuite le
  combattant (Vers = après).
- **Ligne du plan (①)** : `{ plan: { waveId, choices, cardDecisions, hash }, moveId }`. Le serveur retrouve **le plan affiché**
  (pas le plan « à appliquer » : le plan affiché contient aussi les déplacements à valider), vérifie son `hash`, puis dans le
  `dryRun` **rejoue ses lignes dans l'ordre jusqu'à `moveId`** avec exactement l'écriture d'`applyPlan` (rechargement de l'état,
  catégorie `new:…` retrouvée par l'ancre, `persistAll`). De = la catégorie de départ juste avant la ligne `moveId`, Vers = sa
  catégorie d'arrivée juste après. ✅ (B)
  - Le corps de boucle d'`applyPlan` devient une fonction partagée par `applyPlan` et cette route : une seule écriture, donc
    un aperçu identique à l'application. 💡
  - Le plan affiché : gardé en mémoire côté serveur à la fin de chaque calcul (clé : son `hash` et l'empreinte de l'état), pour
    ne pas relancer la recherche à chaque dépliant ; s'il n'y est plus (redémarrage, autre état), recalculé dans le fil du plan
    (`runPlanJob`, sans `forApply`) — le spinner couvre ce temps. Un `hash` qui ne correspond plus → « Le plan a changé :
    relisez-le » (erreur habituelle de plan périmé), et l'écran recalcule comme d'habitude. 💡
  - Une ligne « Modifier » (choix manuel) passe par le même rejeu, donc par `persistAll` comme à l'application. 💡

**Tirage d'une catégorie nouvelle rendu déterministe** ✅ : aujourd'hui une catégorie créée reçoit une graine au hasard
(`persist` dans `replacement.ts`, `syncCategories` dans `categories.ts`), donc le tirage montré à blanc ne serait pas celui
de l'application réelle. La graine d'une catégorie créée devient une fonction stable de la compétition et de sa clé
(`keyString`) ; le dry-run et l'application tirent donc le même tableau. « Nouveau tirage » garde une graine au hasard
(différente de l'ancienne), et les tableaux libres ne changent pas. 💡 Ce changement touche l'écriture réelle : tests dédiés
(même graine pour la même clé, tirage identique entre dry-run et application, « Nouveau tirage » toujours différent). 💡

Côté écran : une requête par ouverture de « Détails », gardée en cache tant que l'état ne change pas (clé : `fingerprint` de
la réaffectation, et pour le plan `hash` + `moveId`), invalidée avec les données de réaffectation. 💡 Le `dryRun` prend le
verrou d'écriture (`BEGIN IMMEDIATE`) comme `sameClubPreview` ; le rejeu d'un long plan le tient plus longtemps : mesurer sur
le plus gros jeu de test et le signaler s'il dépasse ~1 s. 💡

## 8. « 📋 Copier pour le club »

Met dans le presse-papiers une ligne par combattant déplacé (un seul en général ; plusieurs pour un split) ✅ (format
proposé et montré dans la maquette, non contesté). Pour un split, **chaque ligne décrit le déplacement de ce combattant-là**,
avec ses propres règles et leurs détails (aujourd'hui `detailsOf` ne les calcule que pour le premier ; `pulledRules` donne les
règles des autres sans détail : un petit ajout les calcule pour chacun). 💡 (annoncé à l'utilisateur, non contesté)

`Prénom Nom - Club - <catégorie de départ> : <règles> (vers <catégorie d'arrivée>)`

- Prénom puis Nom, dans cet ordre (✅ demandé : « Prenom Nom »). Sans club : « sans club ».
- Catégorie de départ et d'arrivée : leurs libellés tels que l'appli les affiche (`categoryLabel`, les « · » compris). 💡
- `<règles>` : pour chaque règle du déplacement, `RULE_LABELS[règle]` suivi de son détail (« Tranche d’âge au-dessus
  Cadets → Juniors »), séparées par « ; ». ✅ (format de l'exemple de l'utilisateur ; « ; » proposé)
- Sans règle (correction imposée : retour, pesée) : le texte « Pourquoi » de la carte (`whyText`) à la place. 💡
- Après la copie : une notification verte « Copié : <texte> ». ✅ (maquette) Si le presse-papiers est refusé par le
  navigateur, notification d'erreur avec le texte, pour le copier à la main. 💡

Exemple : `Lucas MARTIN - Karaté Club Rennes - Combat · Jiyu · Cadets M · -60 kg : Tranche d’âge au-dessus Cadets → Juniors (vers Combat · Jiyu · Juniors M · -60 kg)`

## 9. Contraintes

- Interface en français, accords au genre comme le reste de l'écran (« lui/elle », « part », « arrive »).
- Thème clair et sombre : uniquement les variables `--sk-*` existantes.
- Écran étroit : colonnes l'une sous l'autre, rien qui déborde ; vérifié aussi en simulateur iOS (habitude du projet).
- Les détails fermés ne coûtent rien : aucune requête, aucun calcul.
- Chaque changement visible vérifié dans Chrome (habitude du projet), tests e2e Playwright comme pour les autres écrans.
- Ne jamais ouvrir la base vivante depuis l'hôte (passer par l'API).

## 10. Laissé au constructeur

- Découpage en composants (un composant « détails de proposition » partagé par ① et ②, une « fiche combattant »
  réutilisable), et noms de fichiers.
- Comment marquer les combattants « part »/« arrive » et le nom choisi dans `BracketView` (props existantes de mise en
  valeur, ou petit ajout).
- La forme exacte de la réponse de la route §7 et sa validation (zod), ses tests.
- Les `data-testid` des nouveaux éléments.
- L'emplacement des textes d'aide, s'il y en a (`HELP`).
