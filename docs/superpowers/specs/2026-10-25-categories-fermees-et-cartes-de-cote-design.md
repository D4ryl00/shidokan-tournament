# Catégories fermées et cartes mises de côté — conception

**Date :** 2026-10-25 · **Complète :** `docs/superpowers/specs/2026-10-21-tableaux-shidokan-design.md` (grille, fiche club, recasement) et `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` (inscription en ligne).
**Échéance :** compétition du **22 novembre 2026** ; la fiche club part aux clubs vers le 29 octobre, donc la fermeture des catégories (§2, §3) est la partie urgente.

Légende : ✅ demandé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

---

## 1. Pourquoi

Pour une compétition donnée, l'organisateur ne veut pas ouvrir toutes les catégories de la grille (par exemple pas de shido-mix chez les Benjamins, pas de shobu Seniors F). Aujourd'hui, il ne peut retirer de la fiche club qu'une **tranche d'âge entière** (case « Proposée sur la fiche club » de la grille), et les combattants déjà inscrits dans une tranche retirée ne sont signalés nulle part.

Le jour J, la page Réaffectation affiche toutes les cartes à traiter. Certaines gênent : un cas qu'on ne peut pas trancher tout de suite (on attend un coach, une pesée). On veut pouvoir les écarter **sans les perdre**.

✅ Ce que l'organisateur a demandé :
1. désactiver certaines catégories d'une compétition : elles n'apparaissent plus sur les fiches ni dans l'inscription en ligne des clubs ;
2. si des combattants sont déjà inscrits dans une catégorie désactivée, ils apparaissent en Réaffectation, où l'on décide de **ne pas les faire combattre** ou de **les mettre dans une autre catégorie** ;
3. en Réaffectation, pouvoir **masquer / reporter à plus tard** certaines cartes, qu'on retrouve toujours.

**Réussi si :** l'organisateur ferme une catégorie en un clic ; un coach ne peut plus y inscrire personne en ligne ; un combattant déjà inscrit n'est jamais oublié (il a une carte tant qu'on n'a rien décidé) ; une carte mise de côté ne gêne plus mais reste visible dans un coin, avec un compteur.

**Échec même si « ça marche » :** un combattant d'une catégorie fermée qui passe au travers (tableau généré sans que personne ne l'ait vu) ; une carte mise de côté qu'on ne retrouve plus ou qu'on oublie au lancement de la session ; un coach dont l'inscription déjà faite est bloquée ou effacée sans explication ; « ne combat pas » confondu avec « absent à la pesée ».

## 2. Fermer des catégories

### 2.1 Ce qu'on ferme 💡
On ferme des **catégories d'inscription** : une **tranche d'âge × sexe × discipline**, avec le règlement pour le karaté. Les colonnes sont : Karaté jiyu, Karaté shobu, Shido-boxing, Shido-mix-martial, Triathlon, Kata.

On ne ferme **pas une catégorie de poids** : le coach indique un poids en kg, pas une catégorie, et la catégorie de poids est déduite. Pour supprimer ou regrouper des poids, on modifie la grille, comme aujourd'hui.

Une case fermée vaut pour **cette compétition seulement**. Toutes les cases sont ouvertes par défaut.

### 2.2 Où 💡
L'écran **Grille** de la compétition reçoit une section **« Catégories ouvertes »** : un tableau à cocher.
- **Lignes :** les tranches d'âge, chacune dédoublée en F et M.
- **Colonnes :** les disciplines du §2.1.
- La case d'une ligne coche ou décoche la ligne entière, celle d'une colonne la colonne entière.
- Les cases qui n'existent pas sont grisées : le shobu pour les mineurs (`RULESETS.shobu.adultsOnly`).
- À côté de chaque case, le **nombre d'inscrits actuels** (ex. « 3 inscrits »). Fermer une case qui a des inscrits demande une confirmation : « 3 combattants sont déjà inscrits : ils apparaîtront en Réaffectation ».
- Une case dont la catégorie est **lancée, commencée ou terminée** ne se ferme plus (case verrouillée, avec une infobulle qui dit pourquoi).

Ce tableau **remplace** la case actuelle « Proposée sur la fiche club » : une tranche décochée correspond à une ligne entièrement fermée. À la migration, une tranche non proposée devient une ligne fermée.

Conséquence à connaître : les combattants déjà inscrits dans une tranche non proposée avaient jusqu'ici une catégorie normale. Ils auront désormais une carte en Réaffectation. La règle de validation actuelle (« au moins une tranche proposée sur la fiche ») devient « au moins une case ouverte ».

🔧 Stockage : par exemple une table `closed_entry_categories (competition_id, age_band_code, sex, discipline, ruleset)` qui ne garde que les cases fermées. On peut aussi mettre l'information dans la grille ; ce choix revient au constructeur. La table doit voyager dans le paquet de passage de main (`src/server/sync/package.ts`), recevoir les révisions de ligne et prévenir les autres postes en direct (SSE), comme les autres tables de la compétition. Les modèles de grille (`grid_templates`) ne l'emportent pas 💡 : ce qui est ouvert dépend de la compétition, pas de la grille.

### 2.3 Ce que voient les clubs 💡
- **Inscription en ligne (`/inscription/:token`) :** une fois la tranche d'âge et le sexe choisis, seules les disciplines et les règlements ouverts sont proposés. La case Kata disparaît si le kata est fermé. Si rien n'est ouvert pour ce combattant : « Aucune catégorie ouverte pour cette tranche d'âge à cette compétition ».
  - Le serveur **refuse** d'enregistrer une ligne qui **passe** dans une catégorie fermée, avec un message en français. Un client ancien ne doit pas pouvoir contourner l'interface.
  - Une ligne **déjà enregistrée** avant la fermeture et qui ne change pas de catégorie reste modifiable (poids, grade…). Elle affiche « Cette catégorie n'est plus ouverte : l'organisateur vous contactera ». Elle n'est jamais effacée.
  - Si l'organisateur a choisi « ne combat pas » (§4.2), la ligne affiche « Ne combattra pas dans cette catégorie (catégorie non ouverte) ».
- **Fiche .ods :** les listes déroulantes ne peuvent pas dépendre de la tranche choisie. La liste des tranches ne garde donc que celles qui ont au moins une case ouverte. L'onglet « Aide » liste **les catégories non ouvertes** (ex. « Benjamins F et M : pas de shido-mix-martial »).
- **Fiche PDF papier :** même liste de tranches. Un encadré sous l'en-tête indique « Non ouvert à cette compétition : … » ; il disparaît s'il n'y a rien de fermé.
- 🔧 Le texte qui résume les catégories fermées est produit par une seule fonction du domaine, partagée par le .ods, le PDF et la page en ligne.

### 2.4 Ce qui arrive par d'autres chemins 💡
Le retour d'une fiche (.ods importé ou saisie papier), l'import FFK et l'ajout manuel par l'organisateur **acceptent** une inscription dans une catégorie fermée, avec un **avertissement** dans l'aperçu : « 2 lignes dans une catégorie non ouverte : elles iront en Réaffectation ». On ne rejette pas la ligne : l'organisateur peut avoir une bonne raison, et une ligne rejetée se perd plus facilement qu'une carte.

## 3. Rouvrir 💡
Rouvrir une case est toujours possible tant que la catégorie n'est pas lancée. Les combattants qui n'ont pas encore été traités retrouvent leur catégorie normale et leur carte disparaît. Ceux qui ont déjà été déplacés ou mis en « ne combat pas » le restent : ces décisions s'annulent une à une, depuis l'historique (§4.3).

## 4. Réaffectation : la carte « Catégorie fermée »

### 4.1 La carte ✅ / 💡
Un nouveau type de cas, **« Catégorie fermée »** (`closed`). Il concerne toute inscription qui remplit les quatre conditions suivantes :
- sa catégorie naturelle (tranche, sexe, discipline, règlement) est fermée ;
- elle n'a pas été déplacée (`placementLocked` faux) ;
- elle n'est pas en « ne combat pas » ;
- sa catégorie n'est pas verrouillée (`isLocked`).

💡 Ce cas passe **en premier** dans l'ordre d'affichage. Il remplace les autres cas du même combattant (sans adversaire, écart de poids, poids hors catégorie) : tant que la catégorie est fermée, ces cas n'ont pas de sens. Ça vaut aussi pour « poids hors catégorie » : la proposition de déplacement tient déjà compte du poids pesé.

La carte reprend la présentation actuelle : nom, détail du combattant, « Catégorie non ouverte à cette compétition ». Elle propose :
1. **les propositions automatiques**, calculées comme pour un combattant seul (types A à H et R selon ses préférences, son poids, sa tranche) mais **jamais vers une catégorie fermée**, ni existante ni à créer ;
2. **le déplacement manuel** : la liste habituelle, sans les catégories fermées ;
3. un nouveau bouton **« Ne combat pas »**, avec une confirmation : « X ne combattra pas en <catégorie>. Le coach le verra sur sa page d'inscription. »

💡 Ailleurs dans la Réaffectation, une catégorie fermée n'est jamais une cible. Une catégorie qui regroupe plusieurs tranches est une cible possible dès qu'une de ses tranches est ouverte. Une catégorie mixte (F/M) l'est dès qu'un des deux sexes est ouvert. Un combattant déplacé hors d'une catégorie fermée garde la raison `closed` : on ne lui propose jamais de « retour » (aujourd'hui, seul un déplacement pour « seul » revient).

Le reste ne change pas : le pré-accord du coach et les changements de session se traitent comme avant. Les boutons « Classer automatiquement » traitent aussi ces cartes, avec les mêmes règles (cas simple ou validation manuelle). « Ne combat pas » n'est **jamais** appliqué automatiquement.

Tableau de bord : nouveau compteur **« Catégorie fermée »**, et nouvelle puce de filtre.

### 4.2 « Ne combat pas » 💡
Un état de l'**inscription**, distinct de la présence :
- « absent » se pointe à la pesée et se remet à zéro le jour J ;
- « ne combat pas » est une décision de l'organisateur.

Une inscription « ne combat pas » :
- ne fait partie d'aucun tableau et ne compte dans aucune catégorie, comme un absent ;
- apparaît dans **Inscriptions** avec un badge « Ne combat pas », et grisée ou à part dans la **Pesée** pour qu'on ne la pointe pas par erreur ;
- ne touche que **cette inscription** : un combattant inscrit en kata (fermé) et en karaté (ouvert) combat toujours en karaté ;
- s'affiche côté club (§2.3) ;
- s'annule depuis l'historique (§4.3).

🔧 Forme : par exemple un champ `withdrawn_reason` sur `registrations` (null, ou `closed_category`). Les vues qui filtrent aujourd'hui `presence !== 'absent'` doivent aussi exclure ces inscriptions : catégories, tableaux, passages, podiums, fiche de pesée. Le constructeur les recense.

### 4.3 Historique 💡
« Ne combat pas » s'inscrit dans la liste **« Réaffectations validées »**, comme une réaffectation, avec un type à part (« Retiré — catégorie fermée »), le filtre par type et le bouton **« Annuler »**. Après une annulation, le combattant retrouve sa carte s'il est toujours dans une catégorie fermée.

## 5. Mettre une carte de côté ✅ / 💡

### 5.1 Geste
Chaque carte de Réaffectation (tous types) reçoit un bouton discret **« Mettre de côté »**. Une petite fenêtre permet d'ajouter une **note facultative** (« on attend le coach », 80 caractères environ), puis de confirmer. La carte quitte la liste principale.

### 5.2 Où on la retrouve
Une section **« Mises de côté (N) »**, repliée par défaut, placée sous les cartes à traiter et au-dessus de l'historique :
- chaque carte y figure en **une ligne** : nom, type de cas, note, heure de mise de côté, bouton **« Reprendre »** ;
- un clic sur la ligne déplie la carte complète, avec ses propositions et le déplacement manuel : on peut la traiter **sans la reprendre** ;
- traitée, elle disparaît comme une carte normale.

### 5.3 Ce que « de côté » change
- Le compteur **« Cas à traiter »** ne compte plus les cartes mises de côté. Un compteur **« Mises de côté »** apparaît à côté (couleur d'attention, pas de succès : ce n'est pas réglé).
- Les boutons **« Classer automatiquement »** **ignorent** les cartes mises de côté. C'est le but : ne pas les traiter maintenant.
- Dans **Tableaux**, le lien « N cas à traiter » d'une catégorie devient « N cas à traiter (dont M de côté) ».
- Au **lancement d'une session**, le panneau de lancement **rappelle** les cartes mises de côté de cette session (« 2 cartes mises de côté en Réaffectation »). Il avertit sans bloquer, comme pour les autres points d'attention.
- La mise de côté est **enregistrée sur le serveur**, pas dans le navigateur : tous les postes la voient, elle survit au rechargement et part avec le paquet de passage de main.

### 5.4 Durée de vie 💡
Une mise de côté est attachée à **la carte** (identifiant du cas `${kind}:${registrationId}`). Elle vaut tant que ce cas existe. Si le cas disparaît (réglé, pesée corrigée, catégorie rouverte), elle disparaît aussi. Si le même cas revient plus tard, il revient **dans la liste principale** : la situation a changé, il faut le revoir.

🔧 Stockage : par exemple une table `set_aside_cases (competition_id, case_id, note, created_at)`, sur le modèle de `refusals`. On peut ignorer à la lecture les lignes dont le cas n'existe plus, ou les nettoyer à l'écriture ; le constructeur choisit. Dans les deux cas, la table voyage dans le paquet (`package.ts`) et prévient les postes en direct.

## 6. Aide et documentation
- Nouvelles entrées dans `HELP` : section « Catégories ouvertes » de la Grille, carte « Catégorie fermée », section « Mises de côté ».
- `docs/guide-utilisateur.md` : un paragraphe pour fermer une catégorie, un pour traiter les combattants concernés, un pour mettre une carte de côté.

## 7. Hors champ
- Fermer une catégorie de **poids** (§2.1).
- Prévenir le coach par mail quand une catégorie ferme ou qu'un combattant ne combat pas. L'information est sur sa page d'inscription, l'organisateur prévient lui-même.
- Mettre de côté une **proposition** seule : « Refuser / Rétablir » existe déjà.
- Masquer des cartes dans l'interface des postes de zone (la Réaffectation ne s'y fait pas).

## 8. Découpage suggéré 💡
1. **Fermeture des catégories et ce que voient les clubs** (§2, §3) : urgent, avant l'envoi des fiches vers le 29 octobre.
2. **Carte « Catégorie fermée » et « Ne combat pas »** (§4).
3. **Mettre une carte de côté** (§5) : indépendant, peut passer en premier si besoin.

Tests : unités du domaine (cases fermées, détection `closed`, cibles exclues, mise de côté ignorée par la classification automatique), routes (refus en ligne, paquet de passage de main), et un e2e par partie : fermer une case → la fiche en ligne ne la propose plus → l'inscrit existant a une carte → « Ne combat pas » → visible côté club ; mettre de côté → compteur → reprendre.
