# Importer une fiche renvoyée : une fiche par combattant — design

Date : 2026-11-14. Statut : réalisé (étape 44). Maquettes retenues
(non versionnées) : `.superpowers/brainstorm/29753-1794672617/content/import-fiche-v2.html` (parcours) et
`conflit-disciplines-v2.html` (conflit sur les disciplines et sur un poids confirmé FFK), `coordonnees-club.html` (étape
« Coordonnées du club »).

## 1. Pourquoi

Onglet **Fiche club**, section « 2. Importer une fiche renvoyée » : aujourd'hui, le fichier (.ods / .xlsx / .csv) renvoyé par un
club donne un aperçu en tableau, puis tout est importé d'un coup ; une ligne en erreur est écartée, et un réimport **remplace**
les inscriptions de la fiche précédente (celles qui ont disparu sont retirées d'office).

L'organisateur veut le **même parcours** que « 3. Importer un PDF de la FFK » (`docs/superpowers/specs/2026-11-10-import-pdf-ffk-design.md`) :
compléter **combattant par combattant**, avec les informations de la fiche, en **résolvant les conflits** avec ce qui est déjà
enregistré. Cas réel (fiche de TANI DOJO, 9 combattants mineurs) : la colonne Règlement est vide sur toutes les lignes de combat,
l'import actuel refuserait 8 lignes sur 9.

## 2. Objectifs

1. Un bouton « Importer la fiche d'un club » ouvre une fenêtre de départ : **club** (choisi ou ajouté, jamais reconnu d'après le
   nom écrit dans la fiche — décision), puis **fichier**, puis le compte « N nouveaux · N fiches existantes à revoir · N déjà à jour ».
2. Une fenêtre par combattant à revoir : la fenêtre habituelle `ClubLineForm` (mode organisateur), pré-remplie, avec la barre
   « Fiche k sur N », « ← Précédent », « Enregistrer · suivant → », « Ne pas l'ajouter » / « Laisser la fiche telle quelle ».
3. Fiche existante : sous chaque champ différent, deux cases **« Fiche renvoyée »** (choisie d'office) / **« Enregistré »**,
   pour tous les champs que la fiche donne.
4. Une ligne en partie illisible n'est plus écartée : elle s'ouvre avec les champs lus, les autres vides, et la remarque du fichier.
5. Fin : les combattants du club **absents de la fiche** sont listés, cases **décochées** (décision : comme le PDF FFK) ; cocher
   supprime la fiche du combattant.

## 3. Non-objectifs

- Pas de page du coach : la fiche renvoyée reste une action de l'organisateur (rôle Organisateur seulement, comme aujourd'hui).
- Pas de changement de la saisie papier (section 4), du PDF FFK (section 3), ni de l'import Excel FFK.
- Pas de rapprochement du club par son nom (décision) : le nom écrit dans la fiche n'est qu'un rappel.

## 4. Anti-objectifs

- Un combattant supprimé sans que personne ne l'ait coché, ou une discipline retirée sans que le conflit ait été montré.
- Une case vide de la fiche qui efface une valeur enregistrée.
- Des coordonnées du club ou de l'annuaire modifiées sans avoir été validées (décision).
- Une deuxième fiche pour un combattant qui en a déjà une.
- Des noms réels dans le dépôt : la fiche de TANI DOJO sert au test sur Chrome, jamais aux tests versionnés (noms inventés).

## 5. Approches

- **A. Reprendre le parcours du PDF FFK** (retenue, choix du builder) : la même mécanique d'étapes (`wizard.ts`, rendue générique
  sur l'entrée importée), la même fenêtre `ClubLineForm` dont la comparaison passe de 3 champs à tous ceux de la fiche, une
  comparaison pure propre à la fiche dans `src/domain/`. Un seul comportement à maintenir (précédent, 409, réponses tardives,
  homonymes, reprise après arrêt).
- B. Un second parcours copié du premier : plus simple à écrire, mais deux copies d'une logique délicate qui divergeront.
- C. Garder l'aperçu en tableau et y ajouter des choix par cellule : ne donne pas le « combattant par combattant » demandé.

## 6. Le parcours

### 6.1 Section

La section 2 n'a plus d'aperçu en tableau : un bouton « Importer la fiche d'un club ». L'aide (`fiche-club.importer`) est réécrite.

### 6.2 Départ

Fenêtre « Importer une fiche renvoyée » :

1. **Club** : le `ClubPicker` existant (clubs de la compétition, annuaire, « Ajouter un club »). Si le fichier est déjà choisi,
   « Ajouter un club » est pré-rempli d'après son en-tête (nom, coach, téléphone, e-mails), comme aujourd'hui.
2. **Fichier** (.ods, .xlsx, .xls, .csv). Le serveur le lit (§8) et ne l'écrit pas. Sous le bouton : « La fiche indique le club
   « … ». ». Fichier refusé : le message actuel (fiche modifiée, nom du club manquant…).
3. **Compte** et texte (« Vous allez voir les N fiches une par une… »). Deux lignes de la fiche pour le même combattant sont
   **fusionnées** (§7.1) et signalées : « 2 lignes réunies : DUPONT Léo (lignes 15 et 18). »
4. **« Commencer (N fiches) »**, actif quand club et fichier sont choisis et les fiches du club chargées. Il fait entrer un
   club de l'annuaire dans la compétition (comme le PDF FFK) et calcule le plan sur les fiches du moment. Il **n'écrit aucune
   coordonnée** (décision). Rien à revoir : on passe à la fin.

### 6.2 bis Coordonnées du club (première étape)

Maquette `coordonnees-club.html`. Avant les combattants, comptée dans la progression (« Fiche 1 sur N+1 »), seulement si
l'en-tête de la fiche diffère du club : titre « <Club> : coordonnées », encadré « **La fiche renvoyée donne d'autres
coordonnées.** Ce que vous gardez ici est écrit dans le club et dans l'annuaire. »

- Coach, téléphone : champ modifiable + les deux cases « Fiche renvoyée » (d'office) / « Enregistré » quand ils diffèrent ;
  « Identique à l'enregistré » sinon. Case vide dans la fiche : pas de différence.
- E-mails : les adresses enregistrées, puis une case « Ajouter <adresse> » **cochée** par adresse nouvelle de la fiche ; aucune
  adresse n'est retirée.
- Pré-accord : Oui / Non + les deux cases s'il diffère (vide dans la fiche : pas de différence). Il ne vaut que pour cette
  compétition (il n'est pas dans l'annuaire).
- « Enregistrer · suivant → » : écrit les valeurs affichées dans le club de la compétition **et** dans sa fiche d'annuaire, d'un
  coup ; aucun changement « à comparer » n'est laissé (s'il y en avait un sur ce club, il est recalculé comme après « Comparer »).
  « Laisser tel quel » : rien n'est écrit. « Précédent » depuis la 1re fiche de combattant y revient.
- Comparaison faite avec les valeurs du club dans la compétition (celles de la Fiche club). Club ajouté à l'instant par « Ajouter
  un club » (déjà pré-rempli d'après la fiche) ou sans différence : étape sautée.

### 6.3 Une fiche à la fois

Identique au PDF FFK (spec FFK §6.2) : enregistrement fiche par fiche par les routes habituelles des lignes (avec versions), arrêt
possible à tout moment, réimport qui reprend là où on en était (les fiches enregistrées sont alors « à jour »), « Précédent »,
409 → fiche relue et comparaison recalculée, Entrée = « Enregistrer · suivant », homonymes (« Plusieurs fiches portent ce
nom : laquelle ? » / « C'est un autre combattant »), fiche verrouillée en lecture (pour information).

**Remarques du fichier** : en tête de la fenêtre, un encadré jaune « Dans la fiche (ligne 24) » avec les erreurs et remarques de
lecture de la ligne (« Catégorie d'âge incompréhensible : « 12 ans ». », « Ordre de reclassement « 4 » ignoré »…). Le champ
concerné est vide ; le champ obligatoire empêche d'enregistrer tant qu'il l'est, comme d'habitude.

### 6.4 Nouveau combattant

Titre « Nouveau combattant ». Formulaire = la ligne de la fiche. Pas de marque « FFK » (tout vient de la fiche).
Catégorie de poids **déduite du poids actuel** (avec la tolérance de pesée, comme l'import actuel). Règlement vide et tranche d'âge **mineure** : **Jiyu** d'office (seul règlement possible) — sinon vide, à choisir.
« Ne pas l'ajouter » : rien n'est créé.

### 6.5 Fiche existante

Rapprochement comme le PDF FFK : nom + prénom normalisés (coupure indifférente) **et** sexe ; sexe illisible dans la fiche : nom
seul. Titre = le nom du combattant. Encadré bleu : « **Fiche déjà créée.** Une seule fiche par combattant : celle de <Prénom> est
inscrite en <disciplines>. Sous chaque différence, choisissez la valeur à garder. »

Formulaire = la fiche enregistrée, sauf les champs différents, qui prennent la valeur de la fiche renvoyée. Sous chacun, les deux
cases (`FfkChoice`, libellés « Fiche renvoyée » / « Enregistré ») ; le champ reste modifiable à la main.

**Principe (décision) : la nouvelle fiche l'emporte par défaut, partout, et chaque conflit est montré.** En particulier :

- une discipline enregistrée qui manque dans la fiche est un conflit comme un autre : « Fiche renvoyée » choisie d'office, la
  discipline est donc décochée ; un clic sur « Enregistré » la recoche (maquette `conflit-disciplines-v2.html`). Les deux cases
  basculent le formulaire avant d'enregistrer ; « Enregistrer · suivant → » écrit ce qui est affiché ;
- combattant confirmé par l'export FFK (âge, catégorie de poids) : même règle, la fiche d'office ; la case de droite s'intitule
  « Enregistré · confirmé FFK », pour qu'on sache ce qu'on remplace. Les lignes renvoient donc, pour l'organisateur, si le
  combattant a une inscription confirmée FFK.

| Champ | Différent quand (valeur de la fiche renvoyée *non vide*) | Où sont les cases |
|---|---|---|
| Catégorie d'âge | autre tranche | sous le champ |
| Catégorie de poids | la fiche a un combat, autre catégorie | sous le champ |
| Poids actuel | autre poids | sous le champ |
| Disciplines (combats + kata, un seul champ) | autre ensemble | sous les disciplines |
| Règlement | la fiche a un combat, autre règlement | sous le règlement |
| Grade | la fiche coche le kata, autre grade | sous le grade |
| Reclassement (1er, 2e, 3e choix) | la fiche en donne, autre liste | dans l'encadré Reclassement |
| Priorité shobu | la fiche est en shobu et la donne, autre valeur | dans l'encadré Reclassement |

Une case vide de la fiche ne crée pas de différence et n'efface rien (le reclassement vide aussi : décision du builder, par la
règle « une case vide n'efface rien »). Nom, prénom et sexe ne sont jamais comparés (ils servent au rapprochement). Le
« Masquer le nom » n'est pas dans la fiche : inchangé. Tous les champs égaux : la fiche est « déjà à jour », sautée.

### 6.6 Fin

- Récapitulatif « N ajoutés · N non ajoutés · N mis à jour · N laissés tels quels ».
- **Absents de la fiche** : « Inscrits chez nous, absents de la fiche » — les fiches du club qu'aucune ligne n'a rapprochées
  (toutes disciplines), une case **décochée** chacune, avec tranche, poids et disciplines. « Cochez seulement ceux qui ne viendront
  pas : leur fiche est supprimée. » Fiche verrouillée : listée sans case (« Verrouillé : … »).
- « Terminer » supprime les fiches cochées (avec leurs versions) puis ferme ; notification de résumé.

## 7. Règles (logique pure, `src/domain/`)

### 7.1 Lecture d'une fiche en lignes de combattant

À partir des cellules : en-tête (club, coach, téléphone, e-mails, pré-accord) et une **ligne de combattant** (`ClubFormLine`) par
ligne non vide, avec son numéro et ses remarques :

- la lecture actuelle d'une ligne (`cellsToLine`), puis la catégorie de poids déduite du poids actuel ; pas de catégorie
  trouvée → remarque, champ vide ;
- **ancien format** (premier modèle, une ligne par inscription, catégorie de poids ; remplacé le 2026-10-22) : **refusé** par ce
  parcours (décision), message « Ancien modèle de fiche : demandez au club de remplir le nouveau. » ;
- « Vétéran » sans numéro : V1 et la remarque actuelle ;
- deux lignes du même combattant (nom normalisé + sexe) : fusionnées dans la première (disciplines réunies, kata si l'une le
  coche, sinon la première valeur non vide), numéros et remarques gardés ;
- reclassement rangé (`tidyReclass`).

### 7.2 Comparaison

Pour chaque ligne lue, dans l'ordre de la fiche : nouveau / homonyme / existante avec différences (§6.5) / déjà à jour. Absents :
fiches du club non rapprochées. Valeurs comparées sous forme de texte (`fieldValue`) pour réutiliser `FfkChoice` ; disciplines et
reclassement encodés dans un ordre fixe.

### 7.3 Pré-remplissage

Nouveau : la ligne lue (catégorie de poids hors de la tranche et du sexe vidée, Jiyu pour un mineur sans règlement). Existante :
la fiche enregistrée avec les valeurs de la fiche renvoyée pour chaque différence, reclassement rangé ; fiche verrouillée : ce
que le serveur garde tel quel reste celui de la fiche (`lockedKept`, comme le PDF FFK).

### 7.4 En-tête

Comparaison pure (club du moment, en-tête de la fiche) → différences coach / téléphone / pré-accord et adresses nouvelles
(comparées sans casse, `cleanEmails`). Rien n'est écrit sans l'étape §6.2 bis.

## 8. Technique (contraintes ; le reste au builder)

- Lecture : `POST /api/competitions/:id/club-forms/read` (fichier en corps brut) → en-tête, lignes de combattant, lignes
  réunies. N'écrit rien. Même lecture des onglets que l'import actuel (premier onglet qui est une fiche club).
- Coordonnées : `POST /api/competitions/:id/clubs/:clubId/club-form-header` (JSON coach, téléphone, e-mails, pré-accord, version
  de la fiche d'annuaire) : écrit le club **et** la fiche d'annuaire par les fonctions existantes de l'annuaire et des
  changements (`updateDirectoryEntry`, `writeClubValues`, recalcul des changements des autres compétitions de cette fiche), avec
  leurs contrôles (version de la fiche d'annuaire, compétition gérée ailleurs…). Club sans fiche d'annuaire : le club seul.
- Écritures des fiches : routes existantes des lignes de l'organisateur (`/clubs/:clubId/lines`). Elles acceptent une origine
  facultative « fiche club » : une inscription **créée** par ce parcours a l'origine « Fiche club » (pas « sur place », qui
  s'affiche en orange dans Inscriptions) ; une inscription existante garde la sienne (`upsertFighterRegistration`).
- Routes organisateur seulement (ni Table, ni Zone), comme `club-forms/import` aujourd'hui.
- Les routes `club-forms/preview` et `club-forms/import` restent (API, tests serveur) ; l'écran ne s'en sert plus.
  `ClubFormPreviewTable` reste pour la saisie papier.
- `wizard.ts` devient générique sur l'entrée importée ; `ClubLineForm` reçoit les libellés des deux cases, les remarques du
  fichier et la comparaison des nouveaux champs ; le PDF FFK ne change pas de comportement.
- Tests : unitaires sur la lecture (format actuel, ancien refusé, fusion, poids → catégorie) et les coordonnées et la comparaison ; e2e (fiche sur un club
  vide ; étape coordonnées validée → club et annuaire écrits, « Laisser tel quel » → rien ; réimport avec une différence, un absent coché et un non coché ; ligne à compléter ; club de l'annuaire) — les e2e
  actuels de l'aperçu sont remplacés ; l'e2e de l'import FFK prépare sa fiche par l'API.
- Vérification sur Chrome (Claude in Chrome) avec la fiche réelle de TANI DOJO, sur un serveur de test à part (copie d'une
  sauvegarde, jamais la base en service).

## 9. Choix du builder (à vérifier en lisant)

- Approche A (parcours FFK générique).
- Décidé par l'organisateur : fiche renvoyée par défaut partout, conflits montrés (disciplines retirées et valeurs confirmées
  FFK comprises) ; absents décochés ; club choisi, jamais reconnu au nom ;
  coordonnées validées dans une étape à part avant d'écrire le club et l'annuaire ; ancien format abandonné.
- Libellés des cases : « Fiche renvoyée » / « Enregistré ».
- Jiyu d'office pour un mineur sans règlement.
- Lignes du même combattant fusionnées, signalées au départ.
- Reclassement et pré-accord vides : rien n'est changé.
- Étape coordonnées comparée au club de la compétition ; sautée pour un club ajouté à l'instant.
- Origine « Fiche club » pour les inscriptions créées (paramètre facultatif des routes des lignes).
- Ordre des fiches : celui du fichier.
