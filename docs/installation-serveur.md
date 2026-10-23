# Installer l'application sur un serveur

Cette procédure met l'application en ligne pour que les clubs s'inscrivent eux-mêmes avec leur lien personnel. L'image est publiée sur Docker Hub (`d4ryl00/shidokan-tournament`), donc il n'y a rien à compiler sur le serveur.

## Avant de commencer : ce qui manque encore

L'étape C (comptes organisateurs, envoi des mails) n'est pas encore faite. En attendant :

- **L'application des organisateurs est protégée par un seul mot de passe**, demandé par le navigateur et posé par Caddy, le serveur web placé devant l'application. Seules les pages des clubs (`/inscription/…`) restent ouvertes sans mot de passe, et chacune ne s'ouvre qu'avec un lien personnel. **N'ouvrez jamais l'application sur internet sans ce mot de passe** : elle contient des données de mineurs et permet de tout modifier.
- **Les liens des clubs s'envoient à la main** : copiez chaque lien depuis l'onglet Fiche club (section « Inscriptions en ligne ») et envoyez-le depuis votre messagerie.
- **Le passage au PC pour le jour J se fait par une sauvegarde** (voir « Le jour J » plus bas). La synchronisation viendra à l'étape D.

## Ce qu'il faut

- Un serveur Linux joignable depuis internet, avec **Docker** et le plugin **Docker Compose**. Pour vérifier : `docker compose version`.
- Un **nom de domaine** ou un sous-domaine, par exemple `inscriptions.exemple.fr`, dont l'enregistrement DNS (A, ou AAAA en IPv6) pointe vers l'adresse IP du serveur.
- Les **ports 80 et 443** ouverts sur le serveur, au pare-feu de l'hébergeur compris. Caddy en a besoin pour obtenir et renouveler tout seul le certificat HTTPS (Let's Encrypt).

Si le serveur a déjà un serveur web sur les ports 80 et 443 (nginx, Traefik, Apache…), suivez plutôt la variante en fin de document.

L'image existe en `linux/amd64` et `linux/arm64`.

## Installation

1. Créer un dossier et y copier les deux fichiers du dépôt `deploy/compose.yaml` et `deploy/Caddyfile` :
   ```sh
   mkdir -p ~/shidokan && cd ~/shidokan
   curl -fsSLO https://raw.githubusercontent.com/D4ryl00/shidokan-tournament/main/deploy/compose.yaml
   curl -fsSLO https://raw.githubusercontent.com/D4ryl00/shidokan-tournament/main/deploy/Caddyfile
   ```
2. Choisir le mot de passe des organisateurs, puis calculer son empreinte. Seule l'empreinte va dans le fichier, pas le mot de passe :
   ```sh
   docker run --rm caddy:2 caddy hash-password --plaintext 'le-mot-de-passe-choisi'
   ```
   La commande affiche une ligne qui commence par `$2a$…`.
3. Ouvrir `Caddyfile` et remplacer :
   - `inscriptions.exemple.fr` par votre nom de domaine ;
   - `REMPLACER_PAR_L_EMPREINTE` par l'empreinte obtenue (la ligne `$2a$…` en entier).

   `organisateur` est l'identifiant qui sera demandé ; vous pouvez le changer.
4. Démarrer :
   ```sh
   docker compose up -d
   docker compose ps          # les deux services doivent être « running » ; app passe « healthy » après quelques secondes
   docker compose logs caddy  # en cas de souci de certificat HTTPS
   ```
5. Vérifier depuis un navigateur :
   - `https://votre-domaine/` demande l'identifiant et le mot de passe, puis affiche la liste des compétitions ;
   - `https://votre-domaine/inscription/nimportequoi` s'ouvre **sans** mot de passe et affiche « Lien inconnu ou expiré. ».

Les données sont dans `~/shidokan/data`. Les sauvegardes automatiques (toutes les 30 minutes quand quelque chose a changé, 200 gardées) sont dans `~/shidokan/data/sauvegardes`.

## Préparer une compétition en ligne

1. **Annuaire des clubs** (en haut à droite) : créez ou complétez les clubs, avec l'e-mail du coach et si possible le numéro d'affiliation FFK.
2. Créez la compétition, puis réglez sa grille et ses réglages comme d'habitude.
3. Onglet **Fiche club**, section « Inscriptions en ligne » :
   - indiquez la date limite, puis cliquez « Ouvrir les inscriptions » ;
   - choisissez les clubs dans « Clubs à inviter », puis cliquez « Inviter les clubs choisis » ;
   - **copiez chaque lien tout de suite**, car il ne sera plus affiché, et envoyez-le au coach par mail. Si un lien est perdu ou envoyé à la mauvaise personne, utilisez « Régénérer le lien » : l'ancien ne fonctionne plus.
4. Suivez les inscriptions dans l'onglet Inscriptions. Leur origine s'affiche « En ligne ».
5. À la date limite, cliquez « Figer les inscriptions » : les pages des clubs passent en lecture seule.

## Le jour J (avant l'étape D)

La compétition se déroule sur le PC de la salle, sans internet. Pour y passer les inscriptions du serveur :

1. Sur le serveur, après le gel : onglet **Podiums**, section **Sauvegardes**, cliquez « Télécharger la base complète ».
2. Sur le PC : même section, cliquez « Restaurer une sauvegarde… » et choisissez ce fichier. **Toute la base du PC est remplacée** (une copie de l'état précédent est faite juste avant). Travaillez donc sur le serveur jusque-là, et pas en parallèle sur le PC.
3. Après la compétition, si vous voulez l'archive en ligne, faites l'inverse : sauvegarde du PC, puis restauration sur le serveur.

## Mettre à jour l'application

```sh
cd ~/shidokan
docker compose pull app && docker compose up -d
```

La base est mise à niveau toute seule au démarrage. Une sauvegarde est faite au préalable si vous cliquez « Sauvegarder maintenant ».

Chaque image publiée porte aussi le numéro de version du code, par exemple `d4ryl00/shidokan-tournament:170f142`. Pour revenir à une version précise, remplacez `latest` par ce numéro dans `compose.yaml`.

## Sauvegarde hors du serveur

Les sauvegardes automatiques restent sur le serveur. Copiez-les régulièrement ailleurs, par exemple chaque nuit avec `rsync` ou `scp` depuis une autre machine :

```sh
rsync -a utilisateur@serveur:shidokan/data/sauvegardes/ ~/sauvegardes-shidokan/
```

**N'ouvrez jamais `data/shidokan.sqlite` avec un autre programme pendant que l'application tourne.** Pour une copie cohérente, utilisez les fichiers de `data/sauvegardes/` ou « Télécharger la base complète ».

## Variante : un serveur web existe déjà sur les ports 80 et 443

1. Dans `compose.yaml`, supprimez le service `caddy` et le bloc `volumes:` du bas. Ajoutez au service `app` :
   ```yaml
       ports:
         - "127.0.0.1:3000:3000"
   ```
2. Dans votre serveur web, faites suivre le domaine vers `http://127.0.0.1:3000`, avec deux règles :
   - **sans mot de passe** : `/inscription/`, `/api/inscription/`, `/assets/`, `/favicon.webp`, `/shidokan-france-logo.png`, `/shidokan-france-logo.webp`, `/api/health` ;
   - **avec mot de passe** (authentification HTTP Basic) : tout le reste.

   Exemple pour nginx (fichier de mots de passe créé avec `htpasswd -c /etc/nginx/shidokan.htpasswd organisateur`) :
   ```nginx
   location ~ ^/(inscription/|api/inscription/|assets/|favicon\.webp$|shidokan-france-logo\.(png|webp)$|api/health$) {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       access_log off;   # les adresses contiennent le lien personnel des clubs
   }
   location / {
       auth_basic "Shidokan — organisateurs";
       auth_basic_user_file /etc/nginx/shidokan.htpasswd;
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       client_max_body_size 20m;
   }
   ```
3. **Journaux d'accès** : les adresses `/inscription/…` contiennent le lien personnel des clubs. Ne les journalisez pas (voir `access_log off` ci-dessus), ou masquez-les. L'application les masque déjà dans son propre journal, et Caddy ne tient pas de journal d'accès par défaut.
