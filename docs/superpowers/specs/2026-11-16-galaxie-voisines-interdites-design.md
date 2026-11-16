# Galaxie : voisines interdites par les réglages (étape 49)

Petit changement de la galaxie des catégories (étape 48, `2026-11-15-galaxie-des-categories-design.md`).

## Pourquoi

Le jour J, un combattant est seul (exemple réel : Shido-mix Juniors M +76 kg). La catégorie la plus proche pour lui
(Seniors M -84 kg) n'apparaît pas dans la galaxie : le passage mineurs → adultes est désactivé dans les réglages, et la
galaxie ne montre que les déplacements que la Réaffectation pourrait proposer. L'organisateur veut pourtant **la voir et
pouvoir y glisser le combattant, avec confirmation** (décision prise à la main, en connaissance de cause), sans aller
changer les réglages de la compétition.

## Objectifs

- Autour de l'étoile survolée ou choisie, montrer aussi les catégories voisines **interdites par les réglages**, avec un
  lien distinct qui dit quel réglage bloque.
- Les rapprocher en cartes comme les autres voisines ; on peut y glisser un combattant (glisser-déposer ou clic-clic), la
  confirmation habituelle dit ce qui est enfreint.

## Hors du sujet

- Les interdits qui ne viennent pas des réglages restent sans lien : mineur en shobu, jiyu → shobu, disciplines hors des
  préférences (kata), écart de plus d'une tranche d'âge.
- Les places des étoiles ne changent pas (elles sont déjà calculées avec toutes les règles).
- Les liens permis, leurs couleurs et leur ordre ne changent pas.
- Rien ne change dans la Réaffectation ni dans le moteur.

## À ne pas faire

- Qu'un lien interdit ressemble à un lien permis (même le rouge en pointillés « au-delà de la coupure », qui est permis).
- Brouiller le ciel : pas de liens interdits avec « Tous les liens ».
- Faire passer une voisine interdite avant une voisine permise dans les cartes.

## Approches

- **A. Calculer les liens deux fois (choisie).** `galaxyLinks` avec les réglages de la compétition (liens permis, comme
  aujourd'hui), puis avec tous les réglages ouverts (`withAllRules(settings, grid)`, même ordre et même coupure). Un
  sens présent seulement dans le second calcul est « interdit par les réglages » ; les réglages en cause se déduisent
  des règles de ce sens qui sont éteintes dans les réglages réels (et, pour `mixSexes`, des tranches non cochées).
  Réutilise le calcul calé sur le moteur sans le toucher. Coût : un second calcul, rapide, refait seulement quand les
  catégories ou les réglages changent.
- **B. Un seul calcul qui note ce qui bloque.** Plus direct, mais retouche le cœur du calcul des voisinages, qui doit
  rester calé sur le moteur : plus de risque d'écart, même résultat à l'écran. Écartée.

Conséquence assumée de A : un sens possible par un chemin permis reste permis, même si un chemin interdit serait plus
proche. C'est ce qu'on peut réellement faire.

## Ce qui a été décidé

- **Quels réglages** : mélange mineurs / adultes, mélange seniors / vétérans, mélange filles / garçons (interrupteur ou
  tranche non cochée), shobu → jiyu, et toute règle désactivée dans la liste des règles de réaffectation.
- **Lien** : gris, en pointillés fins, montré seulement pour l'étoile survolée ou choisie. Étiquette grise sur le lien
  (voisines rapprochées) et sur le bord de la carte : « Interdit : <nom du ou des réglages> » (noms de `RULE_LABELS`,
  par exemple « Interdit : Mélange mineurs / adultes »).
- **Cartes** : les voisines permises d'abord (ordre des règles de la compétition, comme aujourd'hui), puis les
  interdites (dans le même ordre, selon leurs règles), au plus 14 en tout. Une voisine d'une autre session garde son
  badge de session.
- **Glisser** : comme sur toute carte ; la confirmation existante (aperçu du déplacement) liste ce qui est enfreint,
  par exemple « Mélange mineurs / adultes non autorisé (réglages). ».
- **Légende** : une ligne de plus, trait gris pointillé : « interdit par les réglages (déplacement à la main, avec
  confirmation) ».

## Laissé à la construction

- La forme des données (marque « interdit » sur un sens de `GalaxyLink`, ou liste à part).
- Vérifier que la confirmation nomme bien le réglage pour chaque cas (mélange filles / garçons, shobu → jiyu, règle
  désactivée) ; l'ajouter là où il manque.
- Teinte exacte du gris, lisible sur le ciel sombre et distincte du texte pâle des étoiles.
