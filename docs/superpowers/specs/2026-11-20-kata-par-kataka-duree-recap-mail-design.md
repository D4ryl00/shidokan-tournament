# Un passage par kataka, durée des combats affichée, récapitulatif envoyé par mail

Date : 2026-11-20 · Compétition : 2026-11-22 · Aucune session n'est lancée à ce jour.

Trois changements indépendants, faits dans cet ordre : **(1) durée des combats affichée**, **(2) envoi du récapitulatif PDF
par mail**, **(3) un passage (et un numéro) par kataka**.

---

## 1. Durée des combats affichée

### Intention
À l'appel, la table de zone doit savoir quel format lancer (« 2 rounds de 2 min · prolongation 1 min ») sans aller chercher
dans les réglages ; l'organisateur veut aussi le voir sur chaque combat d'un tableau.

### Ce qui existe
`combatTiming(settings, groupe, durations, matchId, isFinal)` (`src/domain/schedule/durations.ts`) donne la durée d'un combat
avec sa précédence : exception du combat → finale du tableau → tableau → finale de la compétition → groupe d'âge.
`timingText` n'écrit que « 2 × 2 min ».

### Ce qui se construit
- Un texte long, dans le domaine : « 2 rounds de 2 min · prolongation 1 min » ; « 1 round de 3 min » ; sans prolongation
  (0 s) : la partie « · prolongation … » disparaît. Les minutes/secondes s'écrivent avec `minSecText` (« 1 min 30 », « 45 s »).
  Le repos n'est pas affiché.
- **Carte de zone (Combats)** : chaque combat de la file (`QueueItem`) porte ce texte, calculé côté serveur avec
  `combatTiming` (finale comprise). Affiché sous la catégorie, dans « À l'appel » et sur chaque ligne de « Ensuite ».
  Rien pour un kata.
- **Tableaux → Liste** : chaque combat du tableau affiché (`BracketView` de la vue Liste) montre ce texte. Seulement la vue
  Liste (pas la planche, pas l'impression, pas la page publique).

### Non-objectifs
Changer les réglages de durée ou leur saisie ; afficher la durée à l'impression ou au public.

---

## 2. Envoi du récapitulatif PDF par mail

### Intention
Envoyer à chaque club son récapitulatif PDF (déjà téléchargeable depuis l'onglet Clubs) sans passer par sa propre messagerie,
club par club ou à tous d'un coup.

### Ce qui existe (à réutiliser)
- PDF par club : `GET /api/competitions/:id/clubs/:clubId/recap.pdf` (`buildClubRecapPdf`, `clubRecapLines`), nom de fichier
  `recapitulatif-<club>.pdf` ; .zip de tous.
- Envoi des invitations (`src/server/mail.ts`) : transport SMTP/Google, destinataires = e-mails du coach du club, journal des
  mails, envoi groupé en tâche de fond suivi par la page (`SendJobs`, un envoi à la fois par compétition).
- Message propre à la compétition édité dans l'onglet Fiche club (`CompetitionMessage`, `MailMessageEditor`, aperçu),
  stocké dans `competition.settings.invitationMail`.

### Ce qui se construit
- **Message du récapitulatif**, propre à la compétition : `competition.settings.recapMail` (même forme que `MailTemplate`,
  null = texte de départ fourni par l'app). Pas de niveau « Paramètres de l'application ». Variables : `{club} {coach}
  {competition} {date} {lieu}` (pas `{lien}` ni `{date_limite}`). Texte de départ (choix du constructeur, sobre) : objet
  « Récapitulatif {competition} — {club} », corps qui salue le coach et dit que le récapitulatif des inscriptions est joint.
- **Onglet Clubs** : un volet repliable « Message du récapitulatif » (objet, éditeur identique à celui de la Fiche club, aperçu
  pour un club), placé sous l'en-tête de la page. Mention : « Le récapitulatif PDF du club est joint automatiquement. »
- **Par club** : une icône enveloppe juste à droite de l'icône de téléchargement du récapitulatif. Désactivée (avec
  infobulle) si le club n'a aucune inscription ou aucun e-mail. Clic → fenêtre de confirmation (destinataires, objet) →
  envoi immédiat → notification du résultat (envoyé / erreur lisible).
- **Global** : bouton « Envoyer les récapitulatifs à tous les clubs » à côté de « Tous les récapitulatifs (.zip) ».
  Confirmation qui dit combien de clubs le recevront et lesquels sont sautés (sans inscription, sans e-mail), puis envoi en
  tâche de fond avec le même suivi d'avancement et le même résumé que les invitations. Partage le verrou « un envoi à la fois
  par compétition » avec les invitations.
- Pièce jointe : seulement le PDF du club (pas les pièces jointes de l'invitation). Le PDF est généré au moment de l'envoi
  (état du moment).
- Chaque envoi est inscrit dans le journal des mails comme les invitations, distinguable (type « récapitulatif »).
- Compétition tenue ailleurs (`managedHere === false`) : même règle que les invitations (lecture seule / pas d'envoi).
- On peut renvoyer autant de fois qu'on veut (aucun suivi « déjà envoyé »).

### Non-objectifs
Envoi programmé ; choix des destinataires autres que les e-mails du club ; suivi de lecture.

---

## 3. Un passage par kataka

### Intention
Dans Combats, un kata se joue comme une suite de combats : la carte « À l'appel » montre **une seule personne** ; le kataka
suivant est la première ligne de « Ensuite ». Chaque kataka a **son propre numéro de passage**. L'organisateur veut que chaque
kataka soit un passage à part entière (« plus de modularité au cas où »), pour pouvoir plus tard en déplacer un ou intercaler
des passages — sans que cela soit construit maintenant.

### Approches considérées
- **A. Le bloc reste un passage qui consomme N numéros.** Peu de changements, mais un kataka n'existe pas comme passage :
  impossible de le déplacer seul plus tard.
- **B. Chaque kataka est un passage (choisi).** Chaque passage de kata a sa propre clé, son numéro, sa zone ; plus de travail
  (environ 35 endroits identifient un passage), mais toute la mécanique existante (figeage, déplacements, zone des finales,
  joué/non joué) s'applique kataka par kataka.

### Identité des passages de kata (`matchId`)
- **Tour 1** : un passage par kataka du tirage, dans l'ordre `bracket.order` : `kata:tour1:<registrationId>`. Les absents
  tardifs gardent leur passage (et leur numéro) ; il n'est jamais appelé (sauté dans la file, comme un passage fini).
- **Finale** : deux passages positionnels `kata:finale:1` et `kata:finale:2` (finalistes inconnus avant la fin du tour 1).
  Position = ordre de la finale (`finalists`, celui de la feuille de notation).
- **Kata à 2** (pas de tour 1) : seulement `kata:finale:1` et `kata:finale:2`.
- Les anciennes clés (`null`/'kata', 'kata:tour1', 'kata:finale') disparaissent du plan. Le bloc « entier » (finale non
  séparée) devient : les passages du tour 1 suivis immédiatement des deux passages de finale, sur la même zone.
- Finale séparée (zone des finales, « dès que finie », « fin de session ») : les deux passages de finale suivent les mêmes
  règles que l'ancien bloc 'kata:finale', toujours ensemble et consécutifs.

### Ordre par défaut
Identique à aujourd'hui : sur chaque zone, les katas d'abord, catégorie par catégorie (rang), katakas dans l'ordre du tirage,
puis les combats. Seule différence : un numéro par kataka au lieu d'un par bloc. Un kata de 5 au n° 14 occupe 14 à 18
(tour 1) puis 19-20 (finale) s'il n'est pas séparé ; le passage suivant prend le 21.

### Joué / non joué
- `kata:tour1:<rid>` joué : au moins une note de tour 1 pour ce kataka.
- `kata:finale:k` joué : le k-ième finaliste a au moins une note de finale.
- `playedKeys`, la file (`unplayed`, `kataDone`), le figeage et les déplacements utilisent ces règles.
- **Absent tardif** (choix du concepteur) : son passage du tour 1 est traité comme gardé — jamais renuméroté ni déplacé par
  « À la suite », « Mélangés » ou un déplacement de catégorie — et jamais appelé. Il ne compte pas comme « joué » pour
  l'ouverture de la finale (qui garde sa règle actuelle). Cas de test explicite.

### Carte de zone (Combats)
- Un élément de file par passage de kata non joué et non absent : n°, « catégorie (tour 1 | finale) », **nom et club du
  kataka**, « kataka 3 sur 7 ».
- Finale aux finalistes inconnus : « Finaliste 1 » / « Finaliste 2 » (à connaître), avec la catégorie.
- « À l'appel » : une seule personne ; « Se prépare » disparaît. « Ensuite » : une ligne par kataka.
- Bouton « Noter » : ouvre le panneau de notation de la catégorie, comme aujourd'hui (la notation ne change pas).
- Limite d'affichage de la file (6 premiers + finales prêtes) inchangée.

### Durées estimées
Un passage de kata vaut `kataPassageSec` ; le changement (`changeoverSec`) ne s'ajoute qu'au premier passage d'une suite de
passages consécutifs d'une même catégorie et d'un même tour, pour que la durée totale estimée d'une catégorie reste celle
d'aujourd'hui.

### Figeage, numéros à jour, déplacements
- `stillValid` compare l'ensemble exact des clés de passage du kata (tour 1 par inscrit + finale). Un retrait ou un ajout
  après lancement rend la catégorie « à numéroter », comme un combat.
- « À la suite » / « Mélangés », zone des finales, permissions d'un poste de zone (`permissions.ts` : la zone d'un passage de
  kata du tour visé), journal de zone : adaptés aux nouvelles clés, même comportement.

### Page publique (décidé : une ligne par kataka)
- Onglet **Zones** : une ligne par passage de kata, comme un combat : numéro, nom public du kataka (ou « Finaliste 1/2 »
  tant que la finale n'est pas connue), catégorie et tour, heure estimée « vers … » propre à ce passage, « À suivre ».
- Onglet **Suivis** et ★ : le kataka suivi a sa propre ligne et son heure estimée.
- Heures estimées par passage : la fin d'un passage de kata se date à sa première note (tour 1 : note du kataka ; finale :
  note du finaliste) ; les estimations suivantes partent de là, comme pour un combat terminé.
- Les types publics (`PublicQueueItem`, numéros par catégorie), `times.ts`, `follow.ts` et le paquet de synchronisation
  suivent les nouvelles clés. La page publique ne doit jamais casser (anti-objectif).
- Planche et impression : le texte « passage n° 14 » devient la plage du kata (« n° 14 à 18 · finale n° 19-20 (zone) ») ;
  la feuille de kata imprimée montre le numéro à côté de chaque kataka du tour 1, et les deux numéros de finale.

### Mise en service (décidé)
Les trois parties sont faites, toutes pour le 22. Parties 1 et 2 d'abord, mises en ligne dès qu'elles sont prêtes ; puis la
partie 3. **Aucune session ne doit être lancée avant la mise en ligne de la partie 3** (sinon tous les katas deviennent « à
numéroter »).

### Données existantes
Aucune session n'est lancée : pas de numéros figés à convertir. Si des lignes figées avec les anciennes clés existent malgré
tout, elles rendent la catégorie « à numéroter » (comportement normal) ; aucune migration de données. Vérification de l'état
réel par l'API (jamais en ouvrant la base vivante depuis l'hôte).

### Non-objectifs
Interface pour déplacer un seul kataka ou intercaler des combats entre katakas ; changer l'ordre par défaut ; changer la
notation des katas.

### Anti-objectifs
Changer les numéros ou l'ordre des combats ; casser la notation, le podium, les finales de kata ou la page publique.

### Aide
Mettre à jour `combats.zone` (un numéro par kataka, une personne à l'appel), et les aides qui parlent de « toute la catégorie
de kata sous un seul numéro ».

---

## Laissé au constructeur
Libellés exacts, mise en page fine, découpage du code, texte de départ du message du récapitulatif, forme exacte de la plage
de numéros affichée sur la planche.
