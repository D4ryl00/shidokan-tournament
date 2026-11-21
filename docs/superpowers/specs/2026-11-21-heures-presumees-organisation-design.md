# Heures de passage présumées côté organisation — design (court)

Date : 2026-11-21. Maquettes : `.superpowers/brainstorm/31339-1795244530/content/heures-v4.html` (Tableaux → Liste et onglet Combats) et
`heures-v5.html` (kata, sessions pas encore lancées).

## Intention

L'organisateur et la Table centrale voient, dans Tableaux → Liste et dans l'onglet Combats, l'heure présumée de passage de
chaque combat (« vers H:MM »). Ce sont les mêmes heures que celles du mode spectateur (spec
`2026-11-08-mode-spectateur-design.md` §5.3), recalculées à chaque résultat saisi.

## Objectifs

- **Tableaux → Liste**
  - Ligne de catégorie (colonne de gauche) : « Zone · prochain vers H:MM · finale vers H:MM » (« 1er combat » tant que rien
    n'est joué ; kata : « tour 1 vers … · finale vers … »). Rien pour une catégorie terminée.
  - En-tête de la catégorie choisie : badge d'avance / retard de sa zone.
  - Carte d'un combat du tableau : l'heure à droite de l'en-tête, à la place du résultat (combat joué : son résultat ; combat
    en cours : « sur le tatami » ; à venir : « vers H:MM », y compris « Vainqueur du combat N »). La ligne des rounds
    existante (« 2 rounds de 1 min 30 · prolongation 1 min ») reste sous l'en-tête.
- **Onglet Combats**
  - En-tête de chaque carte de zone : badge « en retard de N min » (orange) / « en avance de N min » (vert) ; rien quand la
    zone est à l'heure.
  - Carte « À l'appel » : « vers H:MM » en haut à droite, sur la ligne « À l'appel » (le numéro garde le coin gauche).
    **Elle reste affichée même une fois dépassée** (décision de l'utilisateur).
  - Lignes « Ensuite » : « vers H:MM » en haut à droite, au-dessus du bouton « Saisir ». Ligne des finales « fin de
    session » : même heure à droite. La ligne des rounds reste sous la catégorie.
  - Liste des catégories (quand elle est ouverte) : même ligne que dans Tableaux → Liste.
- **Kata : une heure par kataka** (décision de l'utilisateur)
  - Tableau du kata (Tableaux → Liste) : colonne « Heure » (noté : sa note ; en cours : « sur le tatami » ; à venir :
    « vers H:MM ») ; ligne « Finale : n° 41 et 42 · vers H:MM ».
  - Écran de notation (onglet Combats) : « vers H:MM » sous le nom de chaque kataka pas encore noté.
  - File de la zone : chaque kataka a déjà sa ligne ; elle reçoit son heure comme un combat.
- **Session pas encore lancée : heures prévues visibles pour l'organisation** (décision de l'utilisateur)
  - Mêmes emplacements, en gris italique ; pas de badge d'avance / retard.
  - Un encadré en haut de la catégorie choisie : « Session … pas encore lancée : heures prévues d'après l'heure de début de
    la session et les durées, sans les résultats. Elles peuvent encore changer. »
  - Source : l'estimation de la journée (`estimateDay`, onglet Sessions), passages en direct, avec le même choix « Décaler
    une session qui commence avant la fin de la précédente » que la carte d'estimation (mémorisé dans ce navigateur).
  - Rien de tout cela sur la page publique (inchangée).
- « vers » toujours **devant** l'heure, avec une espace insécable (`versText`).

## Non-objectifs

- Pas d'heure sur les impressions.
- Aucun changement du calcul lui-même ni de la page publique.

## Approches

- **A — Réutiliser le calcul de la page publique (retenue).** Une route réservée à l'organisation renvoie la même vue que
  `/api/public/competitions/:id`, quelle que soit la visibilité ; le navigateur appelle `publicTimes(pub, now)` avec `useNow`
  (horloge toutes les 30 s) et se rafraîchit sur le flux d'événements de la compétition. Heures identiques à la minute à
  celles des téléphones des parents ; elles avancent sans recharger.
- B — Calculer les heures sur le serveur et les ajouter à `/schedule` et aux passages : juste seulement au moment de la
  requête (le calcul dépend de « maintenant »), et un second chemin de calcul qui peut diverger. Écartée.
- C — Appeler directement la route publique : ne marche pas pour une compétition privée. Écartée.

## Décidé

- Approche A ; heure dépassée du combat à l'appel affichée ; une heure par kataka ; heures prévues des sessions non lancées.
- Correspondance des heures par `passageKey` (`categoryId:matchId`), déjà utilisée par la vue publique.

## Laissé au constructeur (mes choix, à corriger si besoin)

- La route organisation réutilise `loadPublicSource` / `toPublicCompetition` en sautant seulement le contrôle de visibilité
  (option), derrière la garde de session habituelle ; accessible aux postes Organisation, Table centrale et Zone.
- L'heure brute (sans le filtre « jamais avant maintenant ») est exposée en plus pour le seul combat à l'appel ; le reste
  garde le filtre public.
- Sessions non lancées : `estimateDay` renvoie en plus l'heure de départ de chaque passage (même clé `categoryId:matchId`),
  servie par la route d'estimation existante ; une session lancée prend toujours ses heures du calcul public.
- Seuil « à l'heure » = celui de `driftText` (moins de 3 min).
- Tests : unitaires sur la ligne de catégorie et l'heure brute ; un e2e qui lance une session, saisit un résultat et lit les
  heures dans les deux onglets ; vérification sur Chrome (Claude in Chrome).
