# Feuille de route : app de tableaux Shidokan

**Spec :** `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md`
**Échéance :** compétition du **22 novembre 2026**.

Le projet est découpé en **6 étapes**. Chacune produit une app qui fonctionne et se teste seule, et chacune a son propre plan détaillé dans `docs/superpowers/plans/`. Le plan d'une étape est détaillé **au moment de la commencer**, à partir du code réellement écrit aux étapes précédentes : les interfaces réelles remplacent les suppositions.

| # | Étape | Livrable testable | Dépend de | Cible |
|---|---|---|---|---|
| 1 ✅ | **Socle** | App lancée via Docker : création d'une compétition, réglages, éditeur de la grille FFK, thèmes clair et sombre, logo, tests Chrome | — | 25 oct. |
| 2 ✅ | **Inscriptions et fiche club** | Combattants et inscriptions (saisie manuelle, inscription sur place), **modèle .ods de fiche club** à envoyer aux clubs, import des fiches renvoyées, écran de saisie rapide | 1 | 29 oct. (**envoi de la fiche aux clubs**) |
| 3 ✅ | **Import FFK et rapprochement** | Import .xlsx/.ods/.csv avec correspondance des colonnes, normalisation, aperçu, réimport sans doublons ; rapprochement fiche club ↔ FFK | 2 | 2 nov. |
| 4 ✅ | **Moteur de tableaux et impressions** | Génération des 7 formats de combat et du format kata, tirage avec séparation des clubs, étapes de vie des catégories, impression des tableaux (vierges et remplis) | 2 | 8 nov. |
| 5 ✅ | **Pesée et recasement** | Écran de pesée, moteur de propositions (A à H, R), tableau de bord avec badges, aperçu, validation unitaire et globale, recasement anticipé, régénération | 3, 4 | 14 nov. |
| 6 ✅ | **Jour J** | Tatamis, saisie des résultats, avancement automatique, classements de poule, notation kata, feuilles de résultats, podiums et classement des clubs, exports, sauvegarde automatique et restauration | 4, 5 | 19 nov. |
| 7 ✅ | **Points reportés** | Points mineurs des relectures des étapes 1 à 6 (plan `2026-10-22-07-points-reportes.md`, bilan mis à jour) | 1 à 6 | 22 oct. |
| — | **Répétition générale** | Compétition fictive complète sur le PC de la table centrale, avec Docker et sans internet | 6 | 20-21 nov. |

## État au 2026-10-21

Les 6 étapes sont réalisées sur la branche `feat/app` (419 tests unitaires, 13 parcours d'interface sur Chrome, image Docker vérifiée). Décisions prises et points reportés : `docs/superpowers/plans/2026-10-21-99-bilan.md`. Reste : la **répétition générale** sur le PC de la table centrale.

## Pourquoi cet ordre
- **La fiche club part en premier** (étape 2) : les clubs doivent la recevoir plusieurs semaines avant la compétition, alors que l'export FFK n'arrive qu'à la clôture. Solution de secours si l'étape 2 prend du retard : le modèle .ods peut être produit et envoyé seul ; son import suivra.
- **Les tableaux (4) avant le recasement (5)** : l'aperçu des recasements montre « qui rencontre qui », ce qui demande le moteur de tableaux.
- **La logique métier** (grille, recasement, tableaux, classements) vit dans `src/domain`, en TypeScript pur, couverte par des tests unitaires. L'interface est testée sur Chrome avec Playwright.

## Ce que chaque étape doit laisser en place
- Tous les tests passent : `npm test`, `npm run test:e2e`, `npm run typecheck`.
- L'image Docker se construit et démarre (`docker compose up --build`).
- La spec est mise à jour si une décision change (§19 Décisions).

## Points d'attention transverses
- **Données personnelles** : `coupe-shidokan.xlsx` contient de vrais noms. Il **n'est jamais commité** ; les tests utilisent des fichiers anonymisés construits à partir de sa structure (étape 3).
- **Grille modifiable** (étape 2 et suivantes) : supprimer une catégorie de poids qui contient des inscriptions est refusé, avec un message qui indique combien d'inscriptions sont concernées.
- **Modèles de grille** (enregistrer une grille modifiée pour les compétitions suivantes, spec §4.3) : étape 6, en finition.
