# Ignorer une carte, écart de poids des grandes catégories, poids sur les Tableaux, message d'autorisation

Date : 2026-11-20 · statut : à approuver

Quatre retouches avant la compétition du 22 novembre.

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

**Laissé au constructeur.** La largeur d'une catégorie se lit dans la grille (limite précédente du même âge et sexe → limite de la catégorie). L'aide (`help.ts`, carte « Écart de poids », réglage « Écart de poids max ») dit la nouvelle règle.

## 3. Poids sur les cartes des Tableaux

- Sur chaque pastille de combattant : « 68,5 kg » si pesé, sinon « ≈ 68 kg » (déclaré), sinon rien. Même format que les colonnes de Réaffectation. Rien en kata (discipline sans poids).
- Où : cartes de la Planche, bac des combattants seuls, cartes de la Galaxie (petit texte discret ; dans la Galaxie compacte, sur la ligne du nom s'il tient, sinon au survol avec le club).
- Source : les inscriptions déjà chargées par `useEntrantInfo` (`weighInKg`, `approxWeightKg`, discipline avec poids).

## 4. Message d'autorisation pour le club

**Constat.** Le code de « 📋 Copier pour le club » des Autorisations (`clubMessage`, `src/domain/authorizations-text.ts`) produit déjà « Bonjour, / Voici les points à valider pour vos combattants (Club) : … / Merci de nous confirmer votre accord… ». La page, elle, n'affiche que les combattants. Le « 📋 Copier pour le club » de « Détails » (proposition ou ligne du plan) copie seulement une phrase sur le combattant, sans salutation.

**À faire.** Reproduire sur Chrome ce que copie le bouton qu'utilise l'utilisateur, puis corriger :
- si c'est celui des Autorisations : trouver pourquoi la salutation se perd et la rétablir ;
- si c'est celui des Détails : l'entourer de la même salutation et de la même demande d'accord que les Autorisations.

## Hors champ

- Pas de changement des règles de réaffectation elles-mêmes (seuils, règles actives).
- Pas d'ignorance « en masse » (plusieurs cartes d'un coup).

## Tests

TDD : détection (empreinte, retour sur nouvel élément, tolérance des catégories larges ou ouvertes, retour possible), routes `ignore`/`unignore` + Historique + Repartir de zéro, rendu du poids sur la pastille. Vérification de chaque changement visible sur Chrome (et au téléphone dans le simulateur pour la Planche).
