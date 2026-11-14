# Zone réservée aux finales — conception (courte)

Date : 2026-11-14. Approuvée par l'utilisateur le même jour.
Touche les zones (`zones`, Réglages de la compétition), la répartition (`src/domain/passages/distribute.ts`), « Déplacer
vers… » (Combats) et les finales par session (`2026-11-08-finales-des-que-pretes-design.md`).

✅ = décidé par l'utilisateur, 💡 = choix du concepteur.

## Pourquoi

Coupe interdépartementale du 2026-11-22 : 3 tatamis + un ring où les finales de combat se jouent dès que possible ; les
katas gardent leur finale sur leur tatami. Une zone des finales qui a ses propres combats les joue tous avant les finales
(règle de repos, spec finales §2.2) ; une zone des finales **sans combat à elle** joue chaque finale « Dès que finie » dès
que sa catégorie est terminée. Aujourd'hui, rien n'empêche la répartition automatique de donner des catégories au ring :
les disciplines cochées servent à la fois à la répartition et à l'accueil des finales.

## Ce qu'on construit

- Une case **« Réservée aux finales »** sur chaque zone, dans Réglages → zones ✅. N'importe quelle zone de la compétition
  peut l'être (un ring, un tatami d'honneur…) ✅ ; plusieurs zones peuvent l'être 💡.
- Une zone réservée **ne reçoit aucune catégorie de la répartition automatique** ✅.
- Ses disciplines cochées disent toujours **quelles finales elle accepte** ✅ (décocher Kata garde les finales de kata sur
  leur zone, avec la raison « Ring n’accueille pas le kata » dans l'onglet Finales).
- Une discipline que seules des zones réservées accueillent : ses catégories sont « impossibles » (alerte existante
  « aucune zone n'accepte ») ✅.
- **« Déplacer vers… »** (Combats) peut y épingler une catégorie à la main (tatami en panne…) ✅ ; la zone y est marquée
  « réservée aux finales » 💡. Une catégorie épinglée reste épinglée si la zone devient réservée 💡.
- La zone des finales de chaque session se choisit toujours dans l'onglet Finales ✅ (rien de nouveau là).

## Approches envisagées

1. **Case sur la zone** (retenue) : un booléen `finals_only` sur `zones`, lu par la répartition seule.
2. Zone sans discipline + acceptation des finales indépendante : deux listes de disciplines par zone, plus lourd à
   comprendre et à régler. Écartée.
3. Épingler à la main toutes les catégories sur les tatamis : faisable sans code, fastidieux et facile à rater. Écartée.

## À faire suivre

Migration (colonne `finals_only`, défaut faux), validation et route des zones, paquet de synchronisation / sauvegardes /
import d'un paquet d'avant (absent = faux), Réglages (case + aide), « Déplacer vers… », aide en ligne et guide
utilisateur, tests unitaires et e2e.

## Laissé au constructeur

Nom exact de la colonne, texte de l'aide, place de la case dans la ligne de zone.
