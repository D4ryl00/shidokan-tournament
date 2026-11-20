# Carte de réaffectation lisible, session des catégories regroupées et gel des sessions, session finale dans le récapitulatif club

Design approuvé par étapes dans la conversation du 2026-11-20. Il remplace la version courte du même jour.

## Intention

La compétition a lieu le dimanche 22 novembre 2026. L'organisateur prépare les tableaux en amont, puis envoie à chaque club un récapitulatif PDF. Trois problèmes :

1. La carte de réaffectation met en valeur la mauvaise ligne.
2. Une catégorie qui regroupe plusieurs tranches d'âge va toujours dans la session de la tranche la plus jeune, même quand presque tous ses combattants sont attendus dans une autre session. On déplace donc plus de monde que nécessaire, et les heures de convocation changent pour beaucoup de gens.
3. Le club ne sait pas qu'un de ses combattants change de session, alors que son heure de convocation change.

En préparation, la session d'une catégorie doit suivre la majorité de ses combattants. Le jour J, plus rien ne doit bouger tout seul : l'organisateur fige les sessions et ne corrige plus qu'à la main.

## Objectifs, non-objectifs, anti-objectifs

- **Objectifs** : carte lisible ; session décidée par la majorité ; gel explicite et réversible ; mention « Déplacé dans la session … » dans le récapitulatif club.
- **Non-objectifs** : pas d'horaire de convocation dans le récapitulatif ; pas de gel automatique (ni par date, ni à la première pesée) ; pas de changement des règles des sessions elles-mêmes (tranches et disciplines).
- **Anti-objectifs** : après le gel, une catégorie change de session sans geste de l'organisateur (inscription tardive, recasement, absent, retrait) ; un choix manuel de la page Sessions perdu ou masqué par le gel ; un récapitulatif qui annonce un déplacement de session à tort.

## Contraintes

- Mise en production avant le 22/11. La migration de base se fait après une sauvegarde du serveur, et le conteneur est arrêté proprement (`docker stop`) avant d'être remplacé.
- Pas de régression de performance notable du calcul du plan de réaffectation (`src/domain/replacement/plan-search.ts`), qui appelle `waveEffects` à chaque proposition.
- Le lancement d'une session fige déjà la session de ses catégories (`launches.ts` écrit `waveOverride`) : ce comportement est gardé.
- Interface en français.

## Approches (choix de l'utilisateur)

- **Déclenchement du gel** : A, automatique à la première pesée ; ou B, un bouton « Figer les sessions ». **Choix : B.** L'organisateur décide du moment, par exemple si la pesée a lieu la veille.
- **Stockage du gel** : 1, une session figée par catégorie, distincte du choix manuel, avec un horodatage au niveau de la compétition ; ou 2, réutiliser `waveOverride` comme le lancement. **Choix : 1.** C'est réversible (« Ne plus figer »), les vrais choix manuels restent visibles, au prix d'une migration. La 2 rendait toutes les catégories « Ajoutées à la main » et le gel irréversible.
- **Comptage** : par tranche ou par session. **Choix : par session** (proposé, accepté). On minimise le nombre de personnes déplacées : avec 1 junior, 1 espoir et 1 senior et une session « Adultes » qui prend espoirs et seniors, la catégorie va dans « Adultes ».
- **Recasés** : exclus du comptage aujourd'hui, pour qu'un recasement du jour J ne fasse pas basculer une catégorie. **Choix de l'utilisateur : ils comptent.** Ils font partie de la catégorie, et le gel du jour J supprime le risque.

## 1. Carte de réaffectation : le motif d'abord

Section ② de Réaffectation, `caseCard` dans `src/web/pages/ReplacementPage.tsx`. Sous le nom, dans cet ordre :

1. Le motif (`c.detail`), semi-gras, en `var(--sk-warn-text)`, ou sans couleur pour une carte « Retour possible » (badge neutre). Nouveau `data-testid="case-detail"`.
2. « Catégorie actuelle : … » sur sa propre ligne, en texte normal, si la catégorie existe.
3. Le rappel du combattant (`FighterDetail`, `case-fighter`), grisé.

Le reste de la carte ne change pas.

## 2. Session d'une catégorie : la majorité

La règle remplace « la tranche la plus jeune parmi les combattants d'origine » dans `waveOfCategory` (`src/domain/waves.ts`) et partout où elle est reproduite.

Session d'une catégorie, dans l'ordre :
1. le choix manuel (`waveOverride`, y compris `none`), qui garde la priorité ;
2. sinon, la session figée (§3) ;
3. sinon, une catégorie libre (`key.free`) n'a pas de session (comme aujourd'hui) ;
4. sinon, le **comptage** : chaque combattant de la catégorie (recasés compris, retirés exclus puisqu'ils n'ont plus de catégorie ; absents compris tant que les sessions ne sont pas figées, exclus une fois figées — ce qui ne joue que pour une catégorie créée après le gel) vote pour la session que les règles donnent à sa propre tranche et à la discipline de la catégorie (la première session dont la règle les prend, même ordre qu'aujourd'hui). Un combattant dont la tranche n'est prise par aucune session ne vote pas. La session qui a le plus de voix l'emporte. En cas d'égalité, c'est la session de la tranche la plus jeune parmi les ex-aequo (ordre des tranches de la grille), puis l'ordre des sessions si deux tranches de même rang donnent deux sessions ;
5. sans aucun vote (catégorie vide ou aucune tranche prise), la clé décide, comme aujourd'hui : la tranche la plus jeune de `key.ageBandCodes`.

Conséquences :
- `waveBands` (liste dédoublonnée des tranches des non-recasés) devient un décompte de toutes les tranches des membres. Le nom et la forme sont laissés au constructeur, par exemple `bandCounts: Record<string, number>`. Il est produit par `loadContext` dans `src/server/repositories/categories.ts`, par `originBands` et `categoryWaves` dans `src/domain/replacement/waves.ts`, et lu par la page Sessions (`WavesPage.tsx` le passe à `waveOfCategory` et `waveConflicts`).
- `waveChangeOf`, `waveMoves`, `mayMoveOthers` et `waveEffects` suivent la nouvelle règle. Un déplacement peut désormais faire basculer la catégorie de départ ou la catégorie d'arrivée, et emmener ses autres membres (`waveShifts`, déjà affiché par `WaveChangeWarning`). `mayMoveOthers` reste un filtre peu coûteux : il compare la session gagnante de la catégorie de départ et de la catégorie d'arrivée avant et après le vote du combattant déplacé, sans appliquer la proposition. Il ne déclenche le calcul complet (`applyProposal` + `waveMoves`) que s'il y a bascule.
- Une catégorie figée ou choisie à la main ne bascule jamais : pas de `waveShifts` pour elle.
- Le texte d'aide (`src/web/help.ts`, entrées des sessions) et la spec principale (`docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md`, section des vagues) décrivent la nouvelle règle et le gel.

## 3. Figer les sessions

**Stockage** (migration `drizzle/0041_…`) :
- `categories.frozen_wave` (texte, nullable) : l'id de la session figée, `none` pour « en attente » figée, null pour non figée.
- `competitions.sessions_frozen_at` (texte ISO, nullable) : l'heure du gel ; null pour non figé.

**Figer** (page Sessions, bouton « Figer les sessions », visible seulement avec au moins une session) : dans une seule transaction, après une synchronisation des catégories, chaque catégorie reçoit `frozen_wave` = sa session calculée à cet instant (`none` si en attente), et `sessions_frozen_at` = maintenant. Une confirmation explique l'effet : « Chaque catégorie garde sa session actuelle. Les nouvelles inscriptions et les recasements ne la changeront plus. Vous pourrez toujours changer une catégorie de session à la main. »

**Après le gel** :
- une catégorie créée par la suite (inscription, recasement, regroupement) reçoit `frozen_wave` à sa création, avec la session calculée à ce moment-là. Cela s'applique à toutes les créations de lignes `categories` (`syncCategories`) ;
- le calcul en mémoire du plan de réaffectation (`State`, `CategoryState`) porte la session figée de chaque catégorie. Une catégorie nouvelle simulée prend la session calculée à sa création simulée, puis ne bouge plus ;
- le choix manuel de la page Sessions reste possible, prioritaire, et s'affiche comme aujourd'hui (« Ajoutée à la main ») ;
- le lancement d'une session continue d'écrire `waveOverride` comme aujourd'hui ;
- modifier les règles des sessions (`PUT /waves`) ne change pas les catégories figées. Une catégorie dont la session figée est supprimée perd son `frozen_wave` (comme `waveOverride` aujourd'hui, `waves.ts:55`) et repasse au calcul.

**Ne plus figer** (même endroit, une fois figé) : remet `frozen_wave` à null partout et `sessions_frozen_at` à null, sans toucher aux `waveOverride`. Confirmation : « Les catégories reprennent la session de la majorité de leurs combattants ; certaines peuvent changer de session. »

**Affichage** : la page Sessions montre « Sessions figées le {date} à {heure} » près du bouton. La page Réaffectation n'affiche rien de plus : les cartes et le plan disent déjà les changements de session.

**Journal** : deux entrées, « Sessions figées » et « Sessions défigées », via `recordJournal`, avec un type et des actions dans `src/domain/journal/types.ts` et leurs libellés dans le rendu du Journal. Le nombre de catégories figées va dans les données.

**Historique (annulation)** : le gel n'est pas une action annulable de l'Historique, puisque « Ne plus figer » l'annule. Une catégorie recréée par une annulation retrouve son `frozen_wave` si la restauration de l'Historique copie la ligne. Sinon, elle le reçoit comme une catégorie créée après le gel.

**Synchronisation et sauvegarde** : les nouvelles colonnes sont incluses dans le paquet de synchronisation (`src/server/sync/package.ts`) et dans la sauvegarde.

## 4. Récapitulatif club : « Déplacé dans la session … »

**Référence (décidé par l'utilisateur).** Les clubs ont reçu le protocole de la compétition, avec une convocation par session (« Convocation session Poussins - Pupilles à 8 h », « session Benjamins - Minimes à 10 h »…). Ce protocole est le reflet des règles des sessions. Un combattant qui combat dans une autre session que celle de sa tranche doit le savoir, quelle qu'en soit la cause : regroupement, recasement ou choix manuel.

- `RecapLine` reçoit `session: string | null`, le nom de la session finale quand elle diffère de la session annoncée, sinon null.
- Session annoncée : celle que les règles des sessions donnent à l'inscription d'origine du combattant seul (sa tranche, la discipline d'origine). Concrètement, `waveOfCategory` avec la clé naturelle (`naturalKey` des valeurs d'origine), sans choix manuel, sans gel, et un seul vote (sa tranche). On ne cherche pas la catégorie naturelle existante : dans un regroupement, elle peut être la catégorie regroupée elle-même, et un choix manuel sur elle change justement l'heure du combattant.
- Session finale : la session de la catégorie où il combat (`Category.waveId`, gel et choix manuel compris).
- Mention dès que le combattant est placé dans une catégorie et que la session finale est non nulle et différente de la session annoncée, **même si la ligne n'est pas « Changé »**. Exemple : la catégorie Benjamins kata passée à la main en session 2 alors que le protocole convoque les Benjamins en session 1. Une ligne qui reçoit la mention est mise en évidence comme une ligne changée (fond gris), et la mention suffit comme motif quand la catégorie n'a pas changé. Rien sans sessions, ni pour Absent / Ne combat pas / Pas encore placé, ni avec une session finale « en attente ».
- PDF : dans la colonne « Au final », sous « Changé (motif) », une ligne en gras `Déplacé dans la session {nom}`, sans horaire et sans point final, repliée sur la largeur de la colonne. Elle compte dans la hauteur de la ligne, et la règle « une ligne ne dépasse jamais une page » reste vraie.

## Décidé par l'utilisateur

- Le motif en évidence sur la carte, le rappel grisé.
- La majorité numérique décide de la session ; en cas d'égalité, les plus jeunes.
- Les recasés comptent.
- Les absents comptent tant que les sessions ne sont pas figées ; une fois figées, ils ne comptent plus. Après « Ne plus figer », ils comptent de nouveau.
- Le jour J, rien ne bouge tout seul ; on corrige à la main avec la page Sessions.
- Le gel est déclenché par un bouton (B) et stocké à part du choix manuel, de façon réversible (1).
- Le récapitulatif dit « Déplacé dans la session {nom} », sans horaire, dès que la session diffère de celle du protocole envoyé aux clubs (règles des sessions appliquées à la tranche du combattant).
- Les sessions n'ont pas encore été annoncées par catégorie : la migration ajoute des colonnes vides, sans rien figer. Après la mise à jour, l'organisateur vérifie la page Sessions puis fige.

## Mes choix (à corriger si besoin)

- Comptage par session plutôt que par tranche.
- Le récapitulatif ne montre la session que lorsqu'elle diffère de celle du protocole.
- `waveConflicts` (catégories prises par plusieurs sessions) : sous le vote, une catégorie est en conflit si le vote gagnant d'une de ses tranches est ambigu (tranche prise par plusieurs règles), comme aujourd'hui pour sa tranche décisive.
- Les catégories libres (`key.free`) n'ont pas de session : rien à figer pour elles (`frozen_wave` reste null).
- Une catégorie élargie par un recasement garde son identifiant, donc sa session figée.
- Le gel et son annulation vont dans le Journal, pas dans l'Historique.

## Laissé au constructeur

- Les noms exacts des champs (`bandCounts`, `frozenWave`, `sessionsFrozenAt`), des routes (`POST /sessions/freeze` et `/unfreeze`, ou une route existante) et des `data-testid`.
- L'emplacement exact du bouton dans `WavesPage.tsx` (près de « Enregistrer les sessions », sans se confondre avec l'enregistrement des règles).
- Les droits : mêmes rôles que l'enregistrement des sessions.

## Vérification

TDD :
- domaine du vote : majorité, égalité vers les plus jeunes, recasés comptés, absents comptés avant le gel et ignorés après (catégorie créée après le gel), tranche hors session, catégorie vide, choix manuel prioritaire, gel prioritaire ;
- `waveEffects` : bascule de la catégorie d'arrivée qui emmène ses membres ; pas de bascule une fois figée ;
- routes figer / ne plus figer, Journal, catégorie créée après le gel, suppression d'une session figée ;
- lignes et PDF du récapitulatif (mention, regroupement juniors / seniors, sans sessions, ligne longue) ;
- e2e de la carte et du bouton.

Puis Chrome : carte « Écart de poids » et « Retour possible » (clair, sombre, 390 px) ; page Sessions, figer puis ajouter un inscrit qui aurait fait basculer une catégorie, puis ne plus figer ; récapitulatif téléchargé.
