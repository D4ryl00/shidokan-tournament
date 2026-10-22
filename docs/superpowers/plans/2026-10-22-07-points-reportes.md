# Étape 7 : Points reportés des relectures — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Source : `docs/superpowers/plans/2026-10-21-99-bilan.md` (sections « Points mineurs reportés »). Spec : `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md`.

Chaque point est traité par un test qui échoue d'abord (TDD) quand il touche la logique ; les points d'interface sont vérifiés par Playwright sur Chrome.

**Déjà réglés par des corrections ultérieures** (rien à faire) :
- signe moins Unicode et tiret demi-cadratin (étape 3) ;
- formulation du README sur les sauvegardes (étape 6) ;
- égalités de kata en double, règle des notes retirées, départage par l'organisateur (étape 6) ;
- `podium.ties` vide en « poules puis tableau » (étape 6).

## Task 1 : Validation et messages (socle)
- [x] Date impossible (2026-13-45, 2026-02-30) refusée.
- [x] `validateGrid` : âge min > âge max ; passage d'âge en double.
- [x] Réglages : tranche de mixité inconnue de la grille → 400.
- [x] Erreurs Fastify en français :
  - JSON invalide → 400 ;
  - type de contenu non pris en charge → 415 ;
  - route API inconnue → 404 ;
  - corps vide → « corps de la requête manquant » ;
  - chemin `settings` traduit (« réglages »).
- [x] Tolérance de 50 kg refusée par l'API (test).
- [x] Tirets U+2011, U+FE63 et U+FF0D lus comme « - ».

## Task 2 : Interface du socle
- [x] Éditeur de grille : les lignes ne bougent plus pendant la frappe (tri à l'enregistrement).
- [x] Icône d'onglet sur disque blanc (lisible sur un onglet sombre).

## Task 3 : Fiche club
- [x] Ligne en double (même combattant, même discipline) → la seconde est en erreur.
- [x] Deux disciplines de combat dans la même fiche → remarque.
- [x] « Vétéran » seul → remarque « placé en V1 ».
- [x] Aperçu : les lignes en erreur affichent nom et prénom.
- [x] Aperçu d'un réimport : liste des inscriptions qui seront retirées.
- [x] Le premier onglet qui est une fiche club est lu (pas seulement le premier).
- [x] Lignes ajoutées ou retirées au-dessus du tableau : en-tête et champs retrouvés par leur libellé.

## Task 4 : Import FFK
- [x] Deux entités FFK de même nom de club → remarque dans l'aperçu.
- [x] Liens de club « à vérifier » non confirmés : pas mémorisés comme alias permanents.
- [x] Fichiers envoyés purgés (après import, et au-delà des 5 derniers par compétition).
- [x] Décision explicite vers un combattant dont l'inscription de même discipline est déjà rapprochée → ligne en erreur.
- [x] Ligne sans licence puis ligne avec licence pour le même combattant → pas de doute artificiel.

## Task 5 : Tableaux
- [x] Un simple changement de libellé (grille) ne régénère pas les tableaux (les échanges manuels restent).
- [x] `swap` : a ≠ b, et tous deux dans le tableau → sinon 400.
- [x] Inscription d'une catégorie lancée : jamais déplacée par la synchronisation (même si sa clé change).
- [x] Impression du kata sans badge ; poules imprimées en **grille croisée**.
- [x] Format imposé devenu incompatible : la liste affiche « Automatique » avec une note.
- [x] Synchronisation déterministe si deux catégories partagent une clé (ruling plutôt qu'un index unique).
- [x] Double élimination à 16 : schéma alterné de descente, sans revanche immédiate quand les favoris gagnent.
- [x] Test : régénération d'une catégorie « prête ».

## Task 6 : Pesée et recasement
- [x] Empreinte : réglages, grille et préférences compris ; validation unitaire protégée par l'empreinte.
- [x] Badges : détail au clic (origine, arrivée, motif, heure), écart en kg sur « ⚖ Poids », filtres par type et état, nombre de cas par catégorie dans Tableaux.
- [x] Propositions refusées affichées en grisé, avec « Rétablir ».
- [x] Catégories dont tous les membres sont absents : signalées, non imprimées ; clés recalculées sur les membres présents.
- [x] Pesée : un recasé n'est pas affiché « hors catégorie » sans cas correspondant (mention « recasé »).
- [x] Feuilles de pesée aussi par catégorie.
- [x] Déplacement manuel vers un kata : règlement et poids retirés.
- [x] `separateClubs` : ruling (optimal sur 300 essais aléatoires, laissé tel quel).

## Task 7 : Jour J
- [x] `affectedBy` tient compte des départages.
- [x] Départages effacés quand un résultat de la poule (ou une note de kata) change.
- [x] Statut : une catégorie « provisoire » le reste tant qu'aucun résultat n'est saisi.
- [x] Résultats ignorés : liste avec « Effacer » (même sur un combat devenu non jouable).
- [x] Kata : le nombre d'arbitres ne descend pas sous le nombre de notes déjà saisies.
- [x] Export des podiums :
  - podium incomplet marqué « en cours » ;
  - « Sans club » exclu du classement des clubs ;
  - lignes de médailles indexées par club (et non par nom).
- [x] Export des résultats : feuille « Kata » (notes, note retenue, rang).
- [x] « Effacer le résultat » : confirmation, avec l'avertissement des combats suivants touchés.
- [x] Annulation d'un recasement : ordre fiable même à la milliseconde près (rowid).

## Fin
- [x] `npm run typecheck && npm test && npm run test:e2e` ; bilan mis à jour ; relecture finale ; push.
