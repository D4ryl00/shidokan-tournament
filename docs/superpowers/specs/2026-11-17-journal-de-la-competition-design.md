# Journal de la compétition — conception

Date : 2026-11-17. ✅ = décidé par l'utilisateur, 💡 = choix du concepteur (à vérifier en lisant).

Maquette validée par l'utilisateur (✅ « ok ») :
`.superpowers/brainstorm/58534-1794902304/content/journal-v1.html` (fichier local, git-ignoré ; s'ouvre directement dans
un navigateur). Elle fait foi pour la disposition et les textes, pas pour le code ni pour les données (fictives).

## 1. Pourquoi

Aujourd'hui, l'appli ne garde pas de trace de **qui a changé quoi, quand et comment** dans une compétition :

- une inscription ne retient que sa **dernière** source (`registrations.source` : `club_form`, `ffk`, `manual`, `onsite`,
  `online`) ;
- l'**Historique de la planche** (`history_entries`) ne couvre que les tableaux et la réaffectation, et il est fait pour
  **annuler**, pas pour garder une trace (une action annulée change de statut) ;
- le **journal de zone** (`zone_journal`, `zone_entries`) ne sert qu'à rejouer les saisies des portables de zone.

✅ L'utilisateur veut un **Journal** dans chaque compétition qui note toutes les opérations qui la modifient : qui
(compte ou club), quand, et de quelle manière (import FFK, inscription sur place, fiche club importée, inscription en
ligne, réaffectation automatique ou manuelle…). ✅ **Tout s'ajoute, rien ne s'enlève.**

✅ Usage : on **lit le fil des événements** (le plus récent en haut), avec une **recherche globale** (nom, club…) et un
**filtre par type d'événement**.

**Réussi si** l'organisateur, le jour J ou après :

- voit dans l'ordre tout ce qui s'est passé depuis l'ouverture des inscriptions ;
- retrouve en tapant « dupont » ou « lyon » tout ce qui a touché ce combattant ou ce club, y compris à l'intérieur d'un
  import ou d'un plan appliqué ;
- peut répondre à un club : « votre combattant a été inscrit par l'import FFK du 18 à 18 h 30, puis déplacé à la main par
  la Table le 22 à 10 h 42 ».

**Échec même si « ça marche » :**

- une modification de la compétition qui **n'apparaît pas** dans le journal ;
- une entrée qui **disparaît ou change** après coup (hors purge de conservation, §9) ;
- une entrée devenue **illisible** parce que le combattant, le club, la catégorie ou le compte a été supprimé depuis ;
- un journal **lisible** par un compte Table ou Zone, ou par un club ;
- le **texte d'un mail** recopié dans le journal ;
- un journal qui **ralentit** les écrans du jour J.

## 2. Non-objectifs

- **Annuler depuis le journal** : c'est le rôle de l'Historique. Le journal se contente de lire.
- **Reconstituer le passé** : à la mise en service, le journal des compétitions existantes commence vide (une première
  entrée « Journal ouvert » le dit 💡).
- **Les connexions, les déconnexions et les simples consultations** 💡.
- **Les réglages de l'application** (hors compétition : mails, conservation, comptes, annuaire des clubs) 💡. Les
  changements de l'annuaire n'y figurent que lorsqu'ils modifient un club **de la compétition**.

## 3. Ce qui est noté

✅ **Tout ce qui modifie la compétition, sauf le contenu des mails** (§3.1). Par famille (ce sont aussi les **types**
du filtre, §6) :

| Type | Exemples |
|------|----------|
| Inscription | combattant ajouté, supprimé, modifié champ par champ (nom, sexe, naissance, grade, licence, club, poids annoncé, discipline, règlement…), nom public, lignes d'un club par son lien |
| Import | import FFK (PDF), fiche club importée (papier renvoyée ou fichier), avec le détail par combattant et les dérogations tranchées |
| Pesée · présence | poids saisi ou corrigé, présent / absent, clôture de la pesée |
| Catégorie | création, suppression, modification d'une catégorie ou de la grille (tranches, poids, liens d'âge), catégories fermées, **créations et suppressions automatiques** qui suivent une inscription (§5.4) |
| Réaffectation | déplacement à la main, échange, « ne combat pas », mise de côté, reprise, refus, retour d'un refus, **annulation depuis l'Historique** (une entrée de plus, jamais un effacement) |
| Plan | plan calculé puis appliqué, plan remis à zéro, règles modifiées ou remises par défaut |
| Tableau | format, options (repêchage, 3e place), nouveau tirage, échange de places, déplacement dans le tableau, régénération, « marquée prête », tableaux libres |
| Session · zone | sessions et zones (création, modification, suppression), horaires, finales, lancement, réouverture, numérotation |
| Résultat | combat (vainqueur, manière, score), suppression ou correction d'un résultat, notes de kata, départage |
| Club | ajout à la compétition (annuaire ou nouveau), coordonnées modifiées (par l'organisateur ou par le club), rattachement à une autre fiche, changement examiné / ignoré |
| Mail | envoi aux clubs (liens d'inscription, convocations…) : §3.1 |
| Main | main passée du serveur à un PC ou rendue, main prise en secours, sauvegarde restaurée (§8) ; pas les copies reçues |
| Compétition | nom, date, lieu et autres réglages **de la compétition** 💡 (type à part dans le filtre, ou rangé avec Session · zone : au constructeur) |

### 3.1 Mails

✅ Le contenu du mail n'est pas recopié. 💡 L'entrée note : qui a lancé l'envoi, quand, la sorte d'envoi, l'**objet**, les
**noms** des pièces jointes, et pour chaque club destinataire (une ligne de détail) les adresses et le résultat (envoyé /
échec et sa raison). Un envoi en tâche de fond donne une entrée à son lancement, complétée par ses lignes de détail au fur
et à mesure ou à la fin 💡 (au constructeur de choisir, tant qu'une ligne déjà écrite n'est jamais modifiée).

## 4. Contenu d'une entrée

💡 Chaque entrée garde :

- **quand** : l'heure du serveur à l'écriture ; et, pour une saisie faite hors ligne sur un portable de zone, aussi
  **l'heure de la saisie** (« saisi 15:12 sur le portable, reçu 15:14 ») ;
- **qui** (§5.1) et **comment** (§5.2) ;
- le **type** (§3) et l'**action** précise (« combattant ajouté », « poids corrigé »…) ;
- **ce qui est touché**, avec les **libellés recopiés** au moment de l'action : « NOM Prénom (Club) », libellé de la
  catégorie, nom de la session, de la zone, du club. Les identifiants sont gardés en plus (pour un lien éventuel), mais
  l'affichage **ne dépend jamais** de lignes qui peuvent avoir été supprimées ;
- pour une modification, **avant → après** champ par champ, en valeurs lisibles (« 52,4 kg → 53,1 kg », « poule →
  élimination directe ») ;
- éventuellement des **lignes de détail** (§5.3).

Le texte affiché est produit à la lecture à partir de ces données structurées 💡 (on peut donc améliorer une formulation
sans toucher aux entrées). Un **texte de recherche** normalisé (sans accents ni casse, `normalizeName`) est calculé à
l'écriture et gardé avec l'entrée 💡.

## 5. Qui, comment, regroupement

### 5.1 Qui

- **Un compte** : son adresse e-mail (recopiée), et son rôle. ✅ (accepté en lisant) Les comptes Table sont souvent
  partagés : le journal dit « compte Table », pas le nom du bénévole.
- **Un club par son lien personnel** : le nom du club (recopié), avec la mention « lien du club ». Jamais le jeton.
- **Une zone** : le compte Zone qui a saisi (y compris quand la saisie arrive plus tard par le journal de zone rejoué).
- **Sur le PC local (jour J), sans comptes** : l'installation locale n'a pas de connexion ; chaque navigateur choisit son
  **poste** (Organisation, Table centrale, Zone n — `src/web/poste.ts`). 💡 Le navigateur l'annonce au serveur avec
  chaque écriture (en-tête, comme `X-Poste-Id`), et le journal note « poste Table centrale », « poste Zone 2 »,
  « poste Organisation ». C'est **déclaratif** (comme le poste lui-même, qui « ne protège rien ») ; sans en-tête : « poste
  inconnu ». De même, en local, l'onglet Journal n'est caché qu'aux postes Table et Zone : le serveur local ne peut pas
  refuser la lecture (il ne refuse rien aujourd'hui).
- **L'appli elle-même** : pour ce qui n'a pas d'auteur humain (ligne de commande, tâche planifiée). 💡 Une suite
  automatique d'une action humaine (catégories recalculées après une inscription, §5.4) garde l'**auteur de l'action**.

### 5.2 Comment (la « manière »)

💡 Une liste fermée, affichée en étiquette : Import FFK · Inscription sur place · Saisie (Inscriptions) · Fiche club
importée · Inscription en ligne (lien du club) · Plan automatique · À la main · Historique (annulation) · Pesée ·
Tableaux · Sessions · Combats / Zone n · Clubs · Envoi de mails · Synchronisation · Ligne de commande. La liste exacte et
ses libellés sont au constructeur ; la maquette en donne le ton.

Qui et comment sont établis **une fois par requête**, à son arrivée sur le serveur (compte de la session ou club du lien,
et la manière d'après la route ou ce que la route annonce), puis disponibles pour toute écriture faite pendant la requête
💡 (contexte de requête). Une route qui sert à plusieurs manières (ex. ajout d'inscription : saisie normale ou « sur
place ») précise la sienne.

### 5.3 Regroupement

✅ (maquette) Une opération qui touche beaucoup de choses fait **une entrée**, dépliable (« ▸ Voir le détail ») en
**lignes de détail** : import FFK, fiche club importée, envoi en ligne d'un club, plan appliqué, plan remis à zéro, clôture
de la pesée, envoi de mails, lancement d'une session. Les lignes de détail se cherchent comme les entrées : une recherche
qui touche une ligne de détail montre son entrée **dépliée** et la ligne surlignée.

### 5.4 Effets indirects

Une écriture en entraîne parfois d'autres hors de la route elle-même : par exemple le recalcul des catégories
(`syncCategories`, lancé dans le crochet `onResponse` de `src/server/app.ts` après une inscription ou un import), qui crée
ou supprime des catégories. Ces effets sont **aussi notés** (type Catégorie), avec l'auteur et la manière de l'action qui
les a causés 💡 (en ligne de détail de cette action ou en entrées séparées juste après : au constructeur).

## 6. L'écran

✅ Onglet **Journal** de la compétition, **réservé à l'organisateur** : l'onglet n'apparaît pas pour les comptes Table et
Zone, et le serveur leur refuse la lecture (liste `ORGANISER_GETS` de `src/server/auth/permissions.ts` ou équivalent).
Les clubs n'y ont pas accès.

Disposition (maquette) :

- en-tête : « Journal », nombre d'événements, témoin « en direct » ; une phrase d'explication (rien ne s'efface, le
  journal part avec les données de la compétition à la fin de la conservation) ;
- ✅ **recherche globale** (noms, clubs, catégories, valeurs, comptes, manières), tous les mots tapés, sans accents ni
  casse, mots trouvés surlignés ;
- ✅ **filtre par type**, plusieurs à la fois (« Tous » par défaut), une pastille de couleur par type ;
- bouton **Exporter (tableur)** 💡 : les entrées affichées (recherche et filtre appliqués), lignes de détail comprises,
  au format déjà utilisé par l'appli (`src/server/spreadsheet/ods.ts`) ;
- le **fil**, regroupé par **jour**, le plus récent en haut ; une ligne = heure · type · ce qui est touché et avant →
  après · qui et comment (étiquette) ; l'ancienne valeur barrée ;
- **chargement par pages** au défilement 💡 (la recherche et le filtre se font côté serveur, pas sur la seule page
  chargée) ;
- **en direct** : une nouvelle entrée apparaît sans recharger, par le même mécanisme que les autres écrans
  (`competitionChanged`) 💡, sans faire perdre sa place à celui qui lit plus bas.

Sur téléphone, la ligne passe sur plusieurs rangées (maquette, `@media (max-width:720px)`). Thèmes clair et sombre avec
les jetons `--sk-*`.

## 7. Approches

Trois façons ont été envisagées :

- **A. Chaque opération écrit sa propre entrée** — ✅ **choisie.** Chaque opération du serveur écrit une entrée lisible,
  dans la **même transaction** que sa modification. Seule à donner un fil lisible et cherchable (avant → après, noms
  recopiés, regroupement). Prix : toucher chaque opération (~130 routes d'écriture) ; d'où un découpage en étapes (§11)
  et le filet de sécurité ci-dessous.
- **B. Une trace automatique de chaque requête** (route, compte, corps) — écartée : illisible (« PUT
  /registrations/3f2a… »), pas d'avant → après, un import = une ligne opaque, recherche par nom impossible quand la
  requête ne porte qu'un identifiant.
- **C. Déclencheurs SQLite** (avant/après de chaque ligne) — écartée : la base ne sait ni qui ni comment ; bruit technique
  (versions, lignes internes de réaffectation) ; la réception d'une copie synchronisée produirait de fausses entrées.

### 7.1 Filet de sécurité (partie de A)

- **À l'exécution** : après toute requête d'écriture **réussie** sur une compétition qui n'a écrit **aucune** entrée, le
  serveur écrit une entrée brute « Opération non détaillée : <méthode> <route> » (type « Non détaillé », mise en évidence
  orange dans la maquette) avec qui, quand et les paramètres de la route 💡. Le corps de la requête n'est gardé
  qu'après retrait de ce qui ne doit pas y être (mots de passe, jetons, fichiers, texte de mail) 💡 — au constructeur de
  décider s'il le garde du tout.
- **Aux tests** : un test parcourt toutes les routes d'écriture d'une compétition (et celles du lien club) et échoue
  tant qu'une route n'est ni **couverte** (elle écrit une entrée détaillée) ni **exclue exprès** dans une liste commentée
  (ex. aperçus sans effet comme `…/preview`). Même esprit que `unclassifiedTables` pour la synchronisation.

Ainsi, dès la première étape, **rien ne passe sans trace**, et l'entrée brute n'apparaît jamais en vrai une fois toutes
les étapes faites.

## 8. Garanties et cas particuliers

- **Même transaction** : l'entrée est écrite dans la transaction de la modification ; si l'une échoue, l'autre aussi. Une
  requête refusée (erreur, conflit de révision 409) n'écrit rien.
- **Ajout seul** : le code n'offre que l'ajout. Aucune route ne modifie ni ne supprime une entrée. Seules exceptions : la
  purge de conservation (§9), la suppression de la compétition entière, et le remplacement par une copie synchronisée ou
  une sauvegarde restaurée (ci-dessous). 💡 Pas de déclencheur SQLite pour l'interdire : il gênerait ces trois cas ; un
  test vérifie qu'aucun code hors de ces chemins ne fait `update`/`delete` sur la table.
- **Ordre** : un numéro croissant par compétition 💡 (comme `history_entries.seq`), pour un ordre sûr même à heure égale.
- **Synchronisation** : le journal **voyage avec la compétition** entre le serveur et le PC (ajouter la table à
  `PACKAGE_TABLES` de `src/server/sync/package.ts`) : dans les passages de main **et** dans les copies que le PC envoie au
  serveur (`POST …/copy`), pour qu'une reprise de secours depuis la dernière copie garde le journal 💡. Une seule
  installation a la main à un moment donné, les copies sont en lecture seule : le journal suit donc la main. Cas du
  secours : si les deux côtés ont écrit, celui dont la copie l'emporte garde son journal, comme pour le reste des données
  (même règle, pas de fusion).
- **Portables de zone : jamais de journal** 💡. Les copies en lecture seule servies aux portables de zone
  (`sync-local.ts`, paquet construit pour le rôle zone) **n'emportent pas** la table : elle contient poids, licences et
  adresses des clubs que les comptes Zone ne doivent pas lire (§1), et elle grossirait chaque copie tirée plusieurs fois
  par minute le jour J. L'**empreinte** de la compétition (`competitionFingerprint`) **ne compte pas** le journal 💡 :
  une entrée sans autre changement (un mail envoyé) ne fait pas retirer de copie aux portables, et ne peut pas faire croire
  à une divergence en secours.
- **Seule l'installation qui a la main écrit dans le journal** 💡. Une copie reçue (serveur qui garde la copie d'un PC,
  portable de zone) n'écrit jamais d'entrée : elle serait effacée au retour du paquet. Conséquences :
  - « Main » : celui qui **passe** la main écrit « Main passée à <installation> » dans son journal **avant** de construire
    le paquet ; celui qui la **reçoit** écrit « Main reçue de <installation> » après l'import ; une prise de main en
    secours est écrite par celui qui la prend. Une **copie reçue n'est pas notée** (c'est de la synchronisation
    courante, pas une modification).
  - « Journal ouvert » (§2) et « Sauvegarde restaurée » ne sont écrits que dans les compétitions dont cette installation a
    la main.
- **Portables de zone** : une saisie rejouée sur le PC principal (`src/server/zone/replay.ts`) écrit son entrée au moment
  où elle est appliquée, avec le compte Zone et l'heure de la saisie sur le portable. Une saisie refusée (conflit) n'écrit
  rien 💡 (elle reste visible là où elle l'est aujourd'hui).
- **Sauvegarde restaurée** : la base revient à l'état de la sauvegarde, journal compris. 💡 Juste après la restauration,
  chaque compétition reçoit une entrée « Sauvegarde du <date> restaurée par <qui> : ce qui a été fait après cette date
  n'est plus dans le journal ».
- **Compétition purgée** (`purged_at`) : la purge efface le journal (§9). Ce qui est modifié **après** la purge est
  noté normalement 💡 : le journal suit la même règle que les données elles-mêmes (une donnée saisie après la purge n'est
  pas repurgée non plus). Pas d'exemption au filet de sécurité.
- **Routes hors d'une compétition qui en modifient** 💡 : fusion et report de l'annuaire sur les clubs, synchronisation
  Google Contacts, examen / rejet des changements de clubs, création d'une compétition, restauration. Le filet de
  sécurité et le test de couverture (§7.1) les couvrent aussi ; une entrée est écrite **dans chaque compétition touchée**
  (dont l'installation a la main).

## 9. Limite et conservation

✅ **Pas de journal tournant.** Volume attendu : quelques milliers d'entrées par compétition (quelques centaines
d'inscrits, quelques imports, un jour J chargé), soit quelques Mo : rien qui justifie d'effacer.

✅ Le journal **s'efface avec les données de la compétition**, par la purge de conservation existante
(`purgeExpiredData`, `src/server/repositories/retention.ts`, `retentionMonths`, 13 mois par défaut) : ajouter la table à
la liste effacée. Raison : le journal contient des données personnelles (noms, poids, licences, adresses e-mail des
clubs) ; le garder défairait la promesse de la purge. La suppression d'une compétition l'emporte aussi.

## 10. Performance

- Écriture : une ou quelques insertions dans une transaction déjà ouverte ; pas de lecture lourde (les libellés recopiés
  sont ceux que l'opération a déjà en main, ou une lecture ciblée).
- Lecture : page par page (par exemple 100 entrées, avec leurs lignes de détail), index sur (compétition, numéro) ;
  recherche par `like` sur le texte normalisé, suffisante pour ce volume 💡.
- Mesure à faire sur la plus grosse donnée de test : l'import FFK et l'application du plan ne doivent pas ralentir de
  façon sensible.

## 11. Découpage en étapes

💡 Le filet de sécurité de l'étape 1 garantit la trace complète dès la mise en service ; les étapes suivantes remplacent
les entrées brutes par des entrées détaillées.

1. **Socle et inscriptions** : table et migration, contexte qui / comment, écriture d'une entrée et de ses lignes de
   détail, filet de sécurité (exécution + test), classement pour la synchronisation (copies et passages de main, pas les
   portables de zone, hors empreinte), purge, accès réservé à l'organisateur,
   onglet Journal (fil, jours, recherche, filtre, pages, en direct). Entrées détaillées : inscriptions (ajout,
   modification, suppression, sur place, lignes d'un club par son lien), pesée et présence.
2. **Imports et clubs** : import FFK, fiche club importée, envoi en ligne d'un club, clubs (ajout, coordonnées,
   rattachement, changements examinés), recalcul automatique des catégories.
3. **Réaffectation et tableaux** : déplacements, échanges, « ne combat pas », mises de côté, refus, plan appliqué et remis
   à zéro, règles, annulations depuis l'Historique, tableaux (format, tirage, places, prête, tableaux libres), catégories et
   grille.
4. **Jour J et le reste** : sessions, zones, horaires, finales, lancement / réouverture / numérotation, résultats (y
   compris rejoués depuis les zones), mails, main sur la compétition, sauvegarde restaurée, réglages de la compétition,
   export tableur.

## 12. Laissé au constructeur

- Nom de la table, forme exacte des données structurées, liste des actions et de leurs libellés.
- Lignes de détail : dans la même table (entrée parente) ou dans une table à part.
- Mécanisme du contexte de requête (décoration de la requête Fastify, `AsyncLocalStorage`…).
- Effets indirects (§5.4) : en lignes de détail ou en entrées voisines.
- Envoi de mails en tâche de fond (§3.1) : moment où les lignes de détail sont écrites.
- Corps de requête gardé ou non dans une entrée brute (§7.1).
- Taille des pages, rafraîchissement en direct sans saut.
- Place des réglages de la compétition dans les types du filtre.
- Aide à l'écran (`src/web/help.ts`) pour le nouvel onglet, comme les autres onglets.
