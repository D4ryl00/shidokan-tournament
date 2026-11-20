# Ignorer une carte, écart de poids des grandes catégories, poids sur les Tableaux, autorisations, export FFK, récapitulatif club

Date : 2026-11-20 · statut : à approuver (relu par un constructeur)

Six changements avant la compétition du 22 novembre.

## 1. Réaffectation : « Ignorer » une carte

**Pourquoi.** Certains problèmes sont tranchés « on laisse comme ça ». Aujourd'hui la seule sortie est « Mettre de côté », qui veut dire « à reprendre plus tard » : rappel au lancement, compteur orange, et aucune trace dans l'Historique. Une mise de côté ne revient pas non plus quand la situation s'aggrave.

**Approches envisagées.**
- **A. Nouvelle action « Ignorer », à côté de « Mettre de côté »** (choisie par l'utilisateur). Deux sens bien distincts : « à reprendre plus tard » et « réglé ».
- B. Enrichir « Mettre de côté » (Historique, retour sur nouvel élément) : un seul bouton, mais le rappel au lancement perd son sens pour les cas réglés.

**Ce qui est décidé.**
- Bouton « Ignorer » sur chaque carte de cas (à côté de « Mettre de côté »), et sur une carte mise de côté (l'ignorer retire la mise de côté).
- Une carte ignorée ne compte plus dans les cas à traiter, ni dans le plan d'ensemble, ni dans le rappel au lancement.
- Elle entre dans l'**Historique** comme une action « Ignoré » (nom du combattant, catégorie, motif de la carte). L'annuler depuis l'Historique fait revenir la carte.
- **Pas reproposée tant que rien de nouveau.** L'ignorance mémorise l'empreinte de la situation. Si l'empreinte change, la carte revient dans la liste principale et la marque est oubliée. L'entrée d'Historique reste, avec une mention « revenue : la situation a changé ».
- Si le problème disparaît (adversaire arrivé, poids corrigé), la marque est oubliée comme pour une mise de côté.
- « Repartir de zéro » emporte aussi les cartes ignorées depuis la session choisie.

**Mes choix (à corriger si besoin).**
- Empreinte = type de cas + texte du motif + combattants actifs de la catégorie concernée, avec leur poids retenu (pesé, sinon déclaré). Pour un « Retour possible », la catégorie d'origine compte aussi. Un nouvel arrivant, un absent, une pesée ou un poids déclaré modifié changent donc l'empreinte.
- Une section repliée « Ignorées (n) » en bas de la page, comme « Mises de côté », avec « Reprendre ». Sans elle, une carte ignorée ne serait visible que dans l'Historique.
- Pas de note obligatoire. Note facultative, comme la mise de côté.
- Stockage : une table `ignored_cases` sur le modèle de `set_aside_cases` (compétition, cas, empreinte, note, session, entrée d'Historique), incluse dans le paquet de synchronisation. Nouveau type d'Historique `ignore` (filtre « Plan »), sans changement des tableaux : rien à remettre en place à l'annulation, à part la carte. Il ne bloque pas l'annulation des autres actions et n'est pas emporté par leur cascade.
- Une carte « Écart de poids » dépend du combattant le plus éloigné : si ce n'est plus le même, l'ancienne carte a disparu et la nouvelle est un nouveau problème.
- Le journal couvre les nouvelles routes (`ignore`, `unignore`), et les permissions sont les mêmes que pour `set-aside`.

## 2. Pas d'alerte d'écart de poids imposé par la catégorie

**Pourquoi.** La carte « Écart de poids de X kg dans la catégorie (max 5 kg) » apparaît dans des catégories larges ou sans limite (-30 kg, +80 kg). Là, l'écart vient de la grille et on n'y peut rien.

**Ce qui est décidé.**
- Catégorie d'**une seule** catégorie de poids de la grille : l'écart toléré = le plus grand entre le seuil réglé et la largeur de la catégorie (de -45 à -55 kg : 10 kg).
- Catégorie sans limite basse (la plus légère de la grille) ou sans limite haute (« + ») : aucune carte d'écart de poids.
- Catégories fusionnées par un déplacement (plusieurs catégories de poids) : seuil réglé inchangé, puisque là l'écart vient du déplacement.
- Même tolérance pour décider si un combattant seul peut revenir dans sa catégorie d'origine (« Retour possible »).
- Les autorisations « Poids » (face à un adversaire d'une catégorie plus lourde) ne changent pas.
- Les propositions de déplacement (badges ⚖ Poids / ⚖ Poids +) ne changent pas : un déplacement garde le seuil réglé.

**Précisions.** « Une seule catégorie de poids » = `key.weightClassIds.length === 1` (un déplacement ne change jamais le `weightClassId` du combattant : une fusion se voit toujours à plusieurs catégories). Les « Détails » d'un retour possible montrent la même tolérance que la carte.

**Laissé au constructeur.** La largeur d'une catégorie se lit dans la grille (limite précédente du même âge et sexe → limite de la catégorie). L'aide (`help.ts`, carte « Écart de poids », réglage « Écart de poids max ») dit la nouvelle règle.

## 3. Poids sur les cartes des Tableaux

- Sur chaque pastille de combattant : « 68,5 kg » si pesé, sinon « ≈ 68 kg » (déclaré), sinon rien. Même format que les colonnes de Réaffectation. Rien en kata (discipline sans poids).
- Où : cartes de la Planche, bac des combattants seuls, cartes de la Galaxie (petit texte discret ; dans la Galaxie compacte, sur la ligne du nom s'il tient, sinon au survol avec le club).
- Source : les inscriptions déjà chargées par `useEntrantInfo` (`weighInKg`, `approxWeightKg`, discipline avec poids).

## 4. Autorisations : copie par session sans formule, et vue « Toutes les sessions »

**Pourquoi.** L'organisateur copie le texte session par session pour être complet avec un club : la formule (« Bonjour… », « Merci… ») se retrouve alors en double à chaque collage.

**Ce qui est décidé (choix « les deux »).**
- La section ③ Autorisations reçoit son propre choix « Cette session » / « Toutes les sessions » (« Cette session » par défaut ; l'API accepte déjà l'absence de session).
- **Cette session** : « 📋 Copier pour le club » et « 📋 Copier tout » copient seulement les combattants numérotés et leurs puces, sans « Bonjour », sans phrase d'introduction et sans demande finale. « Copier tout » garde l'en-tête `=== Club ===` entre les clubs.
- **Toutes les sessions** : un seul texte par club, avec une numérotation continue et la formule une seule fois (le message actuel de `clubMessage`).
- L'aide (`reaffectation.autorisations`) le dit.

**Laissé au constructeur.** Sans sessions, le choix est masqué. L'ordre des combattants en vue « Toutes les sessions » reste celui de la liste (session puis ordre actuel). Le compteur ⏳ du titre suit la vue choisie.

## 5. Export FFK (modèle `Shidokan.xlsm`)

**Pourquoi.** La FFK a besoin de connaître les changements faits pendant la compétition. Elle les retrouve en comparant ce fichier, au format de son propre export, avec ce qu'elle avait envoyé.

**Le modèle** (copie de `/Users/remi/Downloads/Shidokan.xlsm`, sans macro) : 5 feuilles dans cet ordre, **Karate, Boxe, Mix Martial, Triathlon, Kata**. Ligne 1 : `Prénom | Nom | Numero | Entite rattachement | Genre | Type | Age | Categorie | Technique`. Calibri 11, pas de remplissage, pas de gel des volets, largeurs de colonnes propres à chaque feuille (à recopier). Valeurs observées :
- Type : `Karate`, `Boxe`, `Kmix`, `Kata` (Triathlon : vide dans le modèle, la cellule A1 contient « Ytiathlon »).
- Genre : `Féminin` / `Masculin`.
- Age : la tranche (`Poussin`, `Pupille`, `Benjamin`, `Minime`, `Cadet`, `Junior`, `Vétéran 1`, `Vétéran 2`) ; adultes : `Séniors jiyu ippon kumite` ou `Séniors shobu ippon kumité` selon le règlement.
- Categorie : nombre négatif pour « -35 » (format de cellule texte `@`), texte `+45` pour une catégorie ouverte ; vide en kata.
- Entite rattachement : `0060690 ETOILE SPORTIVE…` (l'entité FFK du club, déjà stockée : `ffk_entity`).
- Technique : toujours vide.
- Un bloc par catégorie, blocs séparés par des lignes vides ; dans chaque feuille, filles puis garçons, tranches d'âge dans l'ordre, puis poids croissant.

**Ce qui est décidé.**
- Un bouton « Export FFK (.xlsx) » qui produit ce fichier pour la compétition, avec la **situation finale** : une ligne par inscription, dans la feuille de la discipline où elle combat, avec l'âge et le poids de sa catégorie finale.
- **Un combattant absent (désisté) est retiré** du fichier.
- Pas de colonne ajoutée : le modèle est reproduit tel quel.

**Mes choix (à corriger si besoin).**
- Bouton dans la zone des exports de la page Podiums (à côté des exports .ods/.xlsx des résultats), utilisable à tout moment.
- Deux lignes vides entre deux catégories (le modèle en a de 1 à 5, sans règle visible).
- **Catégorie qui n'existe pas dans la grille FFK** (décision de l'utilisateur : « sa catégorie d'inscription ») : une catégorie fusionnée (plusieurs catégories de poids ou plusieurs tranches d'âge), ou une catégorie mixte dont la catégorie de poids n'existe pas pour le sexe du combattant. Le combattant y est écrit avec **sa tranche et sa catégorie de poids d'inscription**. Seul un combattant placé dans une vraie catégorie (une tranche, une catégorie de poids, existant pour son sexe) y est écrit avec cette catégorie. Ainsi des seniors fusionnés avec des Vétérans 1 ne deviennent pas « Vétéran 1 » dans le fichier. Le bloc d'une catégorie fusionnée reste un seul bloc, placé à la position de sa catégorie la plus légère et la plus jeune.
- Discipline ou règlement changés : la feuille et le libellé d'âge (jiyu ou shobu) suivent la catégorie finale, s'ils existent pour le combattant.
- Tableau libre : ses combattants gardent leur catégorie d'inscription (le tableau libre n'a pas d'équivalent FFK).
- Combattant « ne combat pas » (inscription retirée, par exemple catégorie fermée) : retiré, comme un absent.
- Club sans entité FFK : numéro d'affiliation et nom du club, sinon le nom seul.
- Feuille Triathlon : remplie comme les autres s'il y a des inscriptions en triathlon ; sinon recopiée telle quelle (« Ytiathlon » en A1).
- Libellés absents du modèle (Mini-poussins, Espoirs, Vétérans 3 à 5) : ceux que l'import FFK de l'application reconnaît (`ageBandFromLabel`) ; Type de la feuille Triathlon : `Triathlon`.
- Noms et prénoms en majuscules, comme dans le fichier FFK.
- Écrit avec la bibliothèque `xlsx` déjà utilisée pour les exports, en .xlsx (pas de macro à conserver : le .xlsm du modèle n'en contient pas).

## 6. Récapitulatif par club (PDF)

**Pourquoi.** Dire à chaque club, combattant par combattant, ce qui avait été inscrit et ce qu'il fait finalement, désistements compris.

**Ce qui est décidé.**
- Un PDF par club, une ligne par inscription : le combattant ; **inscrit** (discipline, règlement, catégorie d'âge, catégorie de poids) ; **au final** (la catégorie où il combat, ou « Absent (désisté) » pour un absent à la pesée).
- Un bouton par club dans la page Clubs, et « Tous les récapitulatifs » qui télécharge un .zip avec un PDF par club.

**Mes choix (à corriger si besoin).**
- « Inscrit » = les valeurs d'origine de l'inscription quand elle a été déplacée, sinon ses valeurs actuelles.
- En-tête : nom et date de la compétition, nom du club. Combattants par ordre alphabétique, ses inscriptions regroupées.
- Une ligne changée est mise en évidence (fond léger et mot « Changé »), avec le motif en clair quand il existe (« catégorie de poids voisine », « tranche d'âge voisine », « règlement changé »…, comme les badges de réaffectation).
- « Ne combat pas » pour une inscription retirée (catégorie fermée), et « Pas encore placé » pour une inscription sans catégorie.
- Situation au moment du téléchargement : on peut le refaire à tout moment, il dit son heure de création.
- Généré avec `pdf-lib` (déjà utilisé pour la fiche club PDF), le .zip avec `jszip`.
- Un club sans inscription n'a pas de récapitulatif (bouton désactivé, absent du .zip).

## Calendrier

Tout doit être en place avant la compétition du dimanche 22 novembre (décision de l'utilisateur). Ordre de construction, du moins risqué au plus risqué, avec une mise en service possible après chaque point : 4 (copie des autorisations), 3 (poids sur les Tableaux), 2 (écart de poids), 1 (Ignorer, seule migration de base : table `ignored_cases`), puis 5 (export FFK) et 6 (récapitulatif club). Avant la migration, une sauvegarde du serveur ; le conteneur est arrêté proprement (`docker stop`) avant d'être remplacé.

## Hors champ

- Pas de changement des règles de réaffectation elles-mêmes (seuils, règles actives).
- Pas d'ignorance « en masse » (plusieurs cartes d'un coup).

## Tests

TDD : détection (empreinte, retour sur nouvel élément, tolérance des catégories larges ou ouvertes, retour possible), routes `ignore`/`unignore` + Historique + Repartir de zéro, rendu du poids sur la pastille, texte copié avec et sans formule, contenu de l'export FFK (relu par l'import FFK de l'application : chaque ligne doit être reconnue), lignes du récapitulatif club. Vérification de chaque changement visible sur Chrome (et au téléphone dans le simulateur pour la Planche).
