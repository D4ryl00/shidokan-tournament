# Plusieurs adresses e-mail par club — conception

Date : 2026-10-27. Demande de l'utilisateur : « supporter plusieurs adresses e-mail par club, choisir d'envoyer le message à
certaines adresses ou à toutes pour un club donné ; à l'import Google, récupérer les différentes adresses si elles sont
disponibles ». L'utilisateur a demandé de démarrer sans questions : tous les choix ci-dessous sont ceux du constructeur.

## Données

- Une fiche de l'annuaire et un club de compétition portent une **liste d'adresses** (`coachEmails: string[]`) au lieu d'une
  seule (`coachEmail`). Colonne `coach_emails` (texte JSON, `'[]'` par défaut, jamais nulle) dans `club_directory` et `clubs`.
- Migration 0024 : l'ancienne adresse devient le premier élément de la liste, puis `coach_email` est supprimée.
- Règles d'une liste : au plus 10 adresses, chacune une seule adresse valide (même contrôle qu'avant, `isSingleEmail`) de
  160 caractères au plus ; espaces retirés ; doublons (casse ignorée) retirés ; l'ordre est gardé.
- Paquet de synchronisation venu d'une version d'avant 0024 : sa colonne `coach_email` est reprise dans `coach_emails`.
- Effacement RGPD : les listes sont vidées là où l'adresse était effacée.

## Saisie

- Partout où l'on saisissait « E-mail » (Annuaire, Clubs de la compétition, page d'inscription du club, fiche papier saisie à
  l'écran) : un champ texte « E-mails », adresses séparées par des virgules (ou points-virgules, espaces). Chaque frappe donne la
  liste au formulaire ; une adresse mal écrite est signalée en quittant le champ, et le serveur la refuse.
- Écarté après essai : un champ à étiquettes (Mantine `TagsInput`). L'adresse tapée sans valider n'y est reprise qu'en quittant
  le champ ; l'étiquette ajoutée agrandit le champ, le bouton « Enregistrer » se déplace sous la souris et le clic est perdu.
- Fiche club (.ods / PDF) renvoyée : la case E-mail peut contenir plusieurs adresses séparées par des virgules, points-virgules ou
  espaces.
- Remplissages automatiques inchangés : l'annuaire, un import FFK ou une fiche club ne remplissent la liste que si elle est vide ;
  la page d'inscription du club remplace la liste du club de compétition et, si elle n'est pas vide, celle de l'annuaire.

## Envoi

- Fenêtre « Envoyer le lien par mail » : pour chaque club coché qui a plusieurs adresses, une case par adresse, toutes cochées au
  départ. Décocher une adresse vaut pour cet envoi seulement (rien n'est retenu). Un club dont toutes les adresses sont décochées
  bloque le bouton « Envoyer ».
- Un seul mail par club, adressé à toutes les adresses choisies (un seul lien par club, comme avant). Le serveur n'envoie qu'à des
  adresses du club ; sans choix transmis, il envoie à toutes. Le journal des mails note les adresses séparées par « , ».
- « Ouvrir dans ma messagerie » : même choix des adresses dans sa fenêtre ; le lien `mailto:` porte les adresses choisies.
- Tableau des clubs invités : colonne « E-mails » (toutes les adresses) ; le filtre « Avec e-mail » garde les clubs qui en ont au
  moins une.

## Import Google Contacts

- Toutes les adresses d'un contact sont lues (la principale en premier). Un champ Google qui contient plusieurs adresses est
  découpé ; une partie invalide est signalée « valeur Google non reprise », comme avant.
- Rapprochement « même mail » : une adresse en commun suffit.
- Différence pour les e-mails : les adresses Google absentes de la fiche sont proposées en **ajout** (« E-mails : + b@y.fr ») ;
  rien n'est retiré de l'annuaire (une adresse donnée par le club ne disparaît pas parce qu'elle manque dans Google). Fiche sans
  adresse : remplie d'office, comme les autres champs vides. Au-delà de 10 adresses, les dernières sont laissées de côté.
- « Nouveau club » depuis un contact : toutes ses adresses valides.

## Hors périmètre

- Libellé par adresse (président, secrétaire…), adresses « par défaut » retenues pour les envois suivants.
- Écriture vers Google Contacts (toujours en lecture seule).
