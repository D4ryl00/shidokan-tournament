# Finales : où et quand, catégorie par catégorie — conception

Date : 2026-11-08 (premières décisions, pendant le mode spectateur), reprise et complétée le 2026-11-11.
Touche l'ordre de passage (`2026-10-22-ordre-de-passage-et-aides-design.md`, code `src/domain/passages/`), le figeage des
sessions (étape 13), la ligne de temps du mode spectateur (`src/domain/schedule/timeline.ts`, spec
`2026-11-08-mode-spectateur-design.md` §5.3) et les Réglages de la compétition.

✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant).

## 1. Pourquoi

Aujourd'hui, la place des finales est un réglage de la compétition (Réglages → « Ordre de passage ») :

- sans zone des finales : en « catégorie par catégorie », la finale suit sa catégorie sur sa zone ; en « tour par tour »,
  les finales passent en dernier sur chaque zone ;
- avec une zone des finales (`settings.finalsZoneId`) : toutes les finales de combat de la session y passent, après les
  combats propres à cette zone, dans l'ordre des catégories ; la case « Finales de kata aussi sur cette zone »
  (`kataFinalsOnFinalsZone`) y ajoute les finales de kata (sinon un kata est un seul bloc : tour 1 et finale d'affilée).

L'organisateur veut plus de souplesse ✅ : par exemple un ring d'honneur qui accueille aussi le shido-boxing, où l'on joue
certaines finales dès qu'elles sont prêtes, devant tout le monde, et d'autres en fin de session. Il n'y aura pas toujours
de ring ✅ : la zone des finales est une zone quelconque de la compétition.

## 2. Ce qu'on construit

### 2.1 Deux choix par catégorie, une zone des finales par session ✅

- **Par session** : une **zone des finales**, choisie parmi les zones de la compétition, ou « Aucune » ✅.
- **Par catégorie** (de la session) :
  - **Où** : « Sa zone » ou « [nom de la zone des finales] » ✅ ;
  - **Quand** : « Dès que finie » ou « Fin de session » ✅.
- Le kata suit exactement la même règle que les combats ✅ ; la case « Finales de kata aussi sur cette zone » disparaît ✅.
  Pour un kata, « la catégorie est finie » veut dire « le tour 1 est fini » ; la finale de kata est le bloc `kata:finale`.

### 2.2 Ordre de passage qui en découle

Les numéros restent calculés au figeage (« Figer et imprimer la session »), comme aujourd'hui ; ce qui suit décrit l'ordre
dans lequel `orderWave` les range.

Sur une zone qui n'est pas la zone des finales :
- finale « Sa zone » + « Dès que finie » : juste après le dernier combat (ou le tour 1) de sa catégorie, quel que soit
  l'ordre de passage (« tour par tour » compris) 💡 ;
- finale « Sa zone » + « Fin de session » : à la fin de la file de la zone pour la session, après tous ses combats non
  finaux, dans l'ordre des catégories.

Sur la zone des finales ✅ :
- d'abord **tous ses combats propres** (non finaux), sans exception ✅ (« on pourra faire les finales des autres zones une
  fois que les combats de shido-boxing sont finis ») ; les finales de ses propres catégories passent avec les autres
  finales, après tous ses combats, pour laisser ses combattants se reposer ✅ ;
- puis les finales « Dès que finie », rangées dans l'ordre où leurs catégories se terminent d'après les heures estimées du
  mode spectateur (ordre des catégories à défaut d'heures) 💡 ;
- puis les finales « Fin de session », dans l'ordre des catégories ; la première attend en plus la fin de tous les combats
  éliminatoires de la session, ou l'heure « Finales à » si elle est saisie (comportement actuel de la ligne de temps) ✅.
- Si la zone des finales n'a aucun combat à elle, chaque finale « Dès que finie » y passe dès que sa catégorie est
  terminée 💡.
- Une catégorie dont la zone est déjà la zone des finales n'a pas de choix « Où » (affiché « sur [zone] ») ✅.
- Une zone des finales qui n'accueille pas la discipline d'une catégorie (zones limitées à certaines disciplines) : « Où »
  est bloqué sur « Sa zone », avec la raison (« Tatami 3 n'accueille pas le kata ») 💡 (règle actuelle `finalsOf`).

Kata 💡 : « Sa zone » + « Dès que finie » garde le bloc unique d'aujourd'hui (un seul passage, tour 1 et finale d'affilée),
sauf pour un kata dont la zone est la zone des finales : il est toujours séparé (tour 1 avec les passages propres de la
zone, finale après eux), pour la règle de repos ci-dessus et comme le fait aujourd'hui `kataSplit`. Tout autre choix sépare `kata:tour1` et `kata:finale` (un kata à deux concurrents n'a que `kata:finale`), placés selon les
règles ci-dessus.

« Quelle est la finale d'une catégorie » ne change pas : `finalMatchIds` (finale du tableau, grande finale, combat pour la
1re place d'une poule de trois avec repêchage, manches d'un meilleur des trois). Une poule unique n'a pas de finale : ses
choix sont simplement sans effet.

### 2.3 Une finale prête avant son tour ✅

- Les numéros figés ne bougent jamais ✅ (ils sont imprimés).
- Dans Combats, une finale dont les deux finalistes sont connus alors que des passages la précèdent encore sur sa zone
  porte la mention « Prête · peut passer plus tôt » 💡 (vaut pour toute zone, pas seulement la zone des finales). Son
  résultat se saisit comme d'habitude, hors ordre.
- Heures estimées ✅ : une finale jouée en avance **décale automatiquement** les passages restants de la zone ; aucune heure
  estimée ne doit tomber dans le passé. Aujourd'hui, `buildTimeline` traite tout passage non joué situé avant le dernier
  joué comme « saisi en retard » (sans heure) : ce cas doit être distingué. Une finale jouée en avance ne rend pas « en
  retard » les passages qui la précèdent ; ils restent « à venir » et repartent de la fin de cette finale (+ changement).
  L'algorithme exact est laissé au constructeur, avec cette règle et la règle existante « aucune heure ≤ maintenant n'est
  montrée publiquement ».
- Attente des finales « Fin de session » dans les heures estimées 💡 : sur la zone des finales, la première attend la fin de
  tous les combats éliminatoires de la session ou « Finales à » (§2.2). Sur les autres zones, si « Finales à » est saisi, la
  première finale « Fin de session » de chaque zone l'attend aussi ; sans « Finales à », elle se joue simplement à la fin
  de la file de sa zone, sans attendre les autres zones. Le champ « Finales à » reste donc affiché même sans zone des
  finales.

## 3. L'écran : onglet « Finales » ✅

Nouvel onglet **« Finales »** dans l'étape **« Préparer »**, juste après « Sessions » ✅ (pas dans Catégories, qui règle la
grille et non les catégories réelles ; pas dans Sessions, qui ne fait que répartir les catégories ; pas dans « Jour J » ✅).

Maquette retenue : la version **A** ✅ (`.superpowers/brainstorm/…/content/finales-session-v2.html`, non versionnée) :

```
[ Session du matin | Session de l'après-midi ]        ← sélecteur, absent sans session

Zone des finales  [ Tatami 3 ▾ ]   « Aucune » : chaque finale reste sur la zone de sa catégorie.

Catégorie                      Zone      Où                               Quand
                                         [Tout sur Tatami 3][Tout sur sa zone]  [Tout dès que finie][Tout en fin de session]
Combat Benjamins M −35 kg      Tatami 1  (Sa zone | Tatami 3)             (Dès que finie | Fin de session)
Kata Minimes F  [finale = tour 2] Tatami 2 (Sa zone | Tatami 3)           (Dès que finie | Fin de session)
Shido-boxing Seniors M −75 kg  Tatami 3  sur Tatami 3                     (Dès que finie | Fin de session)
Combat Cadets F −54 kg [poule unique]  Tatami 1  pas de finale (poule)

Tatami 3 : 14 combats, puis 1 finale dès que prête, puis 2 finales en fin de session.
Tatami 2 : 1 finale de kata juste après son tour 1.
```

- Interrupteurs à deux positions (SegmentedControl) par ligne ✅, deux boutons « Tout… » au-dessus de chaque colonne ✅.
- Les libellés reprennent le nom de la zone choisie ✅.
- Choisir une zone des finales met **toutes** les catégories de la session sur cette zone ✅ ; « Aucune » fait disparaître
  la colonne « Où » ✅ (il ne reste que « Quand »).
- Colonne « Zone » : la zone actuelle de la catégorie (épinglée ou répartie par l'app).
- Résumé par zone en bas du tableau (ce que chaque zone jouera) ✅.
- « Pas de finale (poule) » n'est affiché que si le tableau existe déjà et n'a pas de finale ; avant la pesée, toutes les
  catégories ont leurs interrupteurs 💡.
- Session figée : tableau en lecture seule, avec « Rouvrez la session dans Combats pour changer » ✅ (un changement
  changerait des numéros imprimés).
- Session rouverte ✅ (recommandation acceptée) : le tableau redevient modifiable. Une catégorie dont un choix a changé
  depuis le figeage (Où, Quand, ou zone des finales de la session) devient « à numéroter » ; il faut donc garder, au
  figeage, les choix de chaque catégorie pour voir le changement (`stillValid` seul ne le voit pas : un changement de
  « Quand » ne change ni les combats ni la zone). À « Refiger la session », chaque zone touchée est renumérotée
  « mélangés » (`reshuffleZone` : passages non joués de la zone, dans le nouvel ordre ; les passages joués gardent leur
  numéro), et non « à la suite », qui mettrait une finale « Dès que finie » au bout de la file. La fenêtre de refigeage dit
  quelles zones sont renumérotées.
- Enregistrement 💡 : à chaque changement (comme les horaires de session), avec les versions de ligne / 409 habituels du
  multi-postes.
- Poste 💡 : comme les autres onglets de « Préparer », réservé au poste Organisation (et aux comptes organisateur en rôle
  serveur) ; Table centrale et Zone ne le voient pas.
- Aide en ligne (`help.ts`) et guide utilisateur mis à jour 💡.

**Réglages** ✅ : « Finales sur la zone » et « Finales de kata aussi sur cette zone » disparaissent de « Ordre de passage » ;
une phrase y renvoie vers l'onglet Finales. « Ordre de passage des combats » (tour par tour / catégorie par catégorie)
reste.

## 4. Valeurs par défaut et reprise de l'existant

- Valeur par défaut ✅ (recommandation acceptée) : celle qui reproduit le comportement d'aujourd'hui. « Dès que finie »
  quand l'ordre de passage est « catégorie par catégorie » et que la session n'a pas de zone des finales ; « Fin de
  session » dans tous les autres cas. Vaut pour les compétitions existantes, les nouvelles compétitions et les nouvelles
  sessions ; « Où » vaut par défaut la zone des finales s'il y en a une.
- Une catégorie qui apparaît après coup (créée par la réaffectation, tableau libre, catégorie qui change de session) prend
  la valeur du dernier « Tout… » utilisé dans chaque colonne pour sa session ; sinon la valeur par défaut ci-dessus 💡.
- Migration 💡 : chaque session (ou la session implicite d'une compétition sans session) reprend `finalsZoneId` comme zone
  des finales ; ses catégories de combat vont sur cette zone ; ses katas aussi si `kataFinalsOnFinalsZone` était coché,
  sinon « Sa zone » + « Dès que finie » (bloc unique d'aujourd'hui). Les sessions déjà figées gardent leurs numéros
  (`frozen_passages`) sans changement.
- `finalsZoneId` / `kataFinalsOnFinalsZone` quittent les réglages une fois repris ; tout ce qui les lit aujourd'hui (plan des
  passages, vue publique `finalsZoneId`, ligne de temps) passe à la zone des finales de la session.

## 5. Ce qui doit suivre (à ne pas oublier)

- Paquet de synchronisation, sauvegardes / restauration, import d'un paquet d'avant (sans ces données : valeurs reprises
  comme à la migration), journal des portables de zone si concerné.
- Vue publique (mode spectateur) : la ligne « Finales de la session … » se place aujourd'hui avant la première finale de la
  zone des finales ; avec des finales « Dès que finie » mêlées, chaque passage de finale est plutôt marqué « Finale » 💡
  (au constructeur de trancher la présentation exacte, sans heure passée).
- `stillValid` (numéros figés encore à jour) doit accepter le nouveau découpage du kata et la zone des finales de la
  session.
- Impression de la session : la file de chaque zone suit le nouvel ordre ; rien d'autre à changer 💡.

## 6. Hors du champ

- Pas de renumérotation automatique quand une zone prend de l'avance ✅.
- Pas d'interdiction de changer les finales d'une session déjà figée une fois : on la rouvre, puis on refige (§3).
- Pas de réglage différent par session pour « tour par tour / catégorie par catégorie ».
- Pas de choix des finales depuis la page Combats (ni lecture, ni modification) en dehors de la mention « Prête ».

## 7. Laissé au constructeur

Schéma de stockage (colonnes sur `categories` et `waves`, ou table à part, valeur pour la session implicite), découpage en
tâches, calcul de l'ordre « dès que finie » sur la zone des finales (heures estimées au moment du figeage), algorithme de la
ligne de temps pour les passages joués hors ordre, textes exacts de l'aide.
