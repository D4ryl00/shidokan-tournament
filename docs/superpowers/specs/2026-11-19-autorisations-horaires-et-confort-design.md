# Autorisations des coachs, horaires estimés et confort du jour J

Date : 2026-11-19 · Compétition visée : 2026-11-22 · Statut : approuvé, réalisé le 2026-11-19 (étape 45 bis)

## 1. Pourquoi

Avec 250 combattants, la réaffectation bute sur un point : beaucoup de propositions du plan demandent l'accord d'un club
(âge, écart de poids, discipline). Tant qu'elles ne sont pas appliquées, on ne voit pas l'état final (qui reste seul), et
l'organisateur n'ose pas les appliquer sans accord. Il manque aussi la liste des accords à demander, construite avec les
critères de l'organisateur (skill `shidokan-club-messages`), et une idée de la durée de la journée pour savoir s'il faut
raccourcir les combats. Le reste est du confort repéré pendant la préparation.

L'organisateur a demandé de tout faire proprement, sans bâcler : il y a le temps avant dimanche.

## 2. Objectifs

1. **Autorisations en attente** : un déplacement qui demande un accord peut être appliqué « en attente d'autorisation » ;
   la planche montre alors l'état final. Les demandes sont listées par club ; chaque réponse est suivie (⏳ → Accordée /
   Refusée) ; « Refusée » défait le déplacement en cause.
2. **Historique lisible** : dans l'historique, les déplacements ont la même carte que les propositions (Pourquoi · De ➜ Vers
   · pastilles).
3. **« Voir le tableau »** à côté de « Voir dans la galaxie » ; dans Inscriptions, un bouton par inscription vers son tableau.
4. **Horaires estimés** de toutes les sessions, lancées ou non : début et fin par zone, finales, fin de journée ; recalcul
   immédiat quand on change les durées.
5. **Pesée** : tri par club, règlement (Jiyu / Shobu) et poids déclaré visibles.
6. **Tableaux** : barre d'outils (sessions, recherche, classement, « Seulement à traiter », Historique) **et pastilles de
   catégories** épinglées en haut ; la recherche fait défiler jusqu'au tableau au lieu de filtrer, et l'on passe d'un
   résultat à l'autre.

## 3. Non-objectifs

- Envoyer les demandes par mail depuis l'application (on copie le texte ; l'envoi reste au choix de l'organisateur).
- Changer le moteur du plan, ses règles ou ses seuils.
- Simuler des durées « pour voir » sans les enregistrer (les durées changées sont les vraies, modifiables à nouveau).

## 4. Anti-objectifs (échec même si « ça marche »)

- Une demande qui disparaît alors qu'elle est toujours nécessaire, ou une réponse « Accordée » qui couvre une situation pire
  que celle acceptée (ex. accord pour 7 kg, écart réel devenu 9 kg).
- Une demande inventée pour un combattant qui n'en a pas besoin selon les critères (ex. écart exactement 5 kg).
- Un « Refusée » qui défait silencieusement autre chose que ce que la fenêtre d'annulation a montré.
- Une barre épinglée qui cache le haut d'un tableau après le défilement.

## 5. Contraintes

- Interface en français, composants partagés de `src/web/components/ui/`, jetons `--sk-*`, clair et sombre, largeur téléphone.
- Toute donnée nouvelle suit les règles du projet : versions de lignes (`row-versions.ts`, If-Match/409), événements SSE,
  paquet de synchronisation (`src/server/sync/package.ts`), sauvegardes, journal des zones si concerné, « Repartir de zéro ».
- Postes : Table centrale peut faire ce qu'elle fait déjà en réaffectation ; un poste de Zone ne voit ni demandes ni réponses.
- Session lancée : ses catégories sont figées ; un refus qui demanderait de défaire un déplacement bloqué l'explique
  (motif `blocked` de l'historique) au lieu d'agir.
- Tests unitaires + e2e ; vérification visuelle sur Chrome (Claude in Chrome) de chaque changement visible.

## 6. Approches retenues (choisies par l'organisateur)

### 6.1 Autorisations
- **A. Demandes calculées en direct, seules les réponses enregistrées — retenue.** Les demandes sont recalculées depuis les
  groupes actuels à chaque affichage ; une réponse n'est valable que pour la situation à laquelle elle répond ; si la
  situation change (pesée, absence, autre déplacement), la demande revient si elle est encore nécessaire.
- B. Demandes figées au moment du déplacement : plus simple, mais périmée dès qu'une pesée change un écart. Écartée.
- Suivi des réponses (⏳ / Accordée / Refusée) plutôt qu'une simple liste à copier : retenu par l'organisateur.

### 6.2 Horaires
- **A. Le moteur des heures du mode spectateur (`buildTimeline`) appliqué à toutes les sessions — retenu.** Tient compte des
  zones déséquilibrées, des finales, du temps de changement.
- B. Combats × durée ÷ zones : sous-estime la fin réelle (la zone la plus chargée décide). Écartée.

## 7. Conception

### 7.1 Demandes d'autorisation : calcul (domaine pur)

Module pur `src/domain/authorizations.ts`, réutilisable par la skill `shidokan-club-messages`. Entrée : `State` (et la
grille). Sortie : une liste de **demandes**, chacune pour une inscription :

| Type | Quand (critères de la skill, à reprendre à l'identique) |
|---|---|
| `age` | Le combattant fait face à une tranche d'âge plus âgée que la sienne dans son groupe ; vétéran dans un groupe seniors. Jamais pour celui qui reçoit plus jeune. |
| `weight` | Sa catégorie de poids d'origine est sous celle d'un adversaire (une catégorie ouverte « +X » est au-dessus de « −X ») et l'écart estimé maximal avec ces adversaires plus lourds est **> 5 kg** (5 kg exactement : rien). Jamais pour le plus lourd. |
| `missingWeight` | Même situation « plus léger face à plus lourd », mais ni poids pesé ni poids déclaré : on demande son poids (ce n'est pas un accord ; pas de bouton Accordée/Refusée, se règle quand un poids est saisi). |
| `discipline` | Discipline ou règlement actuels différents de ceux d'origine (`original`), quel que soit le reste — **même si la fiche club autorisait ce changement** (autres disciplines cochées, Shobu → Jiyu accepté) : l'organisateur veut toujours une confirmation finale du coach. |
| `mixite` | Le groupe mêle filles et garçons : demande pour **chaque** combattant du groupe mixte, fille ou garçon (choix du rédacteur : les deux clubs doivent être d'accord). |
| `session` | Le combattant est dans une autre session que celle de sa catégorie d'origine (son horaire change), y compris quand c'est sa catégorie qui a changé de session à cause d'un déplacement (`waveShifts`). |

Règles de calcul (reprises de la skill et de sa référence) :
- Seuls les adversaires actifs comptent (ni absents ni « Ne combat pas ») ; un combattant seul n'a pas de demande.
- Poids estimé : pesé, sinon déclaré, sinon limite de la catégorie (`effectiveWeight`). Un poids déclaré égal à une limite
  reste déclaré ; la limite seule n'est pas un poids déclaré.
- On compare les tranches d'âge et catégories de poids **de référence** de chacun, pas les libellés ni le sens du
  déplacement. Catégorie de poids de référence : celle de son poids pesé quand il est pesé (`weighInClass`), sinon celle de
  son inscription d'origine (`original.weightClassId ?? weightClassId`). Même limite de poids dans deux tranches : pas une
  différence de poids.
- Un combattant peut avoir une demande **sans avoir bougé** (il reçoit un adversaire plus lourd).
- Âge et poids sont jugés séparément ; une inscription peut avoir plusieurs demandes.
- Seuil 5 kg inclusif de l'organisateur, même si le moteur du plan utilise un autre seuil.

Chaque demande porte :
- **Ce qui est demandé** (texte), et la **situation** à laquelle elle répond :
  - `age` : sa tranche → tranches plus âgées présentes (ex. « Benjamins → groupe Benjamins–Minimes ») ;
  - `weight` : catégorie d'origine, catégorie la plus lourde en face, écart maximal estimé (arrondi au dixième selon la règle mathématique, puis comparé à 5 kg : 5,04 → 5 → rien) ;
  - `discipline` : discipline/règlement d'origine → actuels ;
  - `mixite` : présence de l'autre sexe dans le groupe ;
  - `session` : session d'origine → session actuelle.
- **Actuellement → proposé** pour l'affichage : « actuellement » = son inscription d'origine (discipline, règlement, tranche,
  poids) ; « proposé » = son groupe actuel (libellé de catégorie) ; pour un combattant resté sur place, « reste en … et reçoit
  … ».
- **Les déplacements en cause** : les entrées actives de l'historique qui créent **cette** demande, et elles seules : son
  propre déplacement ; ou ceux qui ont amené dans son groupe les adversaires qui la créent (pour le poids, seulement ceux qui
  portent l'écart au-delà de 5 kg ; pour l'âge, ceux qui ont amené une tranche plus âgée ; pour la mixité, ceux qui ont amené
  l'autre sexe). Sert à « Refusée ». Liste vide possible (groupe formé avant l'historique, échange, pesée qui a creusé
  l'écart) : voir §7.4.

### 7.2 Réponses (enregistrées)

Nouvelle table `authorization_answers` (migration suivante) : compétition, inscription, type (`age`/`weight`/`discipline`/`mixite`/`session`),
réponse (`granted` seulement : un refus défait le déplacement, il n'y a rien à garder), **situation acceptée** (JSON), date,
+ `rowMeta`. Une réponse couvre une demande actuelle si :
- `age` : les tranches plus âgées actuelles sont incluses dans celles acceptées ;
- `weight` : écart actuel ≤ écart accepté, et catégorie la plus lourde en face ≤ celle acceptée ;
- `discipline` : même discipline et même règlement qu'acceptés ;
- `mixite` : toujours dans un groupe mixte (une seule situation) ;
- `session` : même session qu'acceptée.
Sinon la demande redevient ⏳ (la réponse ancienne reste, inutile, et part avec « Repartir de zéro » ou la suppression de
l'inscription).

**Pré-accord du club** (`clubs.pre_approval`) : il ne dispense de rien, décision de l'organisateur. Les demandes restent ⏳
et figurent dans le texte à copier ; la liste affiche seulement « pré-accord coché sur la fiche » à côté du nom du club,
pour information. De même, un changement de discipline autorisé par la fiche reste une demande.

### 7.3 Appliquer « en attente d'autorisation »

- Tout déplacement appliqué (plan, carte « Valider », déplacement manuel, glisser-déposer sur la planche ou la galaxie) qui
  crée une demande la fait apparaître en ⏳ : rien à cocher, c'est le calcul du §7.1.
- **Plan** : la fenêtre « Appliquer le plan » gagne une case « Appliquer aussi les déplacements à valider (ils attendront
  l'autorisation des clubs) », décochée par défaut. Cochée, tout le plan affiché est appliqué (sauf les lignes refusées),
  dans l'ordre du plan ; la fenêtre liste à part ceux qui créeront une demande. Le serveur applique comme si ces lignes
  étaient validées à la main.
- Un déplacement appliqué ainsi n'est pas « verrouillé » : le plan recalculé peut encore le proposer autrement comme
  aujourd'hui pour un déplacement validé.

### 7.4 Écran « Autorisations »

Nouvelle section sur la page Réaffectation, entre « ② Cas un par un » et l'historique : **« ③ Autorisations à demander »**,
avec un compteur ⏳ dans son titre. Portée : la session affichée (ou toutes).

Regroupée par club (ordre alphabétique), combattants numérotés dans chaque club :

```
Club Karaté Lyon                                  [📋 Copier pour le club]
1. DUPONT Léa
   ⏳ Âge — Benjamines → groupe Benjamines–Minimes (Karaté Jiyu −40)     [Accordée] [Refusée…]
   ⏳ Poids — −40 face à −45 : écart estimé 7 kg maximum                  [Accordée] [Refusée…]
2. MARTIN Hugo
   ✓ Discipline — Shido-boxing → Shido-mix-martial (Minimes −40)         accordée 10:42 [annuler]
   ⚖ Poids manquant — merci d'indiquer son poids (adversaire en −45)
```

- « Accordée » enregistre la réponse ; « annuler » la retire.
- « Refusée… » ouvre la fenêtre d'annulation existante (`UndoHistoryDialog`) sur les déplacements en cause : elle montre
  la cascade ; confirmer défait. Si c'est bloqué (session lancée…), le motif s'affiche et rien ne se passe. Sans
  déplacement en cause (§7.1), le bouton est remplacé par « Déplacer à la main ↗ » (Tableaux, vue Liste, le combattant
  choisi, panneau de déplacement ouvert) avec la phrase « Aucun déplacement à défaire : ce groupe existait déjà. ».
- « 📋 Copier pour le club » copie le texte à envoyer : salutation courte, combattants numérotés, puces concrètes (format de
  la skill : « Passage des benjamines à un groupe commun Benjamines–Minimes en karaté. », « Écart de poids estimé avec ses
  adversaires : 7 kg maximum. », « Merci d'indiquer son poids… »), demande des accords. Seules les demandes ⏳ y figurent.
  « Copier tout » en haut pour l'ensemble.
- Filtre « Seulement en attente » (coché par défaut).
- Sur la planche, la galaxie et la liste : une pastille ⏳ sur le combattant qui a une demande en attente (survol : le texte
  de la demande) ; sur la carte de catégorie, « n autorisations en attente ».

### 7.5 Historique avec cartes

- À l'écriture d'une entrée de type `plan`, `reaffectation` ou `manual`, on enregistre la vue du déplacement (`MoveView`,
  déjà calculée pour la carte ou la ligne du plan) dans `summary_json` (`view`).
- `HistoryEntryCard` affiche alors `MoveBlocks` (Pourquoi · De ➜ Vers · pastilles, « Détails » repliable comme sur les
  cartes) à la place des deux lignes de texte ; heure, type, Voir, Annuler… restent. Une entrée sans `view` (anciennes,
  autres types) garde l'affichage actuel.
- « Détails » dans l'historique montre la situation enregistrée (pas recalculée).

### 7.6 « Voir le tableau »

- Partout où il y a « ✦ Voir dans la galaxie ↗ » (`CategoryColumn`), ajouter « ▦ Voir le tableau ↗ » : nouvel onglet,
  Tableaux en vue Liste, la catégorie choisie (`?vue=liste&categorie=<id>`, lu au chargement comme `?categorie` aujourd'hui
  pour la galaxie ; portée « Toutes » si la catégorie n'est pas dans la session).
- Inscriptions : une colonne/un bouton « Tableau » par ligne (une ligne = une inscription), même lien, même onglet ; grisé
  avec une infobulle si l'inscription n'a pas de catégorie.

### 7.7 Horaires estimés

Nouvelle section **« Horaires estimés »** dans l'onglet Sessions (là où sont les débuts prévus et les zones).
- Calcul serveur (ou domaine pur partagé) : pour chaque session dans l'ordre, la répartition et l'ordre de passage **en
  direct** (`src/domain/passages/`) pour une session non lancée, figés pour une session lancée ; durées par passage comme le
  mode spectateur ; `buildTimeline` avec `now` = null avant le jour J.
- Début d'une session : son début prévu ; sans début prévu, à la suite de la fin estimée de la précédente (première session
  sans début prévu : on affiche des durées « + 2 h 30 » au lieu d'heures).
- Chevauchement : case **« Décaler une session qui commence avant la fin de la précédente »**, **cochée par défaut**
  (décision de l'organisateur ; gardée sur le poste). Cochée, sur chaque zone, une session ne commence pas avant la fin
  estimée de la session précédente sur cette zone (+ changement). Dans les deux cas, une alerte « Chevauche la session
  précédente de 25 min (zone 2) » s'affiche sur la session. Cette case ne touche que l'estimation, pas le mode spectateur.
- Affichage : par session, une ligne par zone (début, fin estimée, nombre de combats, barre proportionnelle pour voir la zone
  la plus chargée), la zone/heure des finales, et en tête **« Fin estimée de la journée : 17:40 »**.
- Juste au-dessus : les durées de combat par groupe d'âge et le temps de changement, **modifiables sur place** (mêmes champs
  et mêmes valeurs que dans Réglages, enregistrés pareil) ; l'estimation se recalcule à chaque changement. Lien vers les
  durées propres à une catégorie quand il y en a (« 3 catégories ont leur propre durée »).
- Les inscrits changent (pesée, réaffectation) : l'estimation suit (SSE).

### 7.8 Pesée

- Choix « Ordre : Nom | Club » (gardé sur le poste) ; par club, une ligne d'en-tête par club. La recherche reste.
- Colonne Inscriptions : discipline **+ règlement** (« Karaté Jiyu −40 ») et poids déclaré (« déclaré 38 kg ») par inscription
  de combat ; la colonne « Catégorie du poids » ne change pas.

### 7.9 Tableaux : barre épinglée et recherche qui défile

- Planche et galaxie : `PlancheToolbar` + pastilles de catégories (`JumpLinks`) dans un bloc `position: sticky` sous l'en-tête
  de l'application, fond opaque, ombre légère quand la page a défilé ; le défilement vers une carte ou un groupe tient compte
  de sa hauteur (`scroll-margin-top`). Sur téléphone, le bloc reste compact (pastilles sur une ligne défilante).
- Recherche : ne filtre plus. Les cartes qui correspondent (catégorie ou combattant) sont surlignées, la première défile
  sous la barre ; « 2 / 5 » avec ↑ / ↓ (et Entrée / Maj+Entrée) pour passer de l'une à l'autre ; Échap vide la recherche.
  « Seulement à traiter » reste un filtre.
- Vue Liste : même chose dans la colonne de gauche (la catégorie trouvée est choisie, son tableau s'affiche, la liste défile
  jusqu'à elle).
- Galaxie : ↑ / ↓ centre l'étoile suivante.

## 8. Ordre de réalisation

1. Autorisations (§7.1–7.4) avec pesée (§7.8) et historique (§7.5).
2. Horaires estimés (§7.7).
3. « Voir le tableau » (§7.6) et barre/recherche des Tableaux (§7.9).

## 9. Décisions et points laissés au constructeur

Décidé par l'organisateur (2026-11-19) : pré-accord et accord de discipline sur la fiche ne dispensent pas de demander ;
types `mixite` et `session` ajoutés ; case de décalage des sessions cochée par défaut.

Choix du rédacteur (à corriger si besoin) :
- catégorie de poids de référence = celle de la pesée si pesé, sinon celle de l'inscription (§7.1) ;
- « Refusée » ne défait que les déplacements qui créent la demande ; sans déplacement en cause, lien « Déplacer à la main »
  (§7.4) ;
- mixité : demande pour chaque combattant du groupe mixte (§7.1) ;
- les réponses ne gardent que « Accordée » (un refus défait, rien à garder) ;
- l'historique garde la vue enregistrée au moment de l'action, pas recalculée (§7.5).

Arrondi (décision de l'organisateur) : écart arrondi au dixième selon la règle mathématique, et c'est la valeur arrondie qui est comparée à 5 kg et affichée (5,04 → « 5 kg », pas de demande).

Laissé au constructeur : mise en forme exacte du
texte copié (dans l'esprit de la skill), placement exact de la barre épinglée, détails de synchronisation et de versions de
lignes, découpage du calcul des horaires entre domaine et serveur.
