# Durée des finales — design (court)

Approuvé par l'organisateur le 2026-11-15.

## Pourquoi

En finale, on peut faire un autre nombre de rounds (et d'autres durées) que pour les autres combats. Aujourd'hui il faut
ajouter une exception à la main sur la finale de chaque catégorie (Tableaux → Durée des combats → Exceptions). On veut
le régler une fois pour toute la compétition, et pouvoir le changer pour une catégorie, afin que les heures estimées
(passages, « vers 14:30 » des spectateurs) soient justes. Les durées ne servent qu'aux heures : pas de chrono, la saisie
des résultats ne change pas.

## Objectifs

1. **Réglages → Durées des combats** : sous chaque groupe d'âge (moins de 14 ans, jeunes, adultes, triathlon), une ligne
   « Finale » : « Comme les autres combats » (par défaut) ou « Autre » → Rounds, Round, Repos, Prolongation (les quatre,
   demande de l'organisateur : « mieux vaut plus de réglages que moins »). Triathlon compris : sa finale peut avoir un
   nombre de rounds libre (1 à 12), différent des 3 ou 6 des « Rounds de triathlon ».
2. **Tableaux → Durée des combats** : quand le tableau est sur « Autre », une ligne « Finale » en dessous :
   « Comme les autres combats du tableau » ou « Autre ». En passant le tableau sur « Autre », si la compétition a une
   finale propre pour ce groupe d'âge, elle est reprise dans la ligne « Finale » du tableau (rien ne se perd sans qu'on le voie).
3. **Prolongation dans Tableaux** (choix de Claude, d'après la préférence de l'organisateur) : les lignes du tableau
   (combats, finale) et les exceptions gagnent aussi le champ Prolongation, absent aujourd'hui.
4. **Précédence** pour un combat : exception du combat → (si finale) finale du tableau → durée du tableau
   → (si finale) finale de la compétition → groupe d'âge de la compétition. Autrement dit : un tableau sur « Autre »
   avec sa finale « comme les autres combats du tableau » donne à sa finale la durée du tableau ; un tableau
   « Comme la compétition » prend la finale de la compétition.
5. **Ce qu'est une finale** : `finalMatchIds` (`src/domain/passages/finals.ts`), la même définition que la zone des
   finales — finale du tableau, grande finale, finale à trois, combat unique d'une catégorie à 2, manches d'un
   meilleur des trois. Pas la petite finale, pas une poule unique. Kata non concerné.
6. Aides (`reglages.durees`, `tableaux.durees`) mises à jour.

## Non-objectifs

- Un réglage pour la petite finale, les demi-finales, etc. (les exceptions par combat restent pour ça).
- Compter la prolongation dans les heures (inchangé : elle n'est pas comptée).
- Chrono ou décompte des rounds pendant le combat.

## Contraintes

- Compatibilité : réglages de compétitions existantes, sauvegardes et paquets d'export plus anciens sans ce champ
  → finale « comme les autres combats » (champ absent = null). Les schémas zod sont `.strict()` : ajouter des champs
  optionnels/nullable, ne rien rendre obligatoire à la lecture.
- Les heures se recalculent partout où `combatTiming` est appelé (`src/server/repositories/passages.ts`,
  `src/domain/public/view.ts`, `src/domain/public/times.ts` le cas échéant) : la fonction doit savoir si le combat est une finale.
- Compétition le 2026-11-22 : petit chantier, sans migration SQL si possible (réglages et `categories.durations` sont du JSON).

## Approches

- **Retenue : un réglage « finale » dans les données de durée** (par groupe d'âge dans `ScheduleSettings`, et dans
  `CategoryDurations`), lu par `combatTiming` selon que le combat est une finale. Suit les nouveaux tirages et les
  changements de réglages.
- Écartée : créer automatiquement une exception sur la finale de chaque catégorie. Les exceptions sont liées à un id
  de combat : perdues ou fausses après un nouveau tirage ou un changement de format, et ne suivent pas un changement
  des réglages.

## Laissé au constructeur

- Forme exacte des champs (ex. `groups[g].finals: CombatTiming | null` ou `finals: Record<AgeGroup, CombatTiming | null>`
  à côté ; `CategoryDurations.finals: CombatTiming | null`).
- Valeur proposée quand on passe une ligne « Finale » sur « Autre » : la durée des autres combats de la même ligne.
- Tests unitaires de la précédence et de la compatibilité, e2e des deux écrans, vérification sur Chrome.
