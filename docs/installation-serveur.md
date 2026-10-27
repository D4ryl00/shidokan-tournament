# Installer l'application sur un serveur

Cette procédure met l'application en ligne, à l'adresse `https://competitions.shidokanfrance.com`, pour que les clubs inscrivent eux-mêmes leurs combattants avec leur lien personnel.

- L'image est publiée sur Docker Hub (`d4ryl00/shidokan-tournament`) : il n'y a rien à compiler sur le serveur.
- En ligne, l'application tourne en **rôle serveur** : les organisateurs se connectent avec un compte (e-mail et mot de passe). Les pages des clubs (`/inscription/…`) s'ouvrent seulement avec leur lien personnel.
- Le PC de la compétition, lui, ne demande pas de connexion : voir la [vue d'ensemble](guide-utilisateur.md#1-vue-densemble).

## Ce qu'il faut

- Un serveur **Ubuntu** (22.04 ou plus récent) joignable depuis internet. L'image existe en `linux/amd64` et `linux/arm64`.
- Le DNS de `competitions.shidokanfrance.com` qui pointe vers l'adresse IP du serveur (enregistrement A, et AAAA en IPv6).
- Les **ports 80 et 443** ouverts sur le serveur, y compris au pare-feu de l'hébergeur. Caddy, le serveur web placé devant l'application, en a besoin pour obtenir et renouveler tout seul le certificat HTTPS (Let's Encrypt).
- Un compte qui enverra les mails aux clubs, par exemple un compte **Gmail**. L'application s'y connecte avec « Se connecter avec Google » (voir [Créer l'accès Google](#créer-laccès-google-une-seule-fois)).

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

Avec l'envoi par Google, l'adresse de redirection déclarée chez Google doit aussi changer (voir plus bas).

## 3. Créer le premier compte organisateur

```sh
docker compose exec -it app node dist/server/cli.js add-user votre.adresse@exemple.fr
```

Le mot de passe est demandé deux fois, sans s'afficher (10 caractères au moins). Connectez-vous ensuite sur `https://competitions.shidokanfrance.com`. Les autres comptes se créent depuis l'application, menu **Comptes**, avec un rôle :
- **Organisateur** : tout ;
- **Table centrale** : inscriptions, clubs, pesée, réaffectations, tableaux, sessions à lancer et résultats de toutes les zones ;
- **Zone** : résultats, notes de kata et départages de **sa zone**, dans **une** compétition. Pour la compétition suivante, changez son rôle (« Changer le rôle ») ou créez un autre compte.

Le serveur refuse ce que le rôle ne permet pas, et l'écran de chacun se règle sur son rôle.

Autres commandes : `… cli.js list-users`, `… cli.js delete-user <e-mail>`.

## 4. Régler l'envoi des mails et la mention sur les données

Dans l'application, menu **Réglages de l'application** :

1. **Envoi des mails** avec un compte Gmail. Il faut d'abord avoir [créé l'accès Google](#créer-laccès-google-une-seule-fois) :
   - choisissez **Compte Google**, puis cliquez **« Se connecter avec Google »** ;
   - choisissez le compte Gmail expéditeur. Google affiche **« Google n'a pas validé cette application »** : c'est attendu. Cliquez **Paramètres avancés**, puis **Accéder à Shidokan France (non sécurisé)** ;
   - acceptez. Si Google présente des cases à cocher, laissez cochée celle qui permet d'**envoyer des e-mails** : sans elle, l'application refuse la connexion. Laissez aussi cochée celle des **contacts** : sans elle, l'envoi fonctionne mais la synchronisation des coachs avec Google Contacts est indisponible ;
   - de retour dans les Réglages, l'écran affiche « Connecté : … ». Réglez le nom de l'expéditeur (« Shidokan France »), cliquez « Enregistrer », puis « Envoyer un mail d'essai ».

   Avec ce compte, l'application peut **envoyer** des mails, sans pouvoir les lire ni les supprimer, et **lire** les contacts (nom, mail, téléphone, entreprise, libellés), sans pouvoir les modifier : ils servent à synchroniser les coachs de l'annuaire. « Déconnecter » lui retire l'accès ; on peut aussi le retirer depuis le compte Google (Sécurité → Applications tierces). Si l'accès est retiré ou expire (par exemple quand le mot de passe du compte Gmail change), les Réglages affichent « reconnectez-vous ». L'application renouvelle d'elle-même l'accès chaque mois, pour qu'il n'expire pas entre deux compétitions. Gmail accepte environ 500 destinataires par jour.

   **Variante sans Google** (« Autre serveur (identifiant et mot de passe) ») : serveur SMTP, identifiant et mot de passe. Pour Gmail par ce chemin, il faut un **mot de passe d'application** (Compte Google → Sécurité → Mots de passe des applications, avec la validation en deux étapes), le serveur `smtp.gmail.com`, le port `465` et le chiffrement TLS.
2. **Données personnelles** : indiquez l'**adresse de contact** (par exemple une adresse de Shidokan France). Elle apparaît dans la mention en bas de la page de chaque club. Relisez la mention, et faites-la valider par Shidokan France si un référent RGPD existe.
3. **Message aux clubs** : le modèle de mail par défaut, modifiable. Chaque compétition peut aussi avoir le sien.
4. **Conservation** : 13 mois et 3 ans par défaut (voir plus bas).

## Créer l'accès Google (une seule fois)

Pour que le bouton « Se connecter avec Google » fonctionne, l'application doit être déclarée chez Google. Ça se fait une seule fois, dans la [console Google Cloud](https://console.cloud.google.com/), avec **n'importe quel compte Google**. L'adresse qui enverra les mails n'a pas besoin d'être celle-là : c'est le compte choisi plus tard, dans l'application, en cliquant « Se connecter avec Google » (par exemple `shidokanfranceofficiel@gmail.com`).

Conseil : prenez un compte qui restera accessible à Shidokan France, celui de l'expéditeur par exemple. Si le projet Google est supprimé, ou si son code secret change, l'envoi s'arrête jusqu'à ce que `compose.yaml` soit mis à jour et le compte reconnecté.

Les libellés ci-dessous sont ceux de la console en anglais ; ils peuvent varier un peu.

1. **Créer un projet** : en haut de la console, sélecteur de projet → **New project**, nom « Shidokan France », puis **Create**.
2. **Activer l'API Gmail et l'API People** : menu **APIs & Services → Library**, cherchez « Gmail API », puis **Enable** ; recommencez avec « People API » (elle sert à lire les contacts pour synchroniser les coachs de l'annuaire).
3. **Écran de consentement** : menu **Google Auth platform → Branding** (cliquez **Get started** si la console le propose) :
   - **App name** : « Shidokan France » (c'est le nom affiché à la connexion) ; **User support email** : votre adresse (celle du compte de la console, proposée dans la liste) ; **Next** ;
   - **Audience** : **External** ; **Next** ;
   - **Contact information** : une adresse où Google peut vous écrire au sujet du projet ; **Next** ; acceptez la charte, puis **Create**.
4. **Autorisations** : **Google Auth platform → Data Access → Add or remove scopes**. Cochez `.../auth/gmail.send` (« Send email on your behalf »), `.../auth/contacts.readonly` (« See and download your contacts », lecture seule), `openid` et `.../auth/userinfo.email`, puis **Update** et **Save**. Ne prenez **pas** `https://mail.google.com/` : il donne l'accès complet à la boîte.
5. **Publier** : **Google Auth platform → Audience → Publish app**, puis confirmez. Le statut passe à **In production**. C'est nécessaire : en mode « Testing », Google retire l'accès au bout de 7 jours. Ne demandez pas la vérification par Google : elle n'est pas nécessaire pour un seul compte expéditeur. Le prix à payer est l'avertissement « application non validée » à la connexion.
6. **Identifiant client** : **Google Auth platform → Clients → Create client** :
   - **Application type** : **Web application** ; **Name** : « Shidokan France » ;
   - **Authorized redirect URIs → Add URI** : `https://competitions.shidokanfrance.com/api/app-settings/google/callback` (avec votre adresse si elle est différente) ;
   - **Create**. Notez le **Client ID** et le **Client secret** affichés.
7. **Sur le serveur**, dans `~/shidokan/compose.yaml`, décommentez et remplissez les deux lignes du service `app` :
   ```yaml
         - GOOGLE_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
         - GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
   ```
   (Si votre `compose.yaml` est plus ancien et ne les a pas, ajoutez-les sous `PUBLIC_URL`.) Puis :
   ```sh
   cd ~/shidokan && docker compose up -d
   ```
8. Dans l'application : **Réglages de l'application → Envoi des mails → Compte Google → « Se connecter avec Google »**, comme décrit plus haut.

**Projet Google déjà créé pour l'envoi des mails** (installation antérieure à la synchronisation des contacts) : il n'y a pas à tout refaire. Dans la console Google Cloud, sur le même projet :
1. **APIs & Services → Library** : cherchez « People API », puis **Enable** ;
2. **Google Auth platform → Data Access → Add or remove scopes** : cochez en plus `.../auth/contacts.readonly` (« See and download your contacts »), puis **Update** et **Save** ;
3. dans l'application, **Réglages de l'application → Envoi des mails → « Se reconnecter »** avec le même compte, en laissant cochée la case des **contacts**. Les Réglages affichent alors « Contacts : accès accordé ».

Sans l'étape 1, la synchronisation affiche « Lecture des contacts Google impossible (… People API has not been used … ) » ; sans les étapes 2 et 3, « Contacts : non accordé — reconnectez-vous ».

Le code secret reste dans `compose.yaml` : il n'est jamais écrit dans la base ni dans les sauvegardes. Le jeton remis par Google est gardé par l'application, mais retiré des sauvegardes. Après une installation neuve, il faut donc se reconnecter ; une restauration sur le même serveur garde la connexion.

## Ensuite

L'utilisation (préparer une compétition en ligne, relier le PC de la salle au serveur, le jour J, la variante « tout en ligne ») est dans le [guide de l'organisateur](guide-utilisateur.md).

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

- **Les sauvegardes ne contiennent pas les comptes.** Après une restauration sur un nouveau serveur, recréez-les avec `cli.js add-user`, et refaites les réglages d'envoi des mails (reconnectez le compte Google).
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
