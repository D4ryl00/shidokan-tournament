# Feuille de route : app de tableaux Shidokan

**Spec :** `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md`
**Échéance :** compétition du **22 novembre 2026**.

Le projet est découpé en étapes (1 à 7 : première version ; 8 à 14 : conception `docs/superpowers/specs/2026-10-22-ordre-de-passage-et-aides-design.md`). Chacune produit une app qui fonctionne et se teste seule, et chacune a son propre plan détaillé dans `docs/superpowers/plans/`. Le plan d'une étape est détaillé **au moment de la commencer**, à partir du code réellement écrit aux étapes précédentes : les interfaces réelles remplacent les suppositions.

| # | Étape | Livrable testable | Dépend de | Cible |
|---|---|---|---|---|
| 1 ✅ | **Socle** | App lancée via Docker : création d'une compétition, réglages, éditeur de la grille FFK, thèmes clair et sombre, logo, tests Chrome | — | 25 oct. |
| 2 ✅ | **Inscriptions et fiche club** | Combattants et inscriptions (saisie manuelle, inscription sur place), **modèle .ods de fiche club** à envoyer aux clubs, import des fiches renvoyées, écran de saisie rapide | 1 | 29 oct. (**envoi de la fiche aux clubs**) |
| 3 ✅ | **Import FFK et rapprochement** | Import .xlsx/.ods/.csv avec correspondance des colonnes, normalisation, aperçu, réimport sans doublons ; rapprochement fiche club ↔ FFK | 2 | 2 nov. |
| 4 ✅ | **Moteur de tableaux et impressions** | Génération des 7 formats de combat et du format kata, tirage avec séparation des clubs, étapes de vie des catégories, impression des tableaux (vierges et remplis) | 2 | 8 nov. |
| 5 ✅ | **Pesée et recasement** | Écran de pesée, moteur de propositions (A à H, R), tableau de bord avec badges, aperçu, validation unitaire et globale, recasement anticipé, régénération | 3, 4 | 14 nov. |
| 6 ✅ | **Jour J** | Tatamis, saisie des résultats, avancement automatique, classements de poule, notation kata, feuilles de résultats, podiums et classement des clubs, exports, sauvegarde automatique et restauration | 4, 5 | 19 nov. |
| 7 ✅ | **Points reportés** | Points mineurs des relectures des étapes 1 à 6 (plan `2026-10-22-07-points-reportes.md`, bilan mis à jour) | 1 à 6 | 22 oct. |
| 8 ✅ | **Aides à l'écran** | Phrase d'aide et bouton ⓘ sur chaque section ; passages d'âge en clair dans la grille (plan `2026-10-22-08-aides.md`) | 1 à 7 | 25 oct. |
| 8 bis ✅ | **Fiche club papier** | Fiche papier à cocher (A4 paysage, logo), fiche .ods au même contenu et aux couleurs Shidokan, saisie des fiches papier, grade, tranches proposées (plan `2026-10-22-08b-fiche-club-papier.md`) | 8 | 28 oct. (**envoi aux clubs**) |
| 9 ✅ | **Zones nommées** | Liste de zones (« Tatami 1 », « Ring »…) remplaçant le nombre de tatamis ; nom imprimé sur les tableaux (plan `2026-10-22-09-zones.md`) | 8 | 28 oct. |
| 10 ✅ | **Vagues** | Vagues (règles par tranche / discipline, ajouts et retraits), pesée et présence par vague (plan `2026-10-22-10-vagues.md`) | 9 | 2 nov. |
| 11 ✅ | **Recasement par vague** | Tableau de bord filtré par vague ; « change de vague » validé un par un (plan `2026-10-22-11-recasement-vagues.md`) | 10 | 5 nov. |
| 12 ✅ | **Ordre de passage** | Répartition sur les zones avec contraintes, kata d'abord, tour par tour / catégorie par catégorie, repos signalé, numéros imprimés, file par zone (plan `2026-10-22-12-ordre-de-passage.md`) | 10 | 10 nov. |
| 13 ✅ | **Figeage et finales** | Figer et imprimer une vague, rouvrir, finales (et finales de kata) sur une zone (plan `2026-10-22-13-figeage-finales.md`) | 12 | 13 nov. |
| 14 ✅ | **Déplacements en cours** | Déplacer une catégorie vers une autre zone, « à la suite » / « mélangés », aperçu, « mis à jour à HH:MM » (plan `2026-10-22-14-deplacements.md`) | 13 | 16 nov. |
| 15 ✅ | **Données compatibles** | Étape 0 de la conception `2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` : identité de l'installation, annuaire des clubs (numéro d'affiliation), main et inscriptions en ligne en base, versions de lignes, règle de garde ; rien de visible (plan `2026-10-23-15-donnees-compatibles.md`) | 14 | 23 oct. |
| 16 ✅ | **Annuaire et inscription en ligne** | Étape B de la conception du 2026-10-23 : annuaire des clubs (création, archivage, fusion), invitations par lien personnel (empreinte seule en base), ouverture et gel, page du club `/inscription/<lien>` (tous les combattants du club, un formulaire par combattant, versions, verrous) ; sur le réseau local en attendant la mise en ligne (plan `2026-10-23-16-annuaire-inscription-en-ligne.md`) | 15 | 23 oct. |
| 17 ✅ | **Mise en ligne et mails** | Étape C de la conception du 2026-10-23 : rôle serveur (comptes, sessions, protection des routes, origine, limites), sauvegardes sans secrets, réglages de l'application (SMTP, mention RGPD, conservation, message aux clubs), envoi des liens par mail (nouveau lien à chaque envoi), effacement automatique après 13 mois, déploiement Ubuntu + Caddy (plan `2026-10-23-17-mise-en-ligne-mails.md`) | 16 | 23 oct. |
| 18 ✅ | **Passage de main** | Étape D de la conception du 2026-10-23 : paquet d'une compétition (recevoir sans toucher aux autres), lecture seule quand la main est ailleurs, jetons de synchronisation, récupérer / prendre la main / copie / rendre la main, reprise forcée, échange par fichier, bandeau de la main (plan `2026-10-23-18-passage-de-main.md`) | 17 | 23 oct. |
| 19 ✅ | **Plusieurs postes** | Étape A de la conception du 2026-10-23 : écrans mis à jour tout seuls (événements du serveur), écritures sur une donnée périmée refusées (révisions), postes Organisation / Table centrale / Zone, copie de secours d'un autre PC, fiche « Préparer le jour J » (plan `2026-10-23-19-plusieurs-postes.md`) | 18 | 23 oct. |
| 20 ✅ | **Tout en ligne** | Étape E de la conception du 2026-10-23 : comptes par rôle (Organisateur, Table centrale, Zone attachée à une zone d'une compétition), refus côté serveur et écran réglé sur le rôle, copie tenue à jour sur le PC, prise de main en secours puis « Prévenir le serveur » (plan `2026-10-23-20-tout-en-ligne.md`) | 19 | 23 oct. |
| 21 ✅ | **Zones autonomes** | Étape F de la conception du 2026-10-23 (conception `2026-10-23-zones-autonomes-design.md`) : portable de zone qui suit le PC principal, « Continuer sans réseau » limité aux saisies de sa zone avec journal, « Repasser en ligne » ou journal par fichier, rejeu sur le PC principal et cartes « À trancher », finales jouées ici, copie plus récente sans perdre ses saisies (plan `2026-10-23-21-zones-autonomes.md`) | 20 | 23 oct. |
| 22 ✅ | **Refonte de l'interface** | Conception `2026-10-24-refonte-ui-ux-design.md` : style « B » en sombre et en clair (jetons, police Inter embarquée), barre compacte et onglets par étape (Préparer, Jour J, Après), écrans refaits un à un (états vides, sections en carte, Combats « à l'appel » de 1 à 4 zones), vrais pluriels partout ; impressions inchangées (plan `2026-10-24-22-refonte-ui-ux.md`) | 21 | avant le 20 nov. |
| 23 ✅ | **Catégories fermées** | Conception `2026-10-25-categories-fermees-et-cartes-de-cote-design.md` : cases ouvertes / fermées par compétition (fiche club, inscription en ligne), carte « Catégorie fermée » et « Ne combat pas » en Réaffectation, cartes mises de côté (plan `2026-10-25-23-categories-fermees.md`) | 22 | avant le 29 oct. |
| 24 ✅ | **Plan d'ensemble de la réaffectation** | Conception `2026-10-25-plan-d-ensemble-reaffectation-design.md` : liste de règles ordonnée par compétition (interrupteurs, ligne de coupure, règles par défaut de l'application), calcul d'un plan pour toute la session, barres « combattants seuls » par règle, « Voir le plan » / « Appliquer le plan » à la place des boutons de classement automatique, tranche d'âge au-dessous (plan `2026-10-25-24-plan-d-ensemble.md`) | 23 | 26 oct. |
| — | **Répétition générale** | Compétition fictive complète sur le PC de la table centrale, avec Docker et sans internet | 6 | 20-21 nov. |

## État au 2026-10-22

Les étapes 1 à 14 sont réalisées, relues et fusionnées dans `main` (659 tests unitaires, 43 parcours d'interface sur Chrome, image Docker construite et démarrée, migrations 0012 et 0013 comprises). Décisions prises, corrections après relecture et points mineurs : `docs/superpowers/plans/2026-10-21-99-bilan.md`. La conception principale renvoie au second document pour les vagues, les zones et l'ordre de passage. Retours de l'organisateur sur la compétition Démo traités le 2026-10-23 (666 tests unitaires, 44 parcours d'interface ; voir le bilan). Reste : la **répétition générale** sur le PC de la table centrale.

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
