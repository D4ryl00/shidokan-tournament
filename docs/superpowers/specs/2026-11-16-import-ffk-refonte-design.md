# Import FFK : tout trancher sur une seule page, importer ce qui est prêt

Refonte de la page « Import FFK » (onglet de la compétition, `src/web/pages/FfkImportPage.tsx`). Maquette validée avec
l'organisateur le 2026-11-16 : https://claude.ai/artifact/RtvjpY5Di95SXADui6NVuA (version 8, noms fictifs).

Prérequis séparé (étape à part, faite avant) : le **numéro de licence** devient visible et modifiable partout où l'on
saisit un combattant (fenêtre combattant, fiches club PDF et ODS, saisie de la fiche papier, import de la fiche
renvoyée). Cette refonte s'appuie dessus (champ « N° de licence » de la carte), sans en dépendre pour fonctionner.

## Pourquoi

À l'import de l'export FFK de la Coupe (2026-11-22), l'aperçu actuel bloque ou laisse l'organisateur sans moyen d'agir :

- un club « Nouveau » se crée sans ses coordonnées, et tant qu'il n'est pas relié, ses combattants partent en
  « rapprochements à trancher » (60 cas sur l'export réel) ;
- un rapprochement ne propose que les candidats trouvés par l'app ; impossible de choisir un autre inscrit ;
- on ne voit pas ce qui va changer sur la fiche du combattant, ni choisir la valeur à garder ;
- une ligne en erreur (poids « 70 » sans signe, « +60 » inconnu chez les cadettes) est simplement rejetée ;
- les catégories de poids absentes de la grille sont créées sans demander ;
- les fiches club absentes de l'export ne proposent aucune action ;
- « Importer » reste bloqué tant que tout n'est pas tranché.

L'organisateur veut **trancher ce qu'il peut, importer le reste tel quel, et retrouver au prochain import uniquement ce
qui n'a pas été tranché.**

## Objectifs

- Une page en quatre étapes, dans cet ordre : catégories de poids, clubs, combattants de l'export, fiches club sans
  inscription FFK. Un résumé collé en haut (« N à trancher : x clubs · y combattants »).
- **Par défaut, rien ne change** : aucune catégorie créée, aucun club relié ou créé s'il n'est pas sûr, aucune fiche
  supprimée, aucune ligne douteuse liée, **aucune différence avec la fiche appliquée sans validation**. Ce qui est « sans
  problème » est importé : rapprochement sûr et aucune différence avec la fiche (seulement des champs vides de la fiche
  à compléter), ou nouveau combattant sans candidat.
- **« Importer… » n'est jamais bloqué.** Il ouvre une fenêtre de confirmation qui récapitule tout ce qui va être fait,
  puis applique ce qui est tranché ou sans problème ; le reste est laissé tel quel et revient au prochain import.
- Toute décision se défait (relier / délier, lier / ne pas lier, annuler mes modifications).
- Chercher un club ou un combattant **par son nom** (résultats à cocher), jamais en faisant défiler une longue liste.

## Hors du sujet

- La lecture du fichier et l'étape « Onglets et colonnes » (inchangées ; le nouveau format 2026-2027 est déjà lu).
- L'import du PDF FFK par club (`ffk-pdf-*`) et l'import de la fiche renvoyée : inchangés (leurs composants sont
  réutilisés, pas modifiés dans leur comportement).
- Enregistrer un brouillon pour reprendre plus tard : remplacé par l'import partiel (on réimporte le même fichier).

## À ne pas faire

- Modifier une donnée qui n'a pas été tranchée, ou que l'organisateur n'a pas vue (pas de création de catégorie, de
  club ou de suppression d'office).
- Bloquer l'import parce qu'il reste des points à trancher.
- Obliger à valider ou écarter une carte une fois ouverte : on doit pouvoir revenir à l'état de départ.
- Faire défiler une liste de 200 combattants ou 60 clubs pour en trouver un.
- Une deuxième fenêtre « Ajouter un club » ou un deuxième formulaire combattant, différents de ceux de l'app.

## Approches

- **A. Le serveur recalcule l'aperçu à chaque décision (choisie).** Extension du fonctionnement actuel : la page envoie
  ses décisions (`choices`) à `POST …/ffk-imports/:uploadId/preview`, le serveur recalcule le plan (`planFfkImport`,
  domaine pur, testé) ; ce qu'on tape dans une carte reste dans la page jusqu'à « Valider la carte », puis entre dans
  `choices`. À l'import, `…/commit` recalcule, vérifie l'empreinte et n'applique que le tranché. La règle de
  rapprochement reste en un seul endroit. Coût : un aller-retour par décision (invisible sur le PC local).
- B. La page calcule tout et n'envoie que la liste finale ; le serveur revérifie. Plus réactif, mais les règles (lien de
  club qui rapproche les combattants, catégorie cochée qui règle une carte) existeraient en deux endroits.
- C. Enregistrer chaque carte à sa validation (comme l'Import Fiche Club). Écartée : l'organisateur veut un seul import
  final avec son récapitulatif.

## Ce qui a été décidé

### 1. Catégories de poids absentes de la grille

- Une case par catégorie que l'export utilise et que la grille n'a pas (`newWeightClasses` d'aujourd'hui), avec le
  nombre de combattants concernés. **Décochées par défaut.**
- Cochée : la catégorie sera créée à l'import et ses combattants y sont placés (leur carte devient « sans problème » si
  rien d'autre ne manque).
- Décochée : le poids de ces combattants est « à choisir » dans leur carte, parmi les catégories de la grille.
- Le plan dépend des cases cochées (nouvelle entrée de `choices`, p. ex. `acceptedWeightClasses: string[]`).

### 2. Clubs

- Une **carte par club** de l'export, séparées visuellement (bord orange tant que non relié, vert une fois relié).
- Choix sous forme d'options à cocher :
  - « Relier à <club proposé> » (proposition actuelle : même entité FFK, alias, même nom, ou nom proche « à vérifier ») ;
  - « Ne pas relier pour l'instant » (ses nouveaux combattants sont laissés de côté) ;
  - une recherche « Chercher un autre club par son nom… » (résultats à cocher dès 2 lettres) ;
  - « ➕ Créer un club… » : ouvre **la fenêtre « Ajouter un club » de l'annuaire** (`ClubEntryModal`, même champs :
    Nom*, N° d'affiliation FFK, Coach, Téléphone, E-mails, Notes), **pré-remplie** avec le nom et le numéro tirés de
    l'entité FFK. « Enregistrer » crée le club tout de suite (comme partout dans l'app, `useCreateCompetitionClub`) ;
    il est alors relié.
- Défaut : relié seulement si le lien est **sûr** (comme aujourd'hui) ; « à vérifier » et « nouveau » démarrent sur
  « Ne pas relier pour l'instant ».
- Un club sûr est replié (« Relié d'office ») avec un bouton « Modifier » qui ouvre les mêmes choix.
- Le lien vaut pour tous les combattants de ce club dans cet import : relier un club peut rendre sûrs des rapprochements
  (« même nom, club pas relié » → rapproché), délier les défait.
- Mémorisé à l'import, comme aujourd'hui (décidé le 2026-11-16) : un lien sûr ou choisi par l'organisateur écrit
  l'entité FFK sur le club de la compétition (`clubs.ffkEntity`) et l'alias nom → entité (`club_aliases`, toutes
  compétitions). Au réimport, le club est « Sûr » et ne redemande rien ; « Modifier » corrige un lien fait par erreur
  (le nouveau lien remplace l'ancien à l'import suivant).
- Proposition de plus (mon choix) : reconnaître aussi un club par son **N° d'affiliation FFK** (chiffres en tête de
  l'entité), sur le club de la compétition ou sa fiche d'annuaire. La fenêtre « Ajouter un club » le pré-remplit ; un
  club créé ainsi est donc reconnu aux imports suivants, dans toutes les compétitions.

### 3. Combattants de l'export : une carte par combattant

- **Une carte par combattant, pas par ligne** (décidé le 2026-11-16). L'export a une ligne par discipline : les lignes
  d'un même combattant (même licence, ou à défaut même nom + sexe + club) forment une seule carte, dont les disciplines
  sont celles de toutes ses lignes (comme l'Import Fiche Club, une ligne de fiche = un combattant et ses disciplines).
  Une ligne en double (même licence, même discipline) reste signalée dans la carte.
- Les cartes sont empilées (pas de « Suivant »), avec des filtres « À trancher » (par défaut),
  « Validées », « Sans problème », « Tout ». Les confirmées sans changement sont repliées en une ligne.
- Les sections actuelles « Mises à jour », « Créations », « Rapprochements à trancher » et « Lignes en erreur »
  disparaissent : tout est dans les cartes.
- En-tête de carte : nom, disciplines, âge · sexe · poids de l'export, club (tel que relié), onglets et lignes.
- **Combattant de l'app**, options à cocher :
  - « C'est <combattant proposé> (raison) » pour chaque candidat ;
  - « ➕ Nouveau combattant » ;
  - « Ne pas lier pour l'instant » (la ligne est laissée de côté) ;
  - « Pas dans la liste ? Chercher un inscrit par son nom… » (tous les combattants de la compétition, résultats à
    cocher).
- **Défaut** : lié d'office seulement si le rapprochement est sûr *et* qu'il ne reste rien à choisir ; sinon « Ne pas
  lier pour l'instant », même quand un candidat est reconnu à sa licence. Une décision ailleurs (case de catégorie,
  lien de club) peut faire passer une carte non touchée en « sans problème », et inversement.
- **Cliquer** sur le combattant choisi (ou sur « Nouveau combattant », ou sur un résultat) **ouvre** la carte ; un second
  clic la **replie** (les modifications restent en attente).
- **Carte ouverte = le formulaire combattant de l'app**, en ligne dans la carte (mêmes champs que « Ajouter / Modifier
  un combattant », `ClubLineForm`) : Nom*, Prénom*, Sexe*, Catégorie d'âge*, Catégorie de poids, Poids actuel
  (facultatif), Disciplines* + Kata, Règlement, Club, N° de licence, Masquer le nom sur la page publique (et le grade
  et le reclassement quand le formulaire les montre). Tous les champs sont modifiables.
- Sous chaque champ où l'export et la fiche diffèrent : deux cases « FFK » / « Fiche club » (`FfkChoice`) qui
  remplissent le champ d'un clic ; on peut aussi saisir une autre valeur. Les disciplines aussi : une discipline de la
  fiche absente de l'export est un écart à choisir (garder ou non), pas une suppression d'office.
- **Aucune valeur prise d'office** (décidé le 2026-11-16, change la règle actuelle « l'export fait foi pour l'âge et
  le poids ») : chaque champ où l'export et la fiche diffèrent démarre vide, **à choisir** (FFK, fiche ou autre
  valeur), et la carte est « À trancher » tant qu'elle n'est pas validée. Une carte qui n'a que des champs identiques
  est « sans problème ».
- Champ vide sur la fiche, rempli dans l'export (typiquement la licence) : ce n'est pas une différence, la valeur FFK
  complète la fiche (décidé le 2026-11-16 : sans conflit, la licence FFK est prise ; en conflit, même la licence se
  tranche).
  Champ vide dans l'export : la fiche est gardée (règlement : celui de la fiche ; nouveau combattant : Jiyu, comme
  aujourd'hui).
- **Zones de décision bien visibles** : un champ à trancher est encadré en orange avec l'étiquette « À choisir » et ses
  cases FFK / Fiche club en pointillés ; une fois choisi, il reste encadré (bleu, « Choisi ») pour qu'on retrouve ce
  qu'on a tranché. En tête du formulaire : « N choix à faire : les champs encadrés en orange… ».
- Poids illisible ou hors grille (« 70 » sans signe, « +60 » chez les cadettes, catégorie décochée à l'étape 1) : champ
  vide, à choisir dans la grille ; le message dit ce que dit la fiche (« La fiche club dit −70 »).
- Pied de carte ouverte : « Écarter cette ligne », « Annuler mes modifications », « Fermer », **« Valider la carte »**
  (grisé tant qu'un champ requis manque, avec « Reste à remplir : … »). Valider replie la carte en une ligne de résumé
  (« Liée à X · Âge : Pupilles → Benjamins ») avec « Modifier », puis ouvre la carte suivante à trancher et y fait
  défiler la page.
- États d'une carte : « À trancher » ; « À valider » (modifiée, pas validée : laissée de côté à l'import) ; « Validée » ;
  « Sans problème » (importée telle quelle) ; « Écartée ».

### 4. Fiches club sans inscription FFK

- Les combattants de la compétition qu'aucune ligne de l'export ne concerne, qu'ils viennent d'une fiche club **ou d'un
  import FFK précédent** (mention « présent dans l'export précédent »). Aujourd'hui ces derniers sont retirés d'office ;
  désormais (décidé le 2026-11-16) rien n'est retiré sans action.
- Pour chacun : « Garder » (défaut, rien ne change), « Rapprocher… » (recherche parmi les combattants de l'export ;
  leur carte se lie à ce combattant et s'ouvre), « Supprimer » (ses inscriptions sont supprimées à l'import).
- Un combattant dont la carte est laissée de côté n'apparaît pas ici et ses inscriptions ne changent pas.

### 5. Importer

- Barre collée en bas : « Vous pouvez importer maintenant : les N points non tranchés sont laissés de côté » et
  « Importer… ».
- Fenêtre « Confirmer l'import FFK », récapitulatif par rubrique : catégories créées ; clubs reliés ou créés ;
  inscriptions mises à jour (avec le détail de chaque changement, marquées « validée » si la carte l'a été) ;
  confirmées sans changement (nombre) ; combattants créés ; inscriptions supprimées ; fiches gardées ; **laissé de
  côté** (clubs non reliés, lignes non tranchées avec la raison : combattant pas choisi, reste à remplir X, carte
  modifiée mais pas validée, écartée). « Annuler » / « Importer ».
- L'import applique, dans une transaction : catégories cochées ; liens de club ; cartes validées (valeurs de la carte)
  et sans problème ; suppressions demandées ; marquage `ffkConfirmed` ; correspondances de
  colonnes. Une ligne laissée de côté ne touche pas aux inscriptions de son combattant (comme `keepMatched`
  aujourd'hui).
- Garde l'empreinte de l'aperçu (409 si les inscriptions ont changé entre-temps) et la notification de fin.

## Laissé au constructeur

- La forme exacte de `choices` (catégories acceptées, liens de club, choix par carte : combattant + valeurs validées
  en `ClubFormLine` + club + licence, écartées, actions des fiches sans FFK) et son schéma zod.
- Extraire le corps de `ClubLineForm` en un formulaire utilisable en ligne dans une carte (sans `Modal` ni
  `ops.save`), réutilisé par la fenêtre existante ; étendre la comparaison (`ImportField`) au nom, prénom, sexe, club et
  licence.
- Écrire une carte validée avec la logique existante d'enregistrement d'une ligne (`saveClubLine` : verrous des combats
  commencés, recasement via `original`), dans la transaction de l'import.
- La recherche (côté page, sur les combattants et clubs déjà chargés, insensible aux accents).
- Garder les cartes vues dans le filtre « À trancher » après validation (on voit ce qu'on vient de faire).
- Textes d'aide (`help.ts`, rubriques `import-ffk.*`) à mettre à jour.
- Tests : domaine (plan avec chaque type de choix, défauts, laissés de côté), serveur (commit partiel, 409), e2e du
  parcours (relier un club, valider une carte, importer avec des points non tranchés). Vérification sur Chrome avec
  l'export réel `Shidokan.xlsm`, et à largeur de téléphone.
