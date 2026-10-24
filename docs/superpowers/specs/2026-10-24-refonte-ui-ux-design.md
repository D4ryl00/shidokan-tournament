# Refonte de l'interface (UI et UX) — conception

**Date :** 2026-10-24 · **Demande de l'organisateur :** « refaire une passe sur l'UI et l'UX, pour avoir une app à l'esthétique léchée, qui donne envie et qui soit simple d'utilisation ». Aujourd'hui, plein de petites erreurs donnent l'impression que l'app n'est pas finie.

Légende : ✅ décidé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

Maquettes de référence (direction retenue, thèmes sombre et clair, écrans Combats et Inscriptions) : `.superpowers/brainstorm/5689-1792799861/content/direction-b-clair-sombre.html` (fichier local, non versionné) ; les jetons de couleur du §4.1 en sont tirés.

---

## 1. Pourquoi

L'app marche, mais elle n'en a pas l'air. Le tour de toutes les pages dans Chrome (2026-10-24, sombre et clair, 1384 et 1044 px de large) a relevé :

1. **Barre du haut** : titre « Shidokan France — Compétitions » sur deux lignes ; « Annuaire des clubs » et « Réglages de l'application » passent à la ligne ; « Comptes » n'est pas aligné avec eux. Vers 1000 px, le titre est coupé en haut, et « Se déconnecter » et le choix du thème sont tronqués à droite.
2. **En-tête d'une compétition** : 12 onglets sur une seule ligne (deux lignes en petit portable) ; badge « Gérée ici » isolé sous le titre ; le choix du poste flotte à droite sans lien avec le reste.
3. **Réglages** (compétition et application) : cadres « fieldset » avec le titre posé sur le trait (aspect daté) ; le contenu n'occupe que les deux tiers de la largeur, avec un grand vide à droite.
4. **Clubs, Grille** : un champ de saisie dans chaque case du tableau (effet tableur brut).
5. **Combats** : cartes de zone trop étroites, textes coupés au milieu (« Minimes M, 2 / katakas ») ; sélecteur de zone et champ d'ordre répétés sous chaque catégorie de la liste ; badge « EN PRÉPARATION » minuscule.
6. **Badges et textes** : badges minuscules en majuscules partout (« 2 INSCRIT(S) », « PROVISOIRE », « SUR PLACE ») ; « (s) » au lieu de vrais pluriels (« 0 présent(s) », « 83 inscription(s) sur 83 »).
7. **Incohérences** : dans Podiums, une catégorie jamais commencée s'affiche « En cours » ; exports présentés tantôt en boutons, tantôt en liens dans la même barre ; date limite affichée « dd/mm/yyyy » (champ date du navigateur).
8. **Ambiance** : en sombre, des gris uniformes sans hiérarchie ; en clair, propre mais plat ; le violet Shidokan est peu mis en valeur.

Ce qui va déjà bien et sert de base : la page d'inscription des clubs (propre, aussi sur téléphone), les compteurs de la réaffectation.

**Réussi si :**
- aucune page ne montre de texte coupé, de barre qui passe à la ligne, d'élément mal aligné ou de « (s) », de 1280 à 1920 px de large, en sombre comme en clair ;
- l'app a une identité : on reconnaît Shidokan France, l'écran du jour J se lit de loin ;
- on trouve l'action principale de chaque écran sans chercher, et on la retrouve au même endroit d'un écran à l'autre ;
- aucune fonction n'a disparu, aucun calcul n'a changé, tous les tests restent verts.

**Échec même si « ça marche » :**
- un écran refait dans le nouveau style à côté d'écrans restés dans l'ancien (mélange de styles) ;
- un thème soigné et l'autre négligé ;
- une fonction devenue plus difficile à atteindre qu'avant (plus de clics pour un geste fréquent du jour J) ;
- un parcours connu de l'organisateur cassé sans raison (adresse d'un onglet, emplacement d'un bouton qu'il utilise souvent) sans que le nouvel emplacement soit évident.

## 2. Objectifs, non-objectifs

**Objectifs**
- Corriger tous les défauts du §1, et ceux du même genre trouvés en refaisant chaque écran.
- Un système visuel unique (§4) appliqué à toute l'app : la direction **B** ✅ (« sombre, esprit tableau d'affichage »), avec un **thème clair aussi soigné que le sombre** ✅.
- Une navigation plus simple (§5) : les onglets d'une compétition rangés par étape.
- Des écrans plus clairs (§6) : une action principale par zone d'écran, des états vides et des chargements soignés, de vrais pluriels.

**Non-objectifs**
- Pas de version téléphone pour l'organisation. Appareils : **surtout des PC portables** ✅. Rendu impeccable de 1280 à 1920 px, encore correct vers 1024 px 💡. La page publique des clubs reste utilisable sur téléphone, comme aujourd'hui.
- Pas de changement des données, du fonctionnement du serveur, des règles métier, des droits ni des échanges entre installations. Sont permis 💡 : corriger les textes renvoyés par le serveur (pluriels « (s) » des messages), et ajouter à la liste des compétitions des informations en lecture seule (nombre d'inscrits, état de la main).
- Pas de changement d'allure des **feuilles imprimées** (tableaux, feuilles de pesée, fiche club papier, podiums imprimés) 💡 : elles sont faites pour le papier ; seuls leurs défauts éventuels sont corrigés.
- Pas de nouvelle fonction.

**Anti-objectifs**
- Une refonte qui casse les habitudes du jour J sans gain (§1, échec).
- Un style « gadget » (animations partout, effets) qui ralentit ou distrait.
- Dépendre d'internet : l'app tourne le jour J sans réseau extérieur.

## 3. Contraintes

- **Calendrier** ✅ : la refonte doit être **prête pour la compétition du 22 novembre 2026**, donc terminée, vérifiée et fusionnée **avant la répétition générale des 20-21 novembre**. Pour ne jamais livrer un mélange de styles, elle se fait sur une branche à part et n'est fusionnée dans `main` (ce qui publie une version et son image) qu'une fois **tous** les écrans refaits et vérifiés 💡. Si elle risque de ne pas être finie à temps, l'organisateur est prévenu assez tôt pour choisir : garder la version actuelle pour le 22, ou réduire le périmètre d'un commun accord.
- **Tatamis** ✅ : de 1 à 4 zones le jour J. Les écrans sont conçus et vérifiés avec 1, 2, 3 et 4 zones, sans texte coupé (au-delà, l'app doit rester utilisable, sans exigence de mise en page).
- **Hors ligne** : aucune ressource chargée depuis internet (police, icônes, images). Une police ajoutée est embarquée dans l'app (paquet npm, par exemple `@fontsource-variable/inter`) 💡.
- **Bibliothèque** : Mantine 8 reste ✅ (thème, composants) ; pas de changement de bibliothèque d'interface. Ajouter un paquet Mantine officiel (par exemple `@mantine/dates`) est permis 🔧.
- **Adresses** : les adresses des pages et des onglets ne changent pas (`/competitions/:id/inscriptions`, `/combats`…, `/parametres`, `/annuaire`, `/comptes`, `/inscription/:jeton`) : signets, liens des clubs et tests en dépendent.
- **Tests** : les identifiants `data-testid` existants restent (les 58 parcours e2e s'en servent). Un parcours e2e qui cherche un texte ou un rôle déplacé est mis à jour, pas supprimé. `npm run typecheck && npm test && npm run test:e2e` restent verts.
- **Postes et rôles** : les postes (Organisation, Table centrale, Zone), les comptes en ligne (Organisateur, Table, Zone) et le portable de zone (zone autonome) gardent exactement ce qu'ils voient et peuvent faire aujourd'hui ; seule la présentation change.
- **Les deux rôles d'installation** : le PC (rôle local, sans connexion) et le serveur en ligne (connexion, comptes) sont refaits tous les deux.
- **Textes d'aide** (`src/web/help.ts`) : inchangés, sauf ceux qui citent un bouton ou un onglet déplacé, et la règle de leurs tests (phrase courte ≤ 160 caractères…).
- **Langue** : tout en français, typographie française (espaces avant « : ; ? ! », guillemets « », apostrophe ’), vrais pluriels.

## 4. Système visuel (direction B) ✅

### 4.1 Couleurs (jetons des deux thèmes)

Tirés des maquettes ; même sens dans les deux thèmes.

| Rôle | Sombre | Clair |
|---|---|---|
| Fond de page | `#141118` | `#f7f5f9` |
| Barres (haut, sous-onglets) | `#141118`, trait `#2a2431` | `#ffffff`, trait `#ebe6ef` |
| Carte / panneau | `#1d1922`, bord `#2c2633` | `#ffffff`, bord `#e7e1ec` |
| Texte | `#f1edf5` | `#1d1622` |
| Texte secondaire | `#b9b1c2` | `#4b4354` |
| Texte discret | `#8d8497` | `#7b7186` |
| Violet d'action (boutons principaux, onglet actif) | `#c17ad3`, texte dessus `#1a0f1f` | `#722f82` (violet du logo), texte dessus `#ffffff` |
| Mise en avant (« à l'appel ») | dégradé `#3b1f47 → #2a1833` | dégradé `#f3e6f7 → #fbf6fd` |
| Puce neutre / étape active | `#2a2131`, texte `#e3c6ec` | `#f1e4f6`, texte `#722f82` |
| Succès (« Gérée ici », terminé) | `#1f2a22`, texte `#7fd6a0` | `#e6f5ec`, texte `#1f7a45` |
| Attention (sur place, à traiter, en préparation) | `#33281a`, texte `#f0b766` | `#fff3df`, texte `#9a5a00` |
| Erreur, danger | rouge de Mantine, accordé à ces fonds 🔧 | idem |

- Le violet n'est pas partout : il marque **l'action principale** et l'élément actif. Le reste est neutre.
- La palette `shidokan` de Mantine est recalculée autour de ces deux violets 🔧 ; les couleurs de fond et de texte passent par les variables du thème (pas de couleurs écrites en dur dans les écrans).
- Contraste lisible (texte courant au moins 4,5:1) dans les deux thèmes 💡.

### 4.2 Typographie
- Une police moderne embarquée (Inter, variable) 💡, chiffres tabulaires pour les numéros, poids, scores et compteurs.
- Hiérarchie : titre de page, titre de section, texte, texte discret ; pas plus de 4 tailles courantes.
- **Grands caractères réservés au jour J** : numéro de passage et noms des combattants « à l'appel » (Combats), poids saisi (Pesée), noms dans la saisie d'un résultat.

### 4.3 Composants
- **Boutons** : un seul bouton principal (violet plein) par zone d'écran ; les autres en contour ou discrets ; actions dangereuses en rouge discret, avec confirmation comme aujourd'hui. Libellés courts et constants (« Ajouter », « Enregistrer », « Importer »…).
- **Badges** : en minuscules (première lettre en capitale), taille lisible, couleur selon le sens (§4.1) ; plus de badges en majuscules minuscules.
- **Cartes et sections** : les cadres « fieldset » sont remplacés par des sections en carte, avec un titre, une phrase d'aide et le contenu ; espacements réguliers.
- **Tableaux** : en-tête discret, lignes aérées, survol, alternance légère ; les colonnes de chiffres alignées à droite ; actions de ligne regroupées à droite.
- **Formulaires** : libellés au-dessus, aides sous le champ, largeurs adaptées au contenu ; dates au format français (plus de « dd/mm/yyyy ») 🔧.
- **États** : chaque liste a un état vide qui dit quoi faire ; chargements discrets (squelettes ou indicateur), sans saut de mise en page ; erreurs affichées près de l'action.
- **Pluriels** : une fonction commune (`0 présent`, `1 présent`, `3 présents` ; « 83 inscriptions ») ; plus aucun « (s) ».

## 5. Navigation et cadre

### 5.1 Barre du haut de l'application
- Sur une seule ligne, jamais coupée à partir de 1024 px : logo + « Shidokan France » (titre court ; « Compétitions » devient le premier lien) 💡.
- Liens : Compétitions, Annuaire, Réglages (de l'application) ; pour un organisateur en ligne, Comptes.
- Le compte connecté et « Se déconnecter » sont rangés dans un menu (initiales ou icône, avec l'adresse e-mail) 💡 ; « Mon mot de passe » pour un compte Table ou Zone y est aussi.
- Le choix du thème (Auto, Clair, Sombre) devient un bouton icône avec menu 💡.

### 5.2 En-tête d'une compétition 💡
- Sur les écrans d'une compétition, **une seule barre compacte** remplace la barre de l'application et l'en-tête actuel (comme la maquette, pour garder de la hauteur au jour J) : logo (retour aux compétitions) · nom de la compétition (date et lieu en texte discret, ou au survol si la place manque) · **étapes** (§5.3) · état de la main en puce colorée (« Gérée ici », « Copie du serveur… », « Zone autonome… ») · **poste**, compact · menu du compte et du thème. Juste en dessous : les onglets de l'étape.
- Les liens de l'application (Annuaire, Réglages, Comptes) restent accessibles depuis le menu du compte ou le logo sur ces écrans 🔧.
- Les bandeaux importants (copie en lecture seule, secours, zone autonome) restent bien visibles sous les onglets, dans le nouveau style.

### 5.3 Onglets par étape ✅
Deux niveaux : l'étape, puis ses onglets.

| Étape | Onglets (adresses inchangées) |
|---|---|
| **Préparer** | Inscriptions, Clubs, Fiche club, Import FFK, Sessions, Grille âge / poids, Réglages |
| **Jour J** | Pesée, Réaffectation, Tableaux, Combats |
| **Après** | Podiums |

- L'étape suit l'onglet ouvert (ouvrir `/combats` met « Jour J » en avant).
- Cliquer une étape ouvre son dernier onglet visité, sinon le premier 💡.
- Avec un poste : seules les étapes et les onglets permis s'affichent (Table centrale : Préparer réduit à Inscriptions et Clubs, Jour J, Après ; Zone : Jour J réduit à Tableaux et Combats). Une étape avec un seul onglet, ou un poste avec une seule étape, n'affiche pas la barre inutile 💡.
- Les aides de chaque onglet (phrase et bouton ⓘ) restent sous les onglets.

## 6. Écrans

Pour chaque écran : nouveau style (§4), défauts corrigés, et ces changements de parcours. Rien n'est retiré.

- **Compétitions** (accueil) : liste en cartes ou en tableau soigné, avec date, lieu, état de la main et nombre d'inscrits 🔧 ; « Nouvelle compétition » en action principale, « Importer (fichier) » à côté ; état vide accueillant.
- **Inscriptions** : en-tête « 83 inscriptions » avec un résumé (clubs, catégories) ; barre de filtres sur une ligne ; « Ajouter » en action principale ; origine en badge coloré ; actions de ligne discrètes.
- **Clubs** : tableau lisible ; la modification d'un club se fait sans un champ dans chaque case (édition en ligne au clic, ou fenêtre) 🔧 ; le pré-accord reste modifiable d'un clic.
- **Fiche club** : les trois temps (inscriptions en ligne, envoyer le modèle, importer / saisir) en sections claires ; date limite au format français.
- **Import FFK, Sessions, Grille** : sections en carte ; la Grille en tableau éditable propre (même règle que Clubs).
- **Pesée** : recherche et compteurs (présents, absents, non pesés) en haut ; le champ poids lisible ; présence en contrôle segmenté net.
- **Réaffectation** : compteurs gardés, dans le nouveau style ; cartes de cas aérées ; action principale « Valider » constante.
- **Tableaux** : liste des catégories à gauche (filtres, badges lisibles), tableau à droite ; actions de la catégorie (format, tirage, prête, imprimer) regroupées dans une barre.
- **Combats** (écran le plus important du jour J) ✅ comme les maquettes :
  - par zone, le **combat « à l'appel »** en tête : le premier passage de la file, dans l'ordre actuel (grand numéro, deux noms, catégorie, bouton « Saisir le résultat », ou « Noter » pour un kata) ; les suivants en liste compacte, sans texte coupé, **chacun avec son propre bouton** « Saisir » ou « Noter », plus discret (aucun clic de plus qu'aujourd'hui) 💡 ;
  - un passage « En attente d'une décision à la table centrale » reste à sa place dans la file, sans bouton, même s'il est le premier (l'ordre affiché ne change jamais) 💡 ;
  - de 1 à 4 zones ✅ : cartes côte à côte, sans texte coupé à 1280 px ; avec 1 zone, la carte ne s'étire pas sur toute la largeur ;
  - l'état de la session (« Session en préparation », « Figée »…) et « Figer et imprimer » dans une barre en haut ;
  - la liste des catégories reste à gauche, repliable ; la **zone** d'une catégorie s'y affiche en badge et se change toujours en un clic depuis la ligne (même effet, même règles de déplacement qu'aujourd'hui) ; seul le champ **ordre**, plus rare, passe dans le panneau de la catégorie choisie 💡 ;
  - cartes « À trancher », « En attente d'une décision », messages de zone autonome : dans le nouveau style.
- **Podiums** : cartes de catégorie avec un état juste (« À disputer », « En cours », « Terminée ») ; exports regroupés (un bouton « Exporter » avec menu, ou une rangée de boutons homogène) 🔧 ; sauvegardes dans une section.
- **Réglages de la compétition** : sections en carte sur toute la largeur utile ; un sommaire des sections 🔧.
- **Réglages de l'application, Annuaire, Comptes, Connexion** : même style ; la connexion présente le logo et le nom en grand.
- **Page publique d'un club** (`/inscription/:jeton`) : même identité (logo, couleurs, police), toujours sur téléphone.
- **Fenêtres** (saisie d'un résultat, déplacement, départage, confirmations) : titres clairs, action principale à droite, noms des combattants bien lisibles dans la saisie d'un résultat.

## 7. Vérification
- Chaque écran est revu dans **Chrome**, en **sombre et en clair**, à **1440 px** et **1280 px** (et un passage à 1024 px), avec la compétition de démonstration (`npm run seed:dev`) et sur les deux rôles (PC et serveur en ligne, connecté). L'écran Combats est revu avec 1, 2, 3 et 4 zones.
- Liste à cocher tirée du §1 : chaque défaut constaté disparaît.
- `npm run typecheck && npm test && npm run test:e2e` verts.

## 8. Laissé au constructeur 🔧
- Découpage en étapes et ordre (les fondations — thème, police, barre, onglets — d'abord, puis les écrans).
- Choix exacts des composants (menus, édition en ligne ou fenêtre, squelettes), tant qu'ils respectent §4 et §5.
- Recalcul de la palette Mantine, nuances intermédiaires, rouge de danger.
- Détails de mise en page de chaque écran non précisés au §6.
