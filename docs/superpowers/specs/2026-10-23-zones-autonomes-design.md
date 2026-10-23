# PC de zone autonomes (étape F) — conception

**Date :** 2026-10-23 · **Complète :** `docs/superpowers/specs/2026-10-23-inscriptions-en-ligne-et-synchronisation-design.md` §2 (une seule machine a la main) et §10 (principes de l'étape F), qu'elle précise et remplace pour ce cas.

Légende : ✅ décidé par l'organisateur · 💡 choix du rédacteur (à vérifier en relisant) · 🔧 laissé au constructeur.

**Construit** le 2026-10-23 (feuille de route, étape 21 ; plan `docs/superpowers/plans/2026-10-23-21-zones-autonomes.md`). Les écarts et précisions du constructeur sont au §10.

---

## 1. Pourquoi

Le jour J se déroule en réseau local : le PC principal a la main, la table centrale y travaille, et chaque zone saisit ses résultats depuis le navigateur d'un PC portable, comme poste « Zone » du PC principal (étape A).

On veut **anticiper une coupure du réseau en pleine journée** ✅ (routeur en panne, câble arraché), qu'elle soit brève ou longue ✅. L'organisateur veut la solution technique, pas seulement le papier ✅. Ce n'est pas un besoin déjà vécu, mais une précaution ✅.

Matériel ✅ : **un PC portable par zone, avec l'application déjà installée** (Docker), en plus du PC principal.

**Réussi si :**
- au moment de la coupure, chaque zone continue à faire combattre et à saisir ses résultats en moins d'une minute, sans ressaisir ce qui précède ;
- au retour du réseau (ou par clé USB), tous les résultats des zones arrivent sur le PC principal ;
- rien n'est écrasé ni perdu sans qu'une personne l'ait décidé.

**Échec même si « ça marche » :**
- un résultat de zone remplace en silence un résultat différent saisi à la table centrale ;
- un résultat est appliqué à un combat dont les combattants ont changé entre-temps (réaffectation, déplacement, régénération) ;
- un même journal appliqué deux fois, ou une saisie perdue parce que l'envoi a échoué ;
- une zone autonome qui modifie autre chose que ses propres combats.

## 2. Principe

Le §2 de la conception d'origine tient toujours : **on ne fusionne jamais deux bases**. Pendant la coupure, le PC principal garde la main sur la compétition. Chaque portable de zone n'a la main que sur **les saisies de sa zone**, sur sa copie locale. Au retour, il n'envoie pas sa base : il envoie un **journal d'opérations**, que le PC principal rejoue avec ses règles habituelles. Un vrai conflit est montré à une personne, jamais tranché tout seul.

## 3. Avant la coupure : le portable suit le PC principal

- **Réglage du portable** (Réglages de l'application, rôle local) : adresse du PC principal (par exemple `http://192.168.1.10:3000`), compétition, et zone (choisie dans la liste des zones de la compétition) ✅.
- Le portable **récupère une copie** de la compétition, en lecture seule, **dans les secondes qui suivent chaque changement** sur le PC principal 💡 : il écoute le flux d'événements de la compétition (`GET /api/competitions/:id/events`, étape A), puis copie (regroupé, au plus une copie à la fois), avec en plus une copie chaque minute par sécurité. Il passe par l'export de compétition qui existe déjà (`GET /api/competitions/:id/export.json`, ouvert sans connexion en rôle local). Ainsi, au moment de la coupure, il ne manque presque jamais de saisie. L'état « à jour à HH:MM:SS » ou « PC principal injoignable » est affiché. 🔧 S'inspirer de « Garder cette copie à jour » (étape 20) et du paquet de compétition (étape 18) ; une copie inchangée n'est pas réimportée.
- Pendant ce temps, **rien ne change pour l'arbitre** ✅ : le navigateur du portable reste le poste « Zone » du PC principal, ouvert à son adresse.
- La copie est rangée comme une copie en lecture seule « du PC principal » (bandeau « Copie du PC principal — à jour à HH:MM — lecture seule »). 💡

## 4. Pendant la coupure : zone autonome

- Sur le portable, l'opérateur ouvre l'application locale (`http://localhost:3000`) et clique **« Continuer sans réseau (zone Tatami 2) »** ✅. La fiche « Préparer le jour J » l'explique, et l'aide de l'écran Combats aussi. 💡
- La copie locale devient **modifiable pour les saisies de cette zone seulement** ✅ :
  - résultats des combats, effacement d'un résultat, notes de kata, départages ;
  - la zone d'une saisie suit la même règle que les comptes Zone de l'étape 20 (zone du passage du combat ou du bloc de kata, sinon celle de la catégorie ; départage : une zone qui a un passage de la catégorie).
- **Seulement les sessions déjà lancées dans la copie** ✅ : un combat ou un bloc de kata d'une session qui n'est pas lancée sur la copie n'est pas modifiable (sa zone pourrait changer au lancement sur le PC principal, et deux zones joueraient le même combat). L'écran dit « Session suivante pas encore lancée sur cette copie ».
- **Finales** ✅ : les trois possibilités, voir §4.1.
- **Tout le reste est en lecture seule** : inscriptions, pesée, réaffectations, déplacements, sessions, autres zones. Le serveur local refuse (409) avec un message clair. L'écran se règle sur le poste « Zone » de cette zone.
- **Chaque saisie est notée dans un journal** ✅. Une entrée contient :
  - un identifiant unique et un numéro d'ordre ;
  - le type (résultat, effacement, notes de kata, départage) et ce qui a été saisi ;
  - la catégorie, le combat (ou l'inscription et le tour pour un kata, la portée pour un départage) ;
  - **les deux combattants du combat au moment de la saisie**, et la version de la ligne lue (résultat, notes, départage). La version de la catégorie est notée pour l'affichage seulement : elle change à chaque résultat, elle ne sert pas à détecter un conflit 💡 ;
  - l'heure et la zone.
- Bandeau permanent : **« Zone autonome Tatami 2 depuis 14 h 32 — 5 saisies à renvoyer »** ✅.
- Les tableaux et les feuilles s'impriment depuis la copie locale, comme d'habitude.
- Une zone qui corrige sa propre saisie (même combat saisi deux fois pendant la coupure) : au rejeu, la seconde entrée se compare à la première, pas à la version du PC principal 💡.
- Pendant ce temps, le PC principal **continue normalement** ✅. La table centrale peut saisir un combat de cette zone ; ce sera un conflit au retour.

### 4.1 Finales pendant une coupure ✅

Quand une zone des finales est réglée, les finales (et les finales de kata) de toutes les catégories s'y jouent, avec des combattants venus des autres zones. Pendant la coupure, le portable de la zone des finales ne connaît pas ces vainqueurs. Les trois possibilités sont construites, dans cet ordre ✅ :

- **a. Les finales attendent** (par défaut) : elles s'affichent « En attente des résultats des autres zones » jusqu'au retour des journaux.
- **b. « Jouer ici les finales de mes catégories »** : bouton du portable en zone autonome, avec confirmation. La zone autonome s'étend aux finales des catégories dont les autres passages sont sur sa zone. Au rejeu, si la zone des finales (ou le PC principal) a joué la même finale, c'est une carte « À trancher », comme tout conflit.
- **c. Recevoir une copie plus récente pendant la coupure** (par fichier, ou par le réseau s'il revient un moment) : le portable prend la nouvelle copie, puis **rejoue chez lui ses propres saisies pas encore renvoyées**, avec les mêmes règles et les mêmes cartes en cas de conflit. Il ne perd rien. Cela sert aux finales (après un aller-retour des journaux par clé USB : journaux des zones vers le PC principal, puis nouvelle copie vers le portable des finales), et aussi à rafraîchir une copie en retard. Construit en dernier.

## 5. Au retour : « Repasser en ligne »

- Sur le portable, le bouton **« Repasser en ligne »** ✅ envoie le journal au PC principal par le réseau.
  - Envoi réussi : la zone autonome s'arrête, le portable redevient une copie en lecture seule, et l'opérateur rouvre l'adresse du PC principal dans son navigateur (l'écran le lui propose).
  - Envoi impossible (PC principal injoignable) : la zone reste autonome, le journal est gardé, rien n'est perdu ✅.
- **Par clé USB** ✅, si le réseau ne revient pas : « Exporter le journal (fichier) » sur le portable, puis « Importer un journal de zone (fichier) » sur le PC principal. Les règles sont les mêmes. Une fois le fichier exporté, le portable peut aussi arrêter la zone autonome (avec confirmation : ce qui serait saisi ensuite ne serait pas dans le fichier). 💡
- **Un journal n'est appliqué qu'une fois** ✅ : chaque entrée garde son identifiant ; une entrée déjà reçue est ignorée, même si le journal est renvoyé ou importé deux fois.

## 6. Sur le PC principal : rejouer, et montrer les conflits

- Les entrées sont rejouées **dans l'ordre**, chacune à travers les règles habituelles de l'application (les mêmes contrôles que si elle avait été saisie sur place) ✅.
- **Sans conflit, elle s'applique tout de suite** ✅ :
  - le combat a toujours les mêmes deux combattants, et le résultat sur le PC principal est toujours celui que la zone avait lu (même version, ou pas de résultat des deux côtés) ;
  - ou le PC principal a déjà **exactement le même résultat** (par exemple saisi juste avant la coupure) : rien à faire, l'entrée est notée comme « déjà présente ».
- **Conflit : rien n'est écrasé** ✅. Cas :
  - le PC principal a un autre résultat pour ce combat (saisi par la table centrale, ou effacé) ;
  - les combattants du combat ont changé (réaffectation, déplacement, régénération du tableau) ;
  - les règles refusent la saisie (combat qui n'existe plus, catégorie verrouillée…).
- Chaque conflit devient une **carte** dans une section **« À trancher »** de l'onglet Combats du PC principal ✅, visible des postes Organisation et Table centrale. La carte montre côte à côte ce qu'a saisi la zone et ce qu'il y a sur le PC principal, avec **« Garder celui de la zone »** et **« Garder celui du PC »** ✅. « Garder celui de la zone » n'est proposé que si les règles l'acceptent (combattants identiques) ; sinon la carte dit pourquoi, et « Garder celui du PC » la ferme.
- **Saisies qui dépendent d'un conflit** ✅ : le combat suivant d'un vainqueur dépend du résultat en conflit. Ces saisies ne sont pas devinées : elles deviennent aussi des cartes, liées à la première. 💡 Après chaque décision, les cartes en attente sont réexaminées, et celles qui n'ont plus de conflit s'appliquent toutes seules.
- **Sur l'écran de la zone, au retour** 💡 : tant qu'une carte d'une catégorie est ouverte, les combats de cette catégorie sont marqués « En attente d'une décision à la table centrale » dans la file de la zone, et ne lui sont pas proposés comme prochains combats (sinon un même combat pourrait être joué deux fois, avec d'autres combattants).
- Un compte rendu s'affiche à la réception : « 12 saisies reçues de Tatami 2 : 9 appliquées, 1 déjà présente, 2 à trancher ».
- Les écrans des autres postes se mettent à jour, comme pour toute écriture (étape A).

## 7. Non-objectifs et anti-objectifs

- Pas de fusion de bases, ni de « la dernière modification gagne » (conception d'origine, §12).
- Une zone autonome ne fait **que** les saisies de sa zone : pas d'inscription, de pesée, de déplacement, de régénération.
- Pas de renvoi automatique du journal : c'est un geste ✅.
- Pas de zones autonomes face au serveur en ligne : ce cas est couvert par le PC en secours de l'étape 20. Ici, seulement le PC principal en réseau local. 💡
- Pas de nouvelle protection par mot de passe en réseau local (comme l'étape A : la protection vient du Wi-Fi fermé).

## 8. Ce qui existe déjà et sert ici

- Identité de chaque installation, versions de lignes et révisions (étapes 15 et 19).
- Résultats qui gardent les deux combattants au moment de la saisie (`match_results.entrant_a`, `entrant_b`).
- Plan de passage, zone d'un combat et d'un bloc de kata (`entryZones`, étape 20).
- Paquet de compétition, export par fichier, copie tenue à jour (étapes 18 et 20).
- Cartes de décision, comme pour les réaffectations (étape 5).

## 9. Laissé au constructeur 🔧

- Forme exacte du journal (table, format du fichier) et de sa réception.
- Manière de marquer la copie « du PC principal » et la zone autonome sur le portable (à côté de la main de l'étape 18).
- Disposition des cartes « À trancher ».
- Messages et textes d'aide, dans le style des étapes précédentes.

## 10. Construit : écarts et précisions 🔧

- **Réglage du portable** : Réglages de l'application → « Portable de zone » (adresse du PC principal, « Chercher », compétition, zone). Réglage `zoneLink` de l'installation ; la copie est rangée avec la main au PC principal (`Management.copyOfMain`), et l'empreinte de la version reçue est retenue (`export.json` la donne).
- **Suivi** : flux d'événements du PC principal, copie regroupée sur 1 s après chaque changement, au plus une à la fois (une demande pendant une copie attend la fin de celle-ci), plus une copie par minute ; reconnexion 5 s après une coupure. La main et la zone autonome sont revérifiées avant **et** après l'échange réseau : une copie arrivée juste après « Continuer sans réseau » n'écrase rien.
- **Journal** : tables `zone_journal` (portable) et `zone_entries` (PC principal), propres à l'installation (elles ne voyagent pas avec la compétition) et effacées avec les autres données d'organisation après le délai de conservation. Une saisie est notée avant que sa réponse parte (elle est toujours dans le journal si l'écran l'a confirmée). Fichier : `journal-<zone>-<AAAAMMJJ-HHMMSS>.json`.
- **Garde** : la session lancée est vérifiée avant la zone (une catégorie d'une session non lancée peut encore changer de zone). Pendant l'envoi du journal, ou la réception d'une copie plus récente, les saisies sont refusées quelques instants (« Envoi du journal en cours… », « Nouvelle copie en cours de réception… ») : elles ne seraient pas dans le journal envoyé, ou seraient remplacées.
- **Rejeu** : une entrée attend aussi derrière une entrée encore à trancher du **même portable** reçue lors d'un envoi précédent ; la correction par la zone de sa propre saisie est reconnue même d'un envoi à l'autre. Les réceptions (réseau et fichier) et les décisions sont faites une à la fois par compétition.
- **Copie après le retour** : toute saisie de la zone autonome efface l'empreinte retenue sur le portable ; la copie suivante remplace donc toujours la copie locale, même quand le PC principal n'a rien appliqué et n'a pas changé de contenu.
- **Cartes** : « Garder celui de la zone » n'est affiché que si les combattants n'ont pas changé ; sinon la carte le dit et « Garder celui du PC » la ferme. Le compte rendu compte « à trancher » les conflits et les entrées en attente.
- **File de la zone** : chaque zone indique aussi combien de ses combats attendent les résultats d'une autre zone (finales sur la zone des finales) ; le portable l'affiche en zone autonome.
- **Copie plus récente (c)** : mêmes règles qu'au PC principal (une saisie derrière un conflit de sa catégorie n'est pas réappliquée) ; une copie qui ne vient pas du PC principal relié est refusée ; une sauvegarde est faite avant.
- **Écran** : en zone autonome, le poste « Zone » de la zone est imposé sur la compétition du portable ; après « Repasser en ligne », un lien « Ouvrir le PC principal ».

