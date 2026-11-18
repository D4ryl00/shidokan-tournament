# Réaffectation : retrouver le plan où on l’a laissé — conception courte

Date : 2026-11-18. Petite modification.

## Intention

Pendant la réaffectation automatique, l’organisateur valide ou modifie des lignes du plan sans encore l’appliquer, va voir un autre
onglet (Tableaux…) puis revient sur Réaffectation. Aujourd’hui il a l’impression de devoir tout recommencer.

Constat sur Chrome (démo, 2026-11-18) : les choix (« Valider », « Modifier », refus) sont bien gardés (`sessionStorage`, par session),
mais au retour le plan est replié et il est recalculé même si rien n’a changé (barre de progression). C’est ce qui donne
l’impression d’avoir tout perdu.

## Objectifs

- Au retour sur Réaffectation, le plan de la session est **déplié s’il l’était** quand on est parti.
- **Pas de recalcul** au retour si rien n’a changé dans la compétition entre-temps : le plan gardé s’affiche aussitôt.
- Si quelque chose a changé (sur ce poste ou un autre), le plan est recalculé comme aujourd’hui (et un choix devenu impossible est
  retiré avec le message actuel).

## Hors champ (décidé avec l’organisatrice)

- La position dans la page et les « Détails » ouverts ne sont pas gardés.
- Un « Modifier » en cours de saisie, la confirmation « Appliquer le plan » ouverte : non gardés.

## Approches

- **A. Mémoriser l’affichage comme les choix, et garder le plan calculé (retenue).** Léger, dans la manière actuelle de l’appli
  (`usePlanChoices`, flux d’événements et révision qui disent déjà quand la compétition change).
- B. Garder la page Réaffectation montée en arrière-plan. Écartée : plus lourd, à contre-courant des onglets actuels, et la page
  cachée recalculerait le plan pendant qu’on travaille sur les Tableaux.

## Conception

1. **Plan déplié** : l’état « Voir le plan » ouvert/fermé est gardé en `sessionStorage`, une clé par compétition et par session
   (comme `plan-choices:` et `plan-card-decisions:`). Le défaut reste replié.
2. **Plan gardé** : la requête du plan (`usePlan`) n’est plus considérée périmée au retour sur la page ni oubliée au bout de
   5 minutes. Elle reste rafraîchie par ce qui la rafraîchit déjà : gestes de cet onglet (`useInvalidateDay`), changements des
   autres postes (`refreshPlansLive`), onglet revenu après des changements manqués (révision du flux). Les plans d’autres choix
   restent oubliés à la première écriture (`forgetHiddenPlans`), comme aujourd’hui.
3. **Calcul annulé** (« Annuler le calcul ») puis départ de la page : au retour, le plan n’est pas présenté comme à jour ; il est
   recalculé (l’état « annulé » ne survit pas au démontage).

## Mes choix (à vérifier)

- Les choix restent dans `sessionStorage` (onglet du navigateur) : fermer l’onglet ou ouvrir Réaffectation dans un nouvel onglet
  repart sans choix, comme aujourd’hui. La question a été posée sans réponse ; on ne change rien.
- « Repartir de zéro » oublie aussi l’état déplié (avec `clearPlanChoices`) ; « Recommencer le plan » ne replie pas.
- Pas de limite de temps sur le plan gardé : il est tenu à jour par les événements, pas par l’horloge.

## Laissé au constructeur

- Les réglages TanStack exacts (`staleTime`, `gcTime`) et la manière de reconnaître un plan annulé au remontage.
- Les tests (unitaires sur le hook d’état déplié ; e2e : valider, aller sur Tableaux, revenir → plan déplié, choix là, aucun
  nouvel appel à `/replacement/plan`) et la vérification sur Chrome.
