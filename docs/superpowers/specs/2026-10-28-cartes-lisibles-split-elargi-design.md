# Réaffectation : cartes lisibles, split élargi, remise à zéro par session — conception

Date : 2026-10-28. Suite de `2026-10-27-plan-reaffectation-lisible-design.md` (étape 30) et du plan d'ensemble
(`2026-10-25-plan-d-ensemble-reaffectation-design.md`), après un essai de l'utilisateur sur la compétition de démo.
✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant). Étape 31 de la feuille de route.

## 1. Pourquoi

Quatre problèmes constatés :

1. **Une proposition ne se comprend pas.** Sur une carte comme sur une ligne du plan, le changement tient dans une ligne de
   petit texte peu contrasté (« GIRARD Emma : Karaté · Jiyu · Minimes F · -40 kg → Karaté · Jiyu · Minimes F · -45 kg — il y
   sera seul… ») : on distingue mal la catégorie de départ de celle d'arrivée, ce qui change entre les deux, et pourquoi on le
   propose.
2. **Le split est trop étroit.** ROUSSEAU Tom (minime M, pesé 45 kg, Karaté · Jiyu · Minimes M · -50 kg) reste seul alors que
   GARNIER Sacha (benjamin M, pesé 40 kg) pourrait le rejoindre : tranche d'âge voisine, 5 kg d'écart, et il resterait deux
   combattants chez les Benjamins -40 kg. Le split ne prend aujourd'hui que dans la même tranche d'âge et la catégorie de poids
   juste en dessous (`pullProposals`, `src/domain/replacement/propose.ts`) ; ✅ l'utilisateur n'a jamais demandé cette
   restriction. (L'autre voie, ROUSSEAU Tom chez les Benjamins -40 kg, est refusée à raison : l'écart se mesure sur toute la
   catégorie d'arrivée, 45 − 39 = 6 kg > 5 kg.)
3. **« Repartir de zéro » ne paraît pas dangereux** (bouton neutre) alors qu'il défait tout, et il agit sur toute la compétition
   alors qu'on travaille session par session.
4. **Le texte sous la coche « Tenir compte des décisions prises sur les cartes » se lit à l'envers** : « Décochée : le plan
   reprend les propositions refusées… » laisse croire que décochée, le plan *tient compte* des refus.

**Réussi si**, à la table centrale, en un coup d'œil sur une carte ou une ligne du plan : on voit d'où vient le combattant, où il
va, et pourquoi ; le calcul trouve le split GARNIER Sacha → ROUSSEAU Tom de la démo ; on ne peut pas remettre à zéro par
mégarde, ni toucher une autre session que celle qu'on regarde.

**Échec même si « ça marche » :** une carte où il faut encore lire la catégorie entière deux fois pour trouver la différence ;
un split qui contourne une règle désactivée ou au-delà de la ligne ; une remise à zéro qui bouge un combattant d'une session
lancée ou une action décidée depuis une autre session.

## 2. Présentation d'une proposition (cartes et plan)

✅ Maquette « A2 » (blocs « De » ➜ « Vers »), ✅ **la même sur les cartes et sur les lignes du plan**. De haut en bas :

1. **Le nom** du combattant (et, pour un split à deux, « + » le second) et son club — inchangé.
2. **Une ligne « Pourquoi »**, en texte normal (pas grisé), étiquette « POURQUOI » en petites capitales :
   - pesée hors catégorie : « Pesé(e) à 41 kg : trop lourd(e) pour -40 kg (tolérance 0,5 kg) » ;
   - seul : « Seul(e) dans sa catégorie » ;
   - split : « Donner un adversaire à ROUSSEAU Tom, seul en Minimes M · -50 kg » (« une poule » pour deux combattants) ;
   - retour : « Retour dans sa catégorie d'origine (elle a de nouveau des combattants) » 💡 ;
   - catégorie fermée : « Inscrit(e) dans une catégorie fermée » 💡 ;
   - choix manuel dans le plan : « Choisi à la main » 💡.
   💡 Accords (seul / seule, pesé / pesée) d'après le sexe du combattant, comme les textes actuels.
3. **Deux blocs côte à côte**, « DE » ➜ « VERS » (étiquettes en petites capitales, flèche à l'accent violet) :
   - chaque bloc donne la catégorie entière (« Karaté · Jiyu · Minimes F · -40 kg »), ✅ **ce qui change surligné** (fond accent,
     texte gras) : discipline, règlement, sexe, tranche(s) d'âge, catégorie(s) de poids — seuls les morceaux qui diffèrent ;
   - sous « DE » : combien de combattants il y a, et combien il en restera (« 3 combattants → il en restera 2 ») 💡 ;
   - sous « VERS » : avec qui (« avec ROUSSEAU Tom » ; au-delà de deux noms 💡 « 3 adversaires »), et l'écart de poids de la
     catégorie d'arrivée face au maximum (« écart 5 kg (max 5) ») quand la discipline a des poids ; ou ✅ « vide : il y sera
     seul, à réaffecter ensuite » en couleur d'attention ;
   - « VERS » est la catégorie **telle qu'elle sera après** le déplacement (tranches et poids réunis), comme le texte actuel
     (`arrivalKey`) ; le surlignage compare la catégorie de départ du combattant à celle-ci.
   - 💡 Sur un écran étroit, les deux blocs passent l'un sous l'autre (flèche vers le bas) ; pas de défilement horizontal.
4. ✅ **Les pastilles des règles utilisées, sur toutes les propositions sans exception**, aux couleurs du plan (celles de
   l'étape 30, règle la plus coûteuse marquée comme dans le plan). Une correction qui s'impose (pesée hors catégorie vers la
   catégorie de son poids réel, retour) a une pastille neutre ✅ « Correction de pesée · imposée » / 💡 « Retour · imposé ».
5. Les badges existants (pré-accord coach, changement de session) restent, sous les pastilles 💡.
6. Les boutons : cartes « Aperçu / Valider / Refuser », plan « Valider / Refuser / Modifier / Annuler… » — inchangés.

Une proposition refusée (barrée, carte) garde une présentation courte sur une ligne 💡 (elle n'est plus à décider).
L'historique des réaffectations garde son tableau, 💡 avec « De » et « Vers » surlignés de la même façon s'il reste simple à
faire ; sinon inchangé.

Le texte est plus grand et plus contrasté qu'aujourd'hui (taille « sm » au moins pour le contenu des blocs, jamais « dimmed »
pour De / Vers / Pourquoi) 💡. Lisible en clair et en sombre (jetons `--sk-*`).

**Données.** Les propositions (`Proposal`) et les lignes du plan (`PlanMove`) portent aujourd'hui un texte `reason` tout fait.
Il leur faut des données structurées pour cette présentation : clé de départ, clé d'arrivée (après déplacement), nombre de
combattants au départ et qui reste, adversaires à l'arrivée, écart et maximum, pourquoi (sorte + valeurs : poids pesé, limite,
tolérance, combattant seul servi). 💡 `reason` reste (historique, journal, tests existants) ; le surlignage se calcule côté
écran par comparaison des clés, une fonction pure testée.

## 3. Split élargi

✅ Le split fait venir un (ou deux, pour une poule) combattant(s) de **n'importe quelle catégorie** vers le combattant seul,
**à condition que ce déplacement respecte les règles comme s'il était proposé seul** :

- ✅ chaque différence passe par sa règle : tranche d'âge au-dessus / au-dessous, mélange seniors / vétérans, autre discipline
  (préférences du combattant déplacé), shobu → jiyu, mélange filles / garçons, mélange mineurs / adultes — **toutes les règles
  actives**, et pour le plan, seulement celles au-dessus de la ligne de coupure (comme tout déplacement) ;
- ✅ l'écart de poids se mesure sur **toute la catégorie d'arrivée** et reste dans le réglage, sauf si la règle « écart de poids
  au-dessus du réglage » s'applique (mêmes conditions qu'aujourd'hui dans `evaluate`) ;
- ✅ il reste au moins deux combattants actifs dans la catégorie de départ ;
- ✅ **un combattant peut descendre vers une catégorie plus légère** (la restriction actuelle tombe) : seules les règles et
  l'écart décident ;
- ✅ entre plusieurs candidats, on préfère celui dont **le poids est le plus proche** de celui du combattant seul. 💡 Chaque
  candidat permis donne sa propre proposition (pas seulement le plus proche, ni un par catégorie) ; elles sont classées par
  coût des règles d'abord, puis par poids le plus proche, puis par nom : le calcul du plan voit ainsi un candidat un peu plus
  éloigné mais moins coûteux ;
- 💡 pour une poule (deux combattants venus), **les deux viennent de la même catégorie de départ** (comme aujourd'hui), les deux
  plus proches en poids parmi ses candidats permis ;
- 💡 « respecte les règles comme s'il était proposé seul » se prend au pied de la lettre : `evaluate` sert tel quel, donc dans la
  même tranche d'âge et le même sexe, seules la catégorie de poids du combattant et ses deux voisines sont possibles (comme pour
  tout déplacement) ;
- ✅ jamais un combattant **déjà déplacé pour de vrai** (carte validée, plan appliqué : placement verrouillé) ni un combattant
  déjà pris par un choix de l'organisateur dans le plan (`excluded`) ;
- ✅ les **refus et mises de côté** suivent la coche « Tenir compte des décisions prises sur les cartes », comme pour tout le
  plan : cochée, une proposition de split refusée sur une carte n'est pas reprise, et 💡 un combattant dont la carte est mise
  de côté n'est pas pris par un split ; décochée, les deux redeviennent possibles. ✅ Les validations restent toujours fixes.

✅ **Seulement les disciplines avec catégories de poids** : pas de split pour le kata (ni pour un combattant seul en kata, ni
pour faire venir un katateka), comme aujourd'hui.

**Règles d'un split.** Une proposition de split utilise « split » **plus** les règles du déplacement du combattant venu
(`ruleProfile` de ce déplacement, sans la règle de base « Catégorie de poids voisine »). Son coût dans le plan est celui de la
plus coûteuse (comme toute proposition) : ✅ le split n'est pas « appliqué en dernier », sa place dans la liste des règles fixe
son prix, et le calcul compare des combinaisons entières (le moins de seuls d'abord, puis les règles les moins coûteuses).
Si une de ces règles est désactivée, le split n'est pas proposé.

✅ Libellé de la règle : « Split (autre catégorie) » au lieu de « Split de la catégorie du dessous » ; 💡 l'aide (ⓘ) est
mise à jour.

**Coût du calcul.** Beaucoup plus de candidats possibles : le calcul a une limite fixe de nœuds (`DEFAULT_NODE_BUDGET`).
💡 Vérifier avec `npm run test:perf` que la durée et la qualité du plan ne se dégradent pas sur les jeux existants ; si oui,
limiter les candidats (par exemple garder, par catégorie source, les candidats les plus proches en poids) plutôt que de
monter la limite.

**Exemple de la démo** (test) : GARNIER Sacha, Benjamins M -40 kg (présents : GARNIER Sacha 40, GUERIN Louis 39, RICHARD Tom 39)
→ Minimes M -50 kg avec ROUSSEAU Tom 45 : écart 5 kg ≤ 5, il reste 2 benjamins ; règles « split » + « tranche d'âge
au-dessus ».

## 4. Coche « Tenir compte des décisions prises sur les cartes »

✅ Comportement inchangé : elle ne concerne que les **refus** et les **cartes mises de côté** ; les validations sont des
déplacements réels et restent fixes.

✅ Nouveau texte sous la coche : « Décochée : le plan ignore vos refus et vos mises de côté sur les cartes, et peut donc vous
reproposer ces déplacements (les cartes, elles, restent telles quelles). » Même idée dans l'aide (`src/web/help.ts`).

## 5. « Repartir de zéro » par session

### 5.1 Le bouton

- ✅ **En rouge** (action qui détruit), comme les autres actions dangereuses de l'app ; le bouton de confirmation de la fenêtre
  aussi.
- 💡 Libellé avec la session : « Repartir de zéro (session Matin) » ; sans sessions : « Repartir de zéro ».
- 💡 La fenêtre dit combien de réaffectations seront annulées, et cite les combattants laissés en place (§5.3).
- 💡 Grisé, avec la raison en une phrase, quand la session choisie est lancée ou qu'il n'y a rien à défaire dans cette session.

### 5.2 Ce qui est remis à zéro

✅ **Seulement les actions décidées depuis la session sélectionnée** sur la page au moment de la décision (le sélecteur de
session en haut de la page Réaffectation) :

- les réaffectations validées (carte validée, ligne de plan appliquée, déplacement manuel, « Ne combat pas ») décidées depuis
  cette session : annulées, de la plus récente à la plus ancienne, et leur historique effacé ;
- les refus et les cartes mises de côté de cette session : effacés ;
- ✅ un combattant venu d'une autre session vers celle-ci n'est pas touché (décidé depuis l'autre session) ;
- ✅ un split appartient à la session où il a été décidé ;
- sans sessions dans la compétition : tout, comme aujourd'hui.

💡 **Enregistrer la session de chaque action** : colonne `wave_id` (nullable) sur `recasements`, et de quoi retrouver la
session des refus et des mises de côté (colonne ou déduction depuis le cas). L'écran envoie la session sélectionnée avec chaque
validation, application du plan, refus, mise de côté, déplacement manuel. Pour les lignes déjà en base (sans session) : la
session de la catégorie de départ (`snapshot.registration.categoryId`) ; si elle a disparu, celle de la catégorie actuelle.

💡 Les choix du plan gardés sur le poste (`usePlanChoices`, `usePlanCardDecisions`) ne sont oubliés que pour cette session.

### 5.3 Ce qui n'est pas touché, et quand c'est refusé

- ✅ Une réaffectation qui a placé un combattant **dans une session verrouillée** (lancée, catégories figées) n'est pas annulée :
  le combattant reste, avec son historique ; la fenêtre le cite (« GARNIER Sacha reste en Minimes M -50 kg : la session
  Après-midi est lancée »). Le reste de la remise à zéro se fait.
- 💡 Même traitement, dans n'importe quelle session (la sélectionnée comprise), pour une réaffectation dont l'annulation
  toucherait une **catégorie commencée ou terminée** : laissée en place, citée (« … : sa catégorie a commencé »), le reste se
  fait. (Aujourd'hui la remise à zéro est alors refusée en entier ; on aligne sur la règle de l'utilisateur pour les sessions
  verrouillées.)
- 💡 La session sélectionnée elle-même lancée : bouton grisé (§5.1).
- 💡 Une annulation impossible parce qu'une réaffectation plus récente, décidée depuis une autre session, concerne le même
  combattant (même contrôle que « Annuler » dans l'historique) ou dépend des clés de catégorie qu'elle rétablit : refus en
  entier, avec un message qui nomme le combattant qui bloque.
- Tout ou rien pour ce qui est annulé (une transaction), comme aujourd'hui.

`resetReplacement` (`src/server/repositories/replacement.ts`) prend la session ; `hasReplacementTrace` devient « quelque chose à
défaire dans cette session ». La Table centrale garde le droit de le faire.

## 6. Hors champ

- Le calcul de l'écart de poids (toujours sur toute la catégorie d'arrivée).
- Les règles « tranche d'âge au-dessus / au-dessous » elles-mêmes, la ligne de coupure, le diagramme.
- Le split en kata (✅ ignoré).
- Un « Repartir de zéro » de toutes les sessions d'un coup (la page n'a pas de choix « toutes les sessions » ; sans sessions, il
  vaut pour toute la compétition).

## 7. Laissé au constructeur

Noms et forme des données structurées, découpage des composants (un composant commun « De ➜ Vers » pour les cartes et le plan,
`src/web/components/replacement/`), migration, détails de la fenêtre de confirmation, tests (unitaires du split et du surlignage,
remise à zéro par session avec session lancée et action d'une autre session, e2e de la carte et du bouton rouge), mise à jour de
l'aide, de la conception principale, du bilan et de la feuille de route (étape 31).
