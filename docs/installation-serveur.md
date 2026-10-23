# Installer l'application sur un serveur

Cette procédure met l'application en ligne, à l'adresse `https://competitions.shidokanfrance.com`, pour que les clubs inscrivent eux-mêmes leurs combattants avec leur lien personnel.

- L'image est publiée sur Docker Hub (`d4ryl00/shidokan-tournament`) : il n'y a rien à compiler sur le serveur.
- En ligne, l'application tourne en **rôle serveur** : les organisateurs se connectent avec un compte (e-mail et mot de passe). Les pages des clubs (`/inscription/…`) s'ouvrent seulement avec leur lien personnel.
- Le PC de la compétition, lui, ne demande pas de connexion.

## Ce qu'il faut

- Un serveur **Ubuntu** (22.04 ou plus récent) joignable depuis internet. L'image existe en `linux/amd64` et `linux/arm64`.
- Le DNS de `competitions.shidokanfrance.com` qui pointe vers l'adresse IP du serveur (enregistrement A, et AAAA en IPv6).
- Les **ports 80 et 443** ouverts sur le serveur, y compris au pare-feu de l'hébergeur. Caddy, le serveur web placé devant l'application, en a besoin pour obtenir et renouveler tout seul le certificat HTTPS (Let's Encrypt).
- Un compte qui enverra les mails aux clubs, par exemple un compte **Gmail** avec la validation en deux étapes activée.

Si le serveur a déjà un serveur web sur les ports 80 et 443 (nginx, Traefik, Apache…), suivez la variante en fin de document.

## 1. Installer Docker (une seule fois)

Installez Docker depuis le dépôt officiel de Docker (pas le paquet `docker.io` d'Ubuntu), pour avoir la commande `docker compose` :

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"   # puis se déconnecter et se reconnecter
docker compose version            # pour vérifier
```

## 2. Installer l'application

```sh
mkdir -p ~/shidokan && cd ~/shidokan
curl -fsSLO https://raw.githubusercontent.com/D4ryl00/shidokan-tournament/main/deploy/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/D4ryl00/shidokan-tournament/main/deploy/Caddyfile
docker compose up -d
docker compose ps          # « app » passe « healthy » après quelques secondes, « caddy » est « running »
docker compose logs caddy  # en cas de souci de certificat HTTPS
```

Pour une autre adresse que `competitions.shidokanfrance.com`, il y a deux endroits à changer :
- la première ligne du `Caddyfile` ;
- `PUBLIC_URL` dans `compose.yaml`, qui sert de base aux liens envoyés aux clubs.

## 3. Créer le premier compte organisateur

```sh
docker compose exec -it app node dist/server/cli.js add-user votre.adresse@exemple.fr
```

Le mot de passe est demandé deux fois, sans s'afficher (10 caractères au moins). Connectez-vous ensuite sur `https://competitions.shidokanfrance.com`. Les autres comptes se créent depuis l'application, menu **Comptes**.

Autres commandes : `… cli.js list-users`, `… cli.js delete-user <e-mail>`.

## 4. Régler l'envoi des mails et la mention sur les données

Dans l'application, menu **Réglages de l'application** :

1. **Envoi des mails**. Pour Gmail :
   - créez d'abord un **mot de passe d'application** dans le compte Google (Compte Google → Sécurité → Mots de passe des applications ; il faut la validation en deux étapes). Le mot de passe habituel du compte ne fonctionne pas ;
   - puis remplissez :
     - serveur `smtp.gmail.com`, port `465`, chiffrement TLS ;
     - identifiant : l'adresse Gmail ; mot de passe : le mot de passe d'application ;
     - nom de l'expéditeur, par exemple « Shidokan France » ; adresse de l'expéditeur : l'adresse Gmail.

   Cliquez « Enregistrer », puis « Envoyer un mail d'essai ». Gmail accepte environ 500 destinataires par jour.
2. **Données personnelles** : indiquez l'**adresse de contact** (par exemple une adresse de Shidokan France). Elle apparaît dans la mention en bas de la page de chaque club. Relisez la mention, et faites-la valider par Shidokan France si un référent RGPD existe.
3. **Message aux clubs** : le modèle de mail par défaut, modifiable. Chaque compétition peut aussi avoir le sien.
4. **Conservation** : 13 mois et 3 ans par défaut (voir plus bas).

## Préparer une compétition en ligne

1. **Annuaire des clubs** : créez ou complétez les clubs, avec l'e-mail du coach et si possible le numéro d'affiliation FFK (7 chiffres).
2. Créez la compétition, puis réglez sa grille et ses réglages comme d'habitude.
3. Onglet **Fiche club**, section « Inscriptions en ligne » :
   - indiquez la date limite, puis cliquez « Ouvrir les inscriptions » ;
   - choisissez les clubs dans « Clubs à inviter », puis cliquez « Inviter les clubs choisis » ;
   - cochez les clubs invités, puis cliquez « Envoyer le lien par mail ». **Chaque envoi crée un nouveau lien** et désactive le précédent : un coach qui ouvre un ancien mail voit « Ce lien a été remplacé : utilisez celui du dernier mail reçu. » Les filtres « Jamais envoyé », « Sans combattant » et « Avec e-mail » aident pour les relances ;
   - sans réglage d'envoi, « Ouvrir dans ma messagerie » prépare le mail dans votre propre messagerie, avec un nouveau lien.
4. Suivez les inscriptions dans l'onglet Inscriptions. Leur origine s'affiche « En ligne ».
5. À la date limite, cliquez « Figer les inscriptions » : les pages des clubs passent en lecture seule.

## Le jour J : passer la compétition au PC, puis la rendre au serveur

La compétition se déroule sur le PC de la salle, sans internet. Une compétition n'est modifiable qu'à un seul endroit à la fois, **là où est la main**. Ailleurs, elle est en lecture seule, et un bandeau le dit.

**Une fois : relier le PC au serveur.**
1. En ligne, menu **Réglages de l'application**, section **Synchronisation** : cliquez « Créer un jeton », puis copiez-le (il ne s'affiche qu'une fois).
2. Sur le PC, même menu et même section : indiquez l'adresse `https://competitions.shidokanfrance.com` et le jeton, puis cliquez « Enregistrer ».

**Avant la compétition** (internet nécessaire) : sur le PC, liste des compétitions, « Récupérer depuis le serveur », puis cliquez « Prendre la main » sur la compétition.
- Le PC devient le seul endroit où la modifier.
- En ligne, elle passe en lecture seule, et les inscriptions des clubs sont figées.
- « Récupérer une copie » permet aussi de la regarder avant, en lecture seule.

**Pendant la journée**, s'il y a internet : onglet Réglages de la compétition, section « Échanges avec le serveur », « Envoyer une copie au serveur ». C'est une copie de secours ; le PC garde la main.

**Après la compétition** : même section, « Rendre la main au serveur ». Le serveur reprend la compétition entière, avec ses résultats. Les autres compétitions en ligne, les liens des clubs et les mails envoyés ne sont pas touchés.

**Sans internet** : « Exporter la compétition (fichier) » d'un côté, sur une clé USB, puis « Importer une compétition (fichier) » de l'autre.
- Sur le serveur, cochez « et donner la main au PC qui l'importera ».
- Au retour, importez le fichier du PC en ligne, et confirmez « Reprendre la main ».

**PC perdu ou en panne** : en ligne, section « Échanges avec le serveur », « Reprendre la main ».
- Elle repart de la version du serveur, ou de la dernière copie reçue pendant la journée.
- Si un second PC a continué la compétition, exportez-la en fichier depuis ce PC, puis importez-la en ligne.

Les comptes, les sessions, les jetons, les réglages d'envoi des mails et la mention ne voyagent jamais : chaque installation garde les siens.

## Conservation des données

L'application efface toute seule, sans prévenir :
- **13 mois après une compétition** : le poids, la licence et le grade des combattants, les coordonnées des coachs gardées dans cette compétition, les liens personnels, le journal des mails et les fichiers importés. Le palmarès reste : noms, clubs, catégories, tableaux, résultats, podiums ;
- **dans l'annuaire, un club sans compétition depuis 3 ans** : il est archivé et ses coordonnées sont effacées ;
- **les sauvegardes plus anciennes que 13 mois**, sauf la plus récente.

Les délais se changent dans les Réglages de l'application.

## Mettre à jour l'application

```sh
cd ~/shidokan
docker compose pull app && docker compose up -d
```

La base est mise à niveau toute seule au démarrage. Chaque image porte aussi le numéro de version du code, par exemple `d4ryl00/shidokan-tournament:170f142`. Pour revenir à une version précise, remplacez `latest` par ce numéro dans `compose.yaml`.

## Sauvegarde hors du serveur

Les sauvegardes automatiques (toutes les 30 minutes quand quelque chose a changé) sont dans `~/shidokan/data/sauvegardes`. Copiez-les régulièrement ailleurs, par exemple chaque nuit depuis une autre machine :

```sh
rsync -a utilisateur@serveur:shidokan/data/sauvegardes/ ~/sauvegardes-shidokan/
```

- **Les sauvegardes ne contiennent pas les comptes.** Après une restauration sur un nouveau serveur, recréez-les avec `cli.js add-user`, et refaites les réglages d'envoi des mails.
- **N'ouvrez jamais `data/shidokan.sqlite` avec un autre programme depuis l'hôte** pendant que l'application tourne. Utilisez les fichiers de `data/sauvegardes/` ou « Télécharger la base complète ». La commande `docker compose exec app …` (le CLI des comptes), elle, est sans risque.

## Variante : un serveur web existe déjà sur les ports 80 et 443

1. Dans `compose.yaml`, supprimez le service `caddy` et le bloc `volumes:` du bas. Ajoutez au service `app` :
   ```yaml
       ports:
         - "127.0.0.1:3000:3000"
   ```
2. Dans votre serveur web, faites suivre le domaine (en HTTPS) vers `http://127.0.0.1:3000`. Transmettez les en-têtes `Host`, `X-Forwarded-For` et `X-Forwarded-Proto`, et autorisez des requêtes de 20 Mo (import des fiches). `X-Forwarded-For` doit contenir **seulement** l'adresse du client vue par votre serveur web : l'application ne fait confiance qu'au dernier intermédiaire, et s'en sert pour limiter les essais de mot de passe.

   Exemple pour nginx :
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;   # pas $proxy_add_x_forwarded_for : le client ne doit pas choisir son adresse
       proxy_set_header X-Forwarded-Proto $scheme;
       client_max_body_size 20m;
       access_log off;   # les adresses des pages des clubs contiennent leur lien personnel
       add_header Strict-Transport-Security "max-age=31536000" always;
       add_header X-Content-Type-Options "nosniff" always;
       add_header Referrer-Policy "no-referrer" always;
       add_header X-Frame-Options "DENY" always;
   }
   ```
3. **Journaux d'accès** : ne journalisez pas les adresses `/inscription/…`, ou masquez-les. L'application les masque déjà dans son propre journal.
