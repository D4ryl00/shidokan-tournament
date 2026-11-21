/**
 * Textes d'aide de l'app, regroupés ici pour être relus d'un coup.
 * `short` : une phrase visible sous le titre. `details` : l'aide complète du bouton ⓘ
 * (un texte = un paragraphe ; un tableau de textes = une liste à puces).
 */
export type HelpTopicId =
  | 'competitions'
  | 'annuaire'
  | 'annuaire.pc'
  | 'synchro-google'
  | 'comptes'
  | 'parametres'
  | 'parametres.pc'
  | 'impression'
  | 'inscriptions'
  | 'clubs'
  | 'clubs.recap'
  | 'fiche-club'
  | 'import-ffk'
  | 'sessions'
  | 'sessions.horaires'
  | 'finales'
  | 'vagues.en-attente'
  | 'pesee'
  | 'reaffectation'
  | 'tableaux'
  | 'combats'
  | 'podiums'
  | 'reglages'
  | 'categories'
  | 'journal'
  | 'fiche-club.en-ligne'
  | 'fiche-club.envoyer'
  | 'fiche-club.importer'
  | 'fiche-club.pdf-ffk'
  | 'fiche-club.saisir'
  | 'import-ffk.categories'
  | 'import-ffk.clubs'
  | 'import-ffk.cartes'
  | 'import-ffk.sans-ffk'
  | 'recasement.valides'
  | 'reaffectation.autorisations'
  | 'recasement.de-cote'
  | 'recasement.ignorees'
  | 'combats.categories'
  | 'combats.zone'
  | 'combats.resultat'
  | 'combats.kata'
  | 'podiums.clubs'
  | 'parametres.sauvegardes'
  | 'reglages.competition'
  | 'reglages.visibilite'
  | 'reglages.echanges'
  | 'synchronisation'
  | 'jour-j'
  | 'zones-autonomes'
  | 'reglages.zones'
  | 'reglages.ordre'
  | 'reglages.recasement'
  | 'reglages.pesee'
  | 'reglages.tableaux'
  | 'reglages.kata'
  | 'reglages.durees'
  | 'combats.horaires'
  | 'tableaux.durees'
  | 'grille.poids'
  | 'grille.tranches'
  | 'grille.ouvertes'
  | 'grille.libres'
  | 'grille.passages'
  | 'grille.modeles';

export interface HelpTopic {
  title: string;
  short: string;
  details: (string | string[])[];
}

export const HELP: Record<HelpTopicId, HelpTopic> = {
  competitions: {
    title: 'Compétitions',
    short: 'Créez une compétition ou ouvrez-en une pour la préparer et la faire vivre le jour J.',
    details: [
      'Chaque compétition a ses inscriptions, sa grille de catégories et ses réglages.',
      [
        '« Nouvelle compétition » : nom, date, lieu, nombre de zones de combat (renommables ensuite). Une grille enregistrée comme modèle peut servir de point de départ.',
        'Cliquez le nom d’une compétition pour l’ouvrir.',
        '« Supprimer » efface la compétition de cette installation seulement, après avoir retapé son nom ; une sauvegarde est faite juste avant. Une copie (gérée ailleurs) se supprime aussi ; sur le serveur, pas quand un PC a la main.',
      ],
      'Ordre habituel : réglages et grille, fiche club envoyée aux clubs, inscriptions, import FFK, pesée, réaffectation, tableaux, combats, podiums.',
    ],
  },
  'annuaire.pc': {
    title: 'Annuaire des clubs',
    short: 'Les clubs connus, d’une compétition à l’autre : leurs coordonnées sont reprises dans les fiches et les inscriptions.',
    details: [
      'L’annuaire ne dépend d’aucune compétition. Il se remplit tout seul avec les clubs des fiches, de l’import FFK et des saisies (création de fiches) ; vous pouvez aussi y créer des clubs à l’avance.',
      [
        'Le numéro d’affiliation FFK (les chiffres en tête du club dans l’export FFK) reconnaît un club à coup sûr, même si son nom est écrit autrement.',
        '« Modifier » change le nom, le numéro d’affiliation, le coach, les adresses e-mail ou les notes ; « Archiver » cache un club qui ne vient plus, sans rien effacer.',
        'Un club peut avoir plusieurs adresses e-mail (coach, président, secrétariat…) : tapez-les dans « E-mails », Entrée ou virgule entre deux. L’envoi des mails aux clubs se fait depuis le serveur en ligne.',
        '« Fusionner avec… » réunit deux fiches du même club : les compétitions de l’une passent à l’autre, la fiche gardée reçoit les adresses e-mail qu’elle n’avait pas, puis la première est supprimée.',
        'Un club de compétition est une copie de sa fiche, faite à l’invitation. Un changement fait dans l’onglet Clubs d’une compétition gérée ici n’écrit pas dans une fiche existante : le bandeau « Voir les changements » et le bouton « Comparer » vous laissent décider, sans page en ligne.',
        'Après « Modifier », si des clubs de compétitions à venir gérées ici diffèrent de la fiche, « Appliquer aux compétitions à venir ? » s’ouvre : « Garder le club » ou « Prendre l’annuaire » en cas de conflit, « Ne rien appliquer » pour laisser tel quel. Les compétitions passées ne sont pas proposées.',
      ],
    ],
  },
  annuaire: {
    title: 'Annuaire des clubs',
    short: 'Les clubs connus, d’une compétition à l’autre : invitez-les ensuite aux inscriptions en ligne d’une compétition.',
    details: [
      'L’annuaire ne dépend d’aucune compétition. Il se remplit tout seul avec les clubs des fiches, de l’import FFK et des saisies (création de fiches) ; vous pouvez aussi y créer des clubs à l’avance.',
      [
        'Le numéro d’affiliation FFK (les chiffres en tête du club dans l’export FFK) reconnaît un club à coup sûr, même si son nom est écrit autrement.',
        '« Modifier » change le nom, le numéro d’affiliation, le coach, les adresses e-mail ou les notes ; « Archiver » cache un club qui ne vient plus, sans rien effacer.',
        'Un club peut avoir plusieurs adresses e-mail (coach, président, secrétariat…) : tapez-les dans « E-mails », Entrée ou virgule entre deux. À l’envoi des liens, vous choisissez lesquelles reçoivent le mail.',
        '« Fusionner avec… » réunit deux fiches du même club : les compétitions de l’une passent à l’autre, la fiche gardée reçoit les adresses e-mail qu’elle n’avait pas, puis la première est supprimée.',
        '« Synchroniser avec Google » (sur le serveur en ligne, avec un compte Google connecté) compare les coachs de l’annuaire aux contacts Google ; un club lié porte la marque « Google ». « Ne plus synchroniser avec Google » retire ce lien sans rien effacer. La synchronisation Google et les imports ne créent aucun changement à examiner ; après la synchronisation, « Appliquer aux compétitions à venir ? » s’ouvre pour chaque fiche modifiée dont des clubs de compétitions à venir diffèrent.',
        'Un club de compétition est une copie de sa fiche, faite à l’invitation. Ce qu’un coach saisit sur sa page, ou ce que vous changez dans l’onglet Clubs, n’écrit pas dans une fiche existante (un club sans fiche en reçoit une, avec ses valeurs) : si le club diffère de sa fiche, un bandeau « N clubs diffèrent de l’annuaire » s’affiche ici, avec « Voir les changements », et chaque fiche concernée porte l’origine (modifié par le club ou dans la compétition) et « Comparer ». Une fiche archivée n’affiche ni bandeau ni pastille.',
        'La fenêtre de comparaison montre, champ par champ, l’annuaire et la compétition ; vous choisissez ce que l’annuaire garde. Pour les adresses e-mail, une case par adresse. Un champ effacé par le club est proposé comme les autres, mais la valeur de l’annuaire reste choisie par défaut ; si toutes les adresses ont été effacées, celles de la fiche restent cochées. Il faut un clic (ou décocher les adresses) pour vider la fiche. Seules les valeurs modifiées par les enregistrements du club depuis la dernière décision sont proposées par défaut ; une adresse seulement dans la compétition reste décochée. « Enregistrer dans l’annuaire » applique, « Ignorer ce changement » le ferme (il ne revient que si le club modifie de nouveau une valeur), « Plus tard » ferme la fenêtre et garde le changement. La case « Appliquer aussi au club dans <compétition> » reporte le résultat dans la compétition ; elle est désactivée si la compétition est gérée par un PC, et absente si elle est passée.',
        'Après « Modifier » une fiche, si des clubs de compétitions à venir y sont reliés et diffèrent, « Appliquer aux compétitions à venir ? » s’ouvre. Sans conflit, la ligne est cochée ; en cas de conflit, « Garder le club » est choisi par défaut, ou « Prendre l’annuaire ». Une compétition gérée par un PC ne peut pas être modifiée, et les compétitions passées ne sont pas proposées. « Ne rien appliquer » laisse tout tel quel : la fiche, elle, est déjà enregistrée.',
        '« Appliquer aux compétitions à venir… » (menu « … » d’une fiche) propose de nouveau les clubs de compétitions à venir qui diffèrent de la fiche, par exemple après une fenêtre fermée sans rien appliquer. Les valeurs d’avant n’étant plus connues, chaque ligne est un conflit : choisissez « Prendre l’annuaire » pour y reporter la fiche.',
      ],
    ],
  },
  'synchro-google': {
    title: 'Synchroniser les coachs avec Google',
    short: 'Les coordonnées des coachs viennent des contacts Google : rien ne change dans l’annuaire avant « Appliquer ».',
    details: [
      'Choisissez un libellé de vos contacts Google (par exemple « Coachs »), ou « Tous les contacts ». Le dernier libellé choisi est repris la fois suivante.',
      [
        'Différences avec l’annuaire : pour chaque club lié à un contact, le coach, le téléphone, les adresses e-mail et le numéro d’affiliation qui diffèrent. Google l’emporte : chaque ligne est cochée.',
        'Le numéro d’affiliation FFK se met dans le contact Google en champ personnalisé : « Modifier », « Plus », « Ajouter un champ personnalisé », valeur 0060808 (7 chiffres), libellé « Num affiliation FFK ». Un numéro que porte déjà un autre club de l’annuaire n’est jamais repris : il est signalé.',
        'Toutes les adresses e-mail d’un contact sont lues. Celles qui manquent dans l’annuaire sont proposées en ajout (« + adresse ») : une adresse de l’annuaire absente de Google n’est jamais retirée.',
        'Décochez une ligne pour garder la valeur de l’annuaire. Cela ne vaut que cette fois : la même différence revient à la synchronisation suivante, tant que Google et l’annuaire ne concordent pas.',
        'Un champ vide dans Google n’efface jamais l’annuaire ; deux numéros écrits autrement (espaces, +33) ne sont pas une différence ; une adresse que l’annuaire refuserait est signalée « valeur Google non reprise ».',
      ],
      [
        'Nouveaux contacts : « Lier à un club » choisit le club de l’annuaire de ce coach. Le club au même numéro d’affiliation, sinon celui qui a une adresse e-mail en commun, sinon le même téléphone, est déjà choisi ; un nom qui ressemble est seulement proposé (« Peut-être : … ? »).',
        '« Nouveau club » crée une fiche avec le nom saisi et les coordonnées du contact. « + Lier aussi à un autre club » sert au coach qui tient deux clubs.',
        '« Plus tard » : à l’application, le contact est rangé dans « En attente d’un rattachement », repliée, où les mêmes choix restent possibles.',
        '« Contacts déjà liés » permet de lier un contact à un club de plus. Pour retirer un lien : « Ne plus synchroniser avec Google » dans l’annuaire.',
      ],
      'Après « Appliquer », pour chaque fiche modifiée dont des clubs de compétitions à venir diffèrent, « Appliquer aux compétitions à venir ? » s’ouvre, comme après « Modifier » dans l’annuaire : rien n’est changé dans les compétitions sans votre choix.',
      'Se reconnecter avec un autre compte Google (Réglages de l’application) efface les liens et la liste en attente : ils ne valent que pour le compte avec lequel ils ont été faits.',
    ],
  },
  comptes: {
    title: 'Comptes',
    short: 'Les personnes qui peuvent se connecter à l’application en ligne, et ce que chacune peut faire.',
    details: [
      'Sur le serveur en ligne, chacun se connecte avec son e-mail et son mot de passe. Le PC de la compétition, lui, ne demande pas de connexion.',
      [
        'Organisateur : tout.',
        'Table centrale : inscriptions, clubs, pesée, réaffectations, tableaux, tableaux libres, sessions à lancer et résultats de toutes les zones ; pas les réglages, la grille (sauf les tableaux libres, dans l’onglet Catégories), les imports ni les invitations.',
        'Zone : résultats, notes de kata et départages des combats de sa zone seulement. Un compte Zone est attaché à une zone d’une compétition : pour la compétition suivante, changez son rôle (« Changer le rôle ») ou créez-en un autre.',
      ],
      [
        '« Ajouter un compte » : e-mail, mot de passe de 10 caractères au moins (à transmettre à la personne, elle pourra le changer) et rôle.',
        '« Changer le rôle » vaut tout de suite, sans que la personne ait à se reconnecter. On ne change pas le rôle de son propre compte.',
        '« Changer mon mot de passe » : il faut le mot de passe actuel.',
        'Le premier compte d’un serveur se crée sur le serveur lui-même : docker compose exec -it app node dist/server/cli.js add-user <e-mail>.',
        'Les comptes ne sont jamais copiés dans les sauvegardes : après une restauration sur un nouveau serveur, recréez-les avec la même commande.',
      ],
    ],
  },
  'parametres.pc': {
    title: 'Réglages de l’application',
    short: 'Ce qui vaut pour toutes les compétitions : mention sur les données personnelles, conservation, règles de réaffectation.',
    details: [
      'Les mails aux clubs et les inscriptions en ligne se règlent et s’envoient depuis le serveur en ligne, pas depuis ce PC.',
      'Données personnelles : la mention affichée en bas de la page de chaque club, et l’adresse à laquelle écrire pour exercer ses droits (à compléter avant d’ouvrir les inscriptions).',
      'Conservation : après ce nombre de mois, le poids, la licence, le grade, les coordonnées des coachs, les liens et les mails d’une compétition sont effacés tout seuls ; le palmarès reste. Un club de l’annuaire sans compétition depuis ce nombre d’années est archivé et ses coordonnées effacées.',
    ],
  },
  parametres: {
    title: 'Réglages de l’application',
    short: 'Ce qui vaut pour toutes les compétitions : envoi des mails, message aux clubs, mention sur les données personnelles, conservation.',
    details: [
      'Envoi des mails : le compte qui enverra les liens aux clubs. « Envoyer un mail d’essai » vérifie les réglages.',
      [
        'Compte Google (sur le serveur en ligne) : « Se connecter avec Google », choisissez le compte, puis acceptez. Google affiche une fois « application non validée » : cliquez sur Paramètres avancés, puis Accéder.',
        'L’application peut envoyer des mails depuis ce compte, sans les lire, et lire ses contacts, sans les modifier (synchronisation des coachs de l’annuaire) ; « Déconnecter » lui retire l’accès. Si l’accès est retiré ou expire, l’écran demande de se reconnecter. Environ 500 destinataires par jour.',
        'Sous le compte connecté, « Contacts : accès accordé » ou « non accordé » : dans ce cas, reconnectez-vous et laissez la case des contacts cochée chez Google. Se reconnecter avec un autre compte efface les liens entre l’annuaire et les contacts.',
        'Autre serveur : le serveur d’envoi (SMTP), l’identifiant et le mot de passe. Pour Gmail sans « Se connecter avec Google » : un mot de passe d’application (Compte Google → Sécurité → Mots de passe des applications), serveur smtp.gmail.com, port 465, TLS.',
        'Le mot de passe enregistré n’est jamais réaffiché ; laissez le champ vide pour le garder.',
      ],
      [
        'Message aux clubs : le modèle de mail, avec les variables {club}, {coach}, {competition}, {date}, {lieu}, {date_limite} et {lien} ; chaque compétition peut avoir le sien.',
        'L’éditeur a une barre de mise en forme : gras, italique, souligné, couleur, surlignage, titres, listes, citation, alignement, lien. Pas de choix de police ni de taille de texte, pas de tableau.',
        'Lien : www.club.fr devient https://www.club.fr et contact@club.fr une adresse e-mail ; les autres adresses sont refusées avec un message. {lien} met le lien personnel du club derrière un mot.',
        'Images : bouton image de la barre, collage ou glisser-déposer. Trois tailles d’affichage (« Petite », « Moyenne », « Pleine largeur » : 200, 400 ou 600 px) ; 10 images au plus par message, JPEG, PNG, WebP ou GIF. Chaque image est réduite à 1200 px de large et 2 Mo au plus, et une photo JPEG perd ses informations cachées (appareil, position GPS) ; un GIF n’est jamais réduit et est refusé au-delà de 2 Mo.',
        'Une compétition importée sur une autre installation arrive sans les images de son message : tout envoi est refusé tant qu’elles manquent. Remettez-les dans l’éditeur et enregistrez.',
        'Le bouton « Code source (HTML) » permet de coller un message tout fait. Ce que le mail ne peut pas porter (scripts, images prises sur internet…) est retiré : un avis le dit en quittant le mode code, et l’enregistrement est indisponible tant que le mode code est ouvert. À l’enregistrement, « Retiré du message : … » dit aussi ce que le filtre a enlevé.',
        'Le message part mis en forme quand l’application l’envoie, avec une version sans mise en forme pour les messageries qui n’en veulent pas. « Ouvrir dans ma messagerie » ne transmet que le texte, sans mise en forme ni images.',
        'Un mail pèse 18 Mo au plus, images, fiches et pièces jointes comprises : au-delà, ou si une image manque, rien n’est envoyé et aucun lien n’est créé.',
        'Les mails se règlent et s’envoient depuis le serveur en ligne, quand la compétition y est modifiable (la main est sur le serveur). Depuis un PC, cette partie n’est pas proposée.',
      ],
      'Données personnelles : la mention affichée en bas de la page de chaque club, et l’adresse à laquelle écrire pour exercer ses droits (à compléter avant d’ouvrir les inscriptions).',
      'Conservation : après ce nombre de mois, le poids, la licence, le grade, les coordonnées des coachs, les liens et les mails d’une compétition sont effacés tout seuls ; le palmarès reste. Un club de l’annuaire sans compétition depuis ce nombre d’années est archivé et ses coordonnées effacées.',
    ],
  },
  synchronisation: {
    title: 'Synchronisation',
    short: 'Relier le PC de la compétition au serveur en ligne, pour s’échanger les compétitions.',
    details: [
      'Sur le serveur en ligne : « Créer un jeton » donne un jeton de synchronisation, affiché une seule fois. Il ne sert qu’aux échanges de compétitions, et se révoque à tout moment.',
      'Sur le PC : collez l’adresse du serveur (par exemple https://competitions.shidokanfrance.com) et ce jeton, puis enregistrez.',
      'Le jeton n’est jamais réaffiché ni copié dans les sauvegardes.',
    ],
  },
  'reglages.echanges': {
    title: 'Échanges avec le serveur',
    short: 'Où est la main sur cette compétition, et comment la faire passer entre le serveur en ligne et le PC.',
    details: [
      'Une compétition n’est modifiable qu’à un seul endroit à la fois : là où est la main. Ailleurs, elle est en lecture seule.',
      [
        '« Récupérer une copie » : le PC télécharge la compétition, en lecture seule (pour préparer ou vérifier).',
        '« Prendre la main » : la veille ou le matin de la compétition, après le gel des inscriptions. Le PC devient le seul endroit où la modifier ; en ligne, elle passe en lecture seule.',
        '« Envoyer une copie au serveur » : pendant la journée, s’il y a internet, une copie de secours part en ligne (le PC garde la main).',
        '« Rendre la main au serveur » : après la compétition. Le serveur reprend la compétition entière, avec ses résultats ; le PC garde une copie en lecture seule.',
        'Sans internet : « Exporter la compétition (fichier) » sur une clé USB, puis « Importer une compétition (fichier) » de l’autre côté.',
        'Sur le serveur, « Reprendre la main » sert si le PC est perdu ou en panne : à partir de la version du serveur, ou de la dernière copie reçue.',
      ],
      [
        'Jour J en ligne : le PC de la salle garde une copie en lecture seule (« Garder cette copie à jour », toutes les quelques minutes).',
        'Internet coupé : « Prendre la main en secours » rend cette copie modifiable tout de suite, sans le serveur ; les postes passent sur le réseau de la salle.',
        'Internet revenu : « Prévenir le serveur ». Si rien n’a changé en ligne depuis la copie, la main passe simplement au PC. Sinon, le serveur refuse, et « Remplacer la version en ligne » met la version du PC en ligne (celle du serveur reste dans une sauvegarde). Ensuite, « Rendre la main au serveur » comme d’habitude.',
      ],
    ],
  },
  'jour-j': {
    title: 'Préparer le jour J (plusieurs postes)',
    short: 'Un PC principal fait tourner l’application ; les autres postes (zones, table centrale) l’ouvrent dans leur navigateur, sur le Wi-Fi de la salle.',
    details: [
      'Chaque poste choisit son rôle dans la barre du haut d’une compétition (liste du poste, à droite) : Organisation (tout), Table centrale (inscriptions, pesée, réaffectation, combats, podiums) ou une zone (seulement les combats de sa zone). Le choix est gardé par le navigateur.',
      'Les écrans se mettent à jour tout seuls ; une saisie faite sur une donnée modifiée entre-temps par un autre poste est refusée avec le message « Modifié entre-temps par un autre poste ».',
      'Un second PC peut garder une copie de secours du PC principal (Réglages de l’application → Copie de secours) : en cas de panne, restaurez la dernière copie sur ce PC et ouvrez son adresse sur les autres postes.',
      'Si chaque zone a son PC portable avec l’application installée, reliez-le au PC principal (Réglages de l’application → Portable de zone) : si le réseau tombe, la zone continue sur son portable (voir « Portable de zone et coupure du réseau »).',
    ],
  },
  'zones-autonomes': {
    title: 'Portable de zone et coupure du réseau',
    short: 'Le portable d’une zone garde une copie à jour du PC principal ; si le réseau tombe, la zone continue dessus, puis renvoie ses saisies.',
    details: [
      'Avant : sur le portable de la zone, indiquez l’adresse du PC principal (par exemple http://192.168.1.10:3000), cliquez « Chercher », choisissez la compétition et la zone, puis enregistrez. La copie se met à jour quelques secondes après chaque changement ; l’arbitre continue à utiliser le PC principal dans son navigateur.',
      [
        'Le réseau tombe : sur le portable, ouvrez l’application locale (http://localhost:3000), la compétition, puis « Continuer sans réseau (zone …) ». Seuls les résultats, notes de kata et départages de cette zone sont possibles, dans les sessions déjà lancées ; chaque saisie est notée pour être renvoyée.',
        'Finales : par défaut, elles attendent les résultats des autres zones. « Jouer ici les finales de mes catégories » les joue sur le portable ; si la zone des finales les joue aussi, la table centrale tranchera.',
        '« Recevoir une copie plus récente » (par le réseau s’il revient un moment, ou avec un fichier de compétition) : la copie est remplacée et les saisies de la zone y sont réappliquées ; elles restent à renvoyer.',
      ],
      [
        'Le réseau revient : « Repasser en ligne » envoie les saisies au PC principal, puis rouvrez l’adresse du PC principal dans le navigateur. Si l’envoi échoue, rien n’est perdu : la zone reste autonome.',
        'Sans réseau : « Exporter le journal (fichier) » sur le portable, puis « Importer un journal de zone (fichier) » sur le PC principal (onglet Combats). Une saisie déjà reçue n’est jamais appliquée deux fois.',
      ],
      'Sur le PC principal, une saisie de zone qui contredit le PC (autre résultat saisi à la table centrale, combattants changés) devient une carte « À trancher » dans l’onglet Combats : « Garder celui de la zone » ou « Garder celui du PC ». Les combats de la catégorie attendent la décision.',
    ],
  },
  impression: {
    title: 'Impression',
    short: 'Cliquez « Imprimer » : seules les feuilles sortent, sans les boutons ni les aides.',
    details: [
      'Ces pages sont faites pour l’impression (A4). Dans la fenêtre d’impression du navigateur, choisissez l’imprimante ou « Enregistrer au format PDF ».',
      'Les feuilles sortent toujours en noir sur blanc, même si l’app est en thème sombre.',
    ],
  },
  inscriptions: {
    title: 'Inscriptions',
    short: 'La liste de tous les combattants inscrits ; ajoutez un combattant sur place ou corrigez-en un.',
    details: [
      'Une ligne = un combattant dans une discipline. Un même combattant peut avoir plusieurs lignes (kata et combat, par exemple).',
      [
        'Recherche : tapez une partie du nom ou du club.',
        '« Sans inscription FFK » : inscriptions pas encore confirmées par l’export FFK (fiche club, saisie, inscription sur place).',
        '« Tableau » ouvre la vue Liste des Tableaux sur la catégorie du combattant (grisé tant qu’il n’a pas de catégorie).',
        'Le crayon ouvre la fenêtre du combattant, avec toutes ses inscriptions ; la corbeille supprime une inscription (impossible si sa catégorie a déjà commencé).',
        '« Ajouter » se fait en deux étapes : le club (de la compétition ou de l’annuaire, ou « Ajouter un club »), puis la même fenêtre que celle du coach sur sa page. Les inscriptions saisies ici portent la mention « sur place ». « Enregistrer et ajouter un autre » (ou la touche Entrée) confirme par une notification et rouvre une fenêtre vide pour le même club ; en modification, Entrée enregistre.',
        'Dans cette fenêtre, vous pouvez choisir une catégorie non ouverte (elle est marquée « non ouverte ») : l’inscription est enregistrée avec un avertissement. De même pour plusieurs combats quand le réglage de la compétition n’en prévoit qu’un.',
        '« Changer de club », dans la fenêtre d’un combattant, le passe dans un autre club ; un combattant sans club commence par l’étape club. Pour un combattant dont un combat a commencé, ce qui a commencé ne se change plus ici (sa catégorie se change dans Réaffectation ou Tableaux) ; le nom, le prénom, le grade, l’affichage du nom et les autres disciplines (en ajouter, en retirer une qui n’a pas commencé) se corrigent encore.',
        'N° de licence : facultatif ; il permet de reconnaître le combattant à coup sûr à l’import de l’export FFK.',
        '« Masquer le nom sur la page publique » remplace le nom du combattant par « Combattant masqué » pour le public (son club reste affiché). Le réglage vaut pour toutes ses lignes ; un badge « nom masqué en ligne » le rappelle dans la liste.',
      ],
      'La colonne « Origine » indique d’où vient la ligne : fiche club, export FFK ou saisie.',
    ],
  },
  'clubs.recap': {
    title: 'Récapitulatif par mail',
    short: 'Envoyez à chaque club le récapitulatif PDF de ses inscriptions, avec un message que vous pouvez modifier.',
    details: [
      'Disponible sur le serveur en ligne seulement, pour les clubs qui ont au moins une inscription et une adresse e-mail.',
      [
        'L’enveloppe d’une ligne envoie le récapitulatif à ce club, après une confirmation qui montre les adresses et l’objet. Grisée, elle dit pourquoi (aucune inscription, pas d’e-mail).',
        '« Envoyer les récapitulatifs à tous les clubs » envoie à tous ceux qui peuvent le recevoir ; la confirmation liste les clubs sautés et pourquoi. L’envoi continue sur le serveur si vous quittez la page.',
        '« Message du récapitulatif » règle l’objet et le texte, avec un aperçu pour un club. « Revenir au texte de départ » rend le texte d’origine.',
        'Le récapitulatif PDF du club est joint automatiquement, tel qu’il est au moment de l’envoi.',
        'On peut renvoyer autant de fois qu’il faut : après une correction d’inscription, un nouvel envoi joint le récapitulatif à jour.',
      ],
    ],
  },
  clubs: {
    title: 'Clubs',
    short: 'Les clubs, leur coach et leur pré-accord pour les réaffectations.',
    details: [
      'Les clubs sont créés par l’import des fiches club, par l’import FFK ou par la saisie des inscriptions.',
      'Récapitulatif : pour chaque combattant du club, ce qui était inscrit et ce qu’il fait au final (catégorie, désisté, ne combat pas). Le fichier dit son heure : refaites-le après un changement.',
      [
        'Coach : nom, téléphone et adresses e-mail (une ou plusieurs), pour le joindre le jour J.',
        'Le club est une copie de sa fiche d’annuaire, faite à l’invitation. Vos changements ici n’écrivent pas dans l’annuaire : s’ils diffèrent de la fiche, une notification propose « Comparer » juste après « Modifier ». La pastille sur la ligne du club rappelle seulement l’origine du changement, et le bandeau en tête de la fiche club propose « Comparer ». Sur un PC, cela vaut pour les compétitions gérées ici.',
        'Pré-accord : le coach accepte d’avance qu’on réaffecte ses combattants. Les déplacements d’âge et de poids portent alors la mention « pré-accord coach » (une indication : ils se valident toujours à la main).',
      ],
    ],
  },
  'fiche-club': {
    title: 'Fiche club',
    short: 'Envoyez la fiche aux clubs (tableur ou papier), puis importez ou saisissez chaque fiche qu’ils vous renvoient.',
    details: [
      'La fiche club apporte ce que l’export FFK n’a pas : le poids actuel, les autres disciplines acceptées si le combattant se retrouve seul (triathlon compris, jamais le kata), ce qu’on propose d’abord en shobu, le grade pour le kata et le coach.',
      'Elle part plusieurs semaines avant la compétition ; l’export FFK n’arrive qu’à la clôture des inscriptions.',
    ],
  },
  'fiche-club.en-ligne': {
    title: 'Inscriptions en ligne',
    short: 'Chaque club invité reçoit un lien personnel pour inscrire et corriger lui-même ses combattants, jusqu’au gel.',
    details: [
      'Le coach ouvre son lien sur ordinateur ou sur téléphone. Il voit tous les combattants de son club dans cette compétition, quelle que soit leur origine (fiche, export FFK, saisie), et peut en ajouter, en modifier ou en retirer.',
      [
        'Choisissez des clubs de l’annuaire dans « Clubs à inviter » puis « Inviter les clubs choisis » : ils rejoignent le tableau, sans lien. Le lien se crée à l’envoi par mail ou par la messagerie, ou par « Créer un lien » dans la colonne « Accès ». Dans ce dernier cas, copiez-le tout de suite : pour des raisons de sécurité, un lien ne s’affiche qu’une seule fois.',
        'Chaque envoi (mail ou messagerie) ajoute un nouveau lien au club : les liens déjà envoyés restent valables, un coach peut rouvrir un ancien mail. La pastille de la colonne « Accès » ouvre les liens du club : quand chacun a été créé, envoyé et visité. « Créer un lien » en donne un de plus (affiché une seule fois) ; « Supprimer » désactive un lien (lien perdu, mauvais destinataire) ; « Supprimer tous les accès » les désactive tous et le club redevient « à inviter ».',
        '« Ouvrir les inscriptions » rend les pages des clubs modifiables ; la date limite est seulement affichée aux clubs.',
        'Ce que le coach saisit en tête de sa page (coach, téléphone, adresses, numéro d’affiliation) reste dans la compétition et n’écrit pas dans une fiche existante. S’il diffère de la fiche, un bandeau en tête de la fiche club dit « <Club> a été modifié … : il diffère de l’annuaire » avec « Comparer » (au-delà de 3 clubs, un seul bandeau et « Voir les changements »). Le coach n’est jamais bloqué par un changement en attente. « Ignorer ce changement » vaut jusqu’à une autre modification.',
        'Les mails et les inscriptions en ligne se gèrent sur le serveur en ligne, jamais depuis un PC. Pour envoyer, la main doit être sur le serveur : si un PC l’a, rendez-la d’abord (le bouton d’envoi est alors indisponible).',
        '« Envoyer le lien par mail » : un seul mail par club. Pour un club qui a plusieurs adresses, chacune a sa case et seule la première est cochée : cochez les autres si elles doivent aussi recevoir ce mail (cela ne vaut que pour cet envoi). « Ouvrir dans ma messagerie » propose le même choix, mais ne transmet que le texte : ni mise en forme ni images.',
        '« Figer les inscriptions » met toutes les pages des clubs en lecture seule ; les changements suivants se font par l’organisation. On peut rouvrir.',
        'Pièces jointes : par défaut, les mails envoyés par l’application portent la fiche à imprimer (PDF) et le tableur (.ods), pour qu’un club puisse inscrire ses élèves par l’un ou l’autre. Dans « Message aux clubs de cette compétition », décochez une fiche pour ne plus la joindre, ou ajoutez vos fichiers (affiche, règlement… : 10 fichiers, 10 Mo chacun, 15 Mo en tout). Les cases cochées valent pour tous les clubs et tous les envois suivants.',
        'Le texte du message ne s’adapte pas tout seul aux pièces jointes : s’il les cite, corrigez-le quand vous en changez.',
        '« Ouvrir dans ma messagerie » ne peut pas joindre de fichier : les pièces cochées sont proposées au téléchargement, joignez-les vous-même.',
        'Les fichiers ajoutés restent sur cette installation : ils ne sont pas dans les sauvegardes et ne suivent pas la compétition quand une autre installation prend la main. Après une restauration, ajoutez de nouveau ceux qui manquent.',
      ],
    ],
  },
  'fiche-club.envoyer': {
    title: '1. Envoyer le modèle aux clubs',
    short: 'Envoyez aux clubs le modèle à remplir sur ordinateur (.ods) ou la fiche papier à cocher (PDF).',
    details: [
      'Le modèle .ods s’ouvre avec LibreOffice ou Excel ; il contient des listes déroulantes (sexe, catégorie d’âge, discipline de combat, kata, règlement, reclassement, priorité shobu).',
      '« Télécharger la fiche papier (PDF) » donne une fiche A4 paysage à cocher, 10 combattants par feuille, à envoyer aux clubs ou à imprimer telle quelle (une page, sans réglage).',
      'Une ligne par combattant : kata et combat sur la même ligne. Le coach donne le poids actuel ; la catégorie de poids en est déduite.',
      'Seules les tranches d’âge qui ont au moins une catégorie ouverte sont proposées. Les fichiers n’indiquent pas les fermetures partielles (par exemple pas de kata chez les seniors F) : à l’import, ces lignes sont signalées à l’enregistrement (catégorie « non ouverte ») et vont en Réaffectation. La page en ligne, elle, ne propose que ce qui est ouvert et en donne le détail dans un champ repliable.',
    ],
  },
  'fiche-club.importer': {
    title: '2. Importer une fiche renvoyée',
    short: 'Choisissez le club, puis le fichier qu’il vous a renvoyé : ses coordonnées et ses fiches se vérifient une à une.',
    details: [
      [
        'Le club n’est jamais reconnu d’après le nom écrit dans le fichier : choisissez-le (ses clubs, puis l’annuaire) ou « Ajouter un club », pré-rempli d’après la fiche si elle est déjà choisie. Le club d’une fiche de l’annuaire n’entre dans la compétition qu’à « Commencer ».',
        'Choisissez ensuite le fichier (.ods, .xlsx, .xls ou .csv) : sa lecture n’écrit rien. Si le fichier est refusé, le message dit pourquoi (fiche modifiée, nom du club manquant…). Deux lignes pour le même combattant sont réunies en une seule fiche, et signalées.',
      ],
      [
        'Si la fiche donne d’autres coordonnées que le club (coach, téléphone, e-mails, pré-accord du coach), une première étape les montre, la valeur de la fiche renvoyée choisie d’office. « Enregistrer · suivant » écrit ce que vous gardez dans le club et dans l’annuaire ; « Laisser tel quel » n’écrit rien.',
        'Une case vide de la fiche ne change rien. Aucune adresse n’est retirée : les nouvelles s’ajoutent si leur case reste cochée. Le pré-accord ne vaut que pour cette compétition.',
      ],
      [
        'Le parcours montre ensuite une fiche à la fois : un combattant de la fiche renvoyée, nouveau ou face à sa fiche déjà enregistrée. Pour chaque fiche, vous l’enregistrez, la laissez telle quelle ou ne l’ajoutez pas.',
        'Sous chaque différence, la valeur de la fiche renvoyée est choisie d’office et l’enregistrée reste à un clic. Tous les conflits sont montrés, y compris une discipline enregistrée qui manque dans la fiche (décochée d’office) et les valeurs confirmées par l’export FFK (case « Enregistré · confirmé FFK »).',
        'Ce que la fiche n’a pas pu lire reste vide, avec la remarque de la ligne en tête de la fenêtre.',
      ],
      'Chaque fiche est enregistrée au fur et à mesure : si vous vous arrêtez au milieu, ce qui est fait reste fait. Réimporter la même fiche reprend là où vous en étiez, les fiches déjà à jour comptent comme faites.',
      'À la fin, les combattants du club qui ne sont pas dans la fiche sont listés, cases décochées : cochez seulement ceux qui ne viendront pas, leur fiche est supprimée (toutes disciplines).',
      'Les fiches remplies avec l’ancien format (une ligne par inscription, catégorie de poids) sont refusées : demandez au club de remplir le nouveau modèle.',
    ],
  },
  'fiche-club.pdf-ffk': {
    title: '3. Importer un PDF de la FFK',
    short: 'Choisissez le club et la discipline, puis lisez le PDF « État des inscriptions » de la FFK : les fiches se vérifient une à une.',
    details: [
      [
        'Ce PDF vient de la FFK : il donne les combattants d’une discipline pour un club. Le club le récupère sur ffkcompetition.fr : la compétition, onglet « Récap », puis « Etat des inscriptions ». Ni le club ni la discipline ne sont lus dans le fichier : vous les choisissez avant de commencer.',
        'Choisissez le club (ses clubs, puis l’annuaire) et la discipline du PDF, puis le fichier. Le club d’une fiche de l’annuaire n’entre dans la compétition qu’à « Commencer ».',
      ],
      'Le parcours montre une fiche à la fois : le combattant du PDF face à sa fiche déjà enregistrée, avec les différences. Pour chaque fiche, vous l’enregistrez, la laissez telle quelle ou ne l’ajoutez pas.',
      'Chaque fiche est enregistrée au fur et à mesure : si vous vous arrêtez au milieu, ce qui est fait reste fait. Réimporter le même PDF reprend là où vous en étiez, les fiches déjà à jour comptent comme faites.',
      'À la fin, les combattants du club qui ne sont pas dans le PDF sont listés, cases décochées : cochez ceux qu’il faut retirer de cette discipline. Les autres disciplines de ces combattants ne changent pas.',
    ],
  },
  'fiche-club.saisir': {
    title: '4. Saisir une fiche papier',
    short: 'Recopiez une fiche papier ligne par ligne (page par page), cliquez « Vérifier », puis « Enregistrer la fiche ».',
    details: [
      [
        'Choisissez d’abord le club dans la liste (ses clubs, puis l’annuaire) ou « Ajouter un club ». Ses coordonnées se modifient dans l’annuaire : la saisie n’y touche pas. Le pré-accord du coach est repris du club (décoché pour un club de l’annuaire) et reste modifiable.',
        'Le tableau suit la fiche papier, dans le même ordre : une ligne par combattant.',
        'Cliquez les cases cochées sur la fiche ; un second clic décoche. Si la compétition autorise plusieurs combats par combattant, plusieurs disciplines de combat se cochent, avec un seul règlement.',
        'N° de licence : facultatif ; il permet de reconnaître le combattant à coup sûr à l’import de l’export FFK.',
        'Kata et combat sur une même ligne donnent deux inscriptions. La catégorie de poids est déduite du poids actuel.',
        '« Ajouter une ligne » pour les fiches de plus de 5 combattants.',
        'Rien n’est enregistré avant « Enregistrer la fiche » (un club de l’annuaire n’entre dans la compétition qu’à ce moment) ; quitter la page abandonne la saisie.',
      ],
      'Une fiche de plusieurs pages se saisit page par page : chaque page s’ajoute aux inscriptions déjà enregistrées pour ce club, et une ligne déjà saisie est mise à jour (pas de doublon). Rien n’est retiré : pour retirer un combattant, supprimez-le dans l’onglet Inscriptions.',
    ],
  },
  'import-ffk': {
    title: 'Import FFK',
    short: 'Déposez l’export FFK, tranchez ce que vous pouvez sur une seule page, puis importez : le reste est laissé tel quel jusqu’au prochain import.',
    details: [
      'Rien n’est enregistré avant « Importer… » : rien ne change sur une fiche sans votre accord, aucun combattant n’est créé sans que vous ayez validé sa carte. Les fichiers .xlsx, .xlsm, .ods et .csv sont acceptés.',
      'Choisissez les onglets à importer et vérifiez la correspondance des colonnes (elle est mémorisée). Puis, dans l’ordre de la page :',
      [
        '1. Catégories de poids absentes de la grille : cochez celles à créer.',
        '2. Clubs : reliez chaque club de l’export à un club de la compétition, ou créez-le.',
        '3. Combattants de l’export : une carte par combattant ; liez-le à un inscrit ou créez-le, choisissez les valeurs à garder, validez la carte. Un nouveau combattant, ou une inscription qui déroge aux règles de la compétition, reste « À trancher » tant que sa carte n’est pas validée.',
        '4. Fiches club sans inscription FFK : gardez-les, rapprochez-les d’une ligne de l’export ou supprimez-les.',
      ],
      'Le résumé en haut compte ce qui reste à trancher. « Importer… » n’est jamais bloqué : la fenêtre « Confirmer l’import FFK » récapitule ce qui sera fait et ce qui est laissé de côté.',
      'Ce qui n’est pas tranché revient au prochain import du même fichier. Les décisions ne sont pas mémorisées d’un import à l’autre : une carte validée avec la valeur de la fiche, différente de l’export, revient « À trancher ».',
    ],
  },
  'import-ffk.categories': {
    title: 'Catégories de poids absentes de la grille',
    short: 'Rien n’est créé sans votre accord : cochez une catégorie pour la créer, sinon choisissez une catégorie existante dans la carte de chaque combattant.',
    details: [
      'Une case par catégorie que l’export utilise et que la grille n’a pas, avec le nombre de combattants concernés. Toutes sont décochées au départ.',
      'Cochée : la catégorie sera créée à l’import et ses combattants y sont placés. Décochée : la catégorie de poids de ces combattants est à choisir dans leur carte, parmi celles de la grille.',
    ],
  },
  'import-ffk.clubs': {
    title: 'Clubs',
    short: 'Reliez chaque club de l’export à un club de la compétition, ou créez-le : le lien vaut pour tous ses combattants de cet import.',
    details: [
      'Un club n’est relié d’office que si le lien est sûr (même club FFK, même nom ou même N° d’affiliation) : sa carte est repliée, « Modifier » la rouvre.',
      'Un nom proche est « à vérifier » : rien n’est relié tant que vous ne cochez pas « Relier à … ». « Ne pas relier pour l’instant » laisse ses nouveaux combattants de côté.',
      '« Chercher un autre club par son nom… » trouve un club de la compétition. « ➕ Créer un club… » ouvre la fenêtre « Ajouter un club » de l’annuaire, pré-remplie : le club est créé tout de suite, puis relié.',
      'Le lien est mémorisé à l’import : au prochain import, le club est reconnu d’office.',
    ],
  },
  'import-ffk.cartes': {
    title: 'Combattants de l’export',
    short: 'Cliquez sur le combattant à lier ou sur « Nouveau combattant » : la carte s’ouvre. Choisissez les valeurs à garder, puis validez la carte.',
    details: [
      'Les lignes d’un même combattant (même licence, ou même nom, sexe et club) forment une seule carte, avec toutes ses disciplines.',
      [
        '« C’est … » : le combattant de l’app proposé, avec la raison (même licence, même nom…). « Pas dans la liste ? » cherche parmi tous les inscrits, par leur nom.',
        '« ➕ Nouveau combattant » : il sera créé à l’import, une fois la carte validée.',
        '« Ne pas lier pour l’instant » : la ligne est laissée de côté.',
      ],
      'Nouveau combattant (aucune fiche trouvée) : jamais créé d’office. Sa carte est « À trancher », sur « Ne pas lier pour l’instant » : vérifiez qu’il n’est pas déjà inscrit sous un autre nom (faute dans le nom ou le prénom) avec « Pas dans la liste ? », sinon cochez « ➕ Nouveau combattant » et validez la carte. Vaut aussi au premier import d’un club : une carte à valider par combattant.',
      'Inscription qui déroge aux règles de la compétition (plusieurs disciplines de combat alors que le réglage n’en prévoit qu’une, catégorie non ouverte) : la carte est « À trancher », avec la règle. Corrigez-la (décochez une discipline…) ou validez-la telle quelle : elle est alors enregistrée, comme depuis la fenêtre combattant. Une fiche qui avait déjà cette exception n’est pas signalée à chaque import.',
      'Carte ouverte : le formulaire du combattant. Les champs où l’export et la fiche diffèrent démarrent vides, encadrés en orange : cliquez sur « FFK » ou « Fiche club », ou saisissez une autre valeur.',
      '« Valider la carte » (grisé tant qu’un champ obligatoire manque) la replie et ouvre la suivante. « Annuler mes modifications » revient à l’état de départ de la carte (sur une carte validée, la validation est annulée aussi) ; « Écarter cette ligne » la laisse de côté.',
      'États : « À trancher » ; « À valider » (combattant choisi et champs obligatoires remplis, pas encore validée : laissée de côté à l’import ; tant qu’un champ obligatoire manque, elle reste « À trancher ») ; « Validée » ; « Sans problème » (fiche reconnue à coup sûr, rien à choisir : importée telle quelle) ; « Écartée ». Les confirmées sans changement sont repliées ensemble.',
      'Une carte validée dont la fiche a été modifiée depuis (autre poste, coach) revient « À trancher » : rouvrez-la, elle repart de la fiche actuelle, et revalidez-la.',
    ],
  },
  'import-ffk.sans-ffk': {
    title: 'Fiches club sans inscription FFK',
    short: 'Inscrits de la compétition absents de l’export. Sans action de votre part, ils sont gardés tels quels.',
    details: [
      'Ils viennent d’une fiche club, ou d’un import FFK précédent (« présent dans l’export précédent »). Rien n’est retiré d’office.',
      [
        '« Garder » (par défaut) : la fiche reste telle quelle, sans la marque « confirmée FFK ».',
        '« Rapprocher… » : cherchez la ligne de l’export qui est ce combattant ; sa carte se lie à lui et s’ouvre plus haut.',
        '« Supprimer » : ses inscriptions sont supprimées à l’import (impossible si ses combats ont commencé).',
      ],
      'Un inscrit choisi sur une carte de l’export, même pas encore validée, n’apparaît pas ici : ses inscriptions ne changent pas tant que la carte n’est pas validée.',
    ],
  },
  sessions: {
    title: 'Sessions',
    short: 'Regroupez les catégories qui se pèsent et se lancent ensemble (« Samedi matin », « Dimanche »…) : cochez leurs tranches d’âge ou disciplines.',
    details: [
      'Une session a sa propre pesée et sa propre réaffectation ; pendant qu’une session combat, la suivante peut déjà se peser.',
      [
        '« Ajouter une session », nommez-la, puis cochez les tranches d’âge (et, si besoin, les disciplines) qu’elle prend. « Tout cocher » prend d’un coup toutes les tranches (ou toutes les disciplines).',
        'Une catégorie va dans la session de la majorité de ses combattants (réaffectés compris ; absents compris tant que les sessions ne sont pas figées) ; à égalité, celle des plus jeunes. Le jour de la compétition, « Figer les sessions » garde chaque catégorie dans sa session : les nouvelles inscriptions et les réaffectations ne la changent plus. Un choix à la main reste toujours possible.',
        'Si une catégorie correspond à deux sessions, elle va dans la première (dans l’ordre des cartes) et une alerte l’indique.',
        '« Retirer » met une catégorie en attente ; « Ajouter à… » la place à la main dans une session (marquée « ajoutée à la main ») ; « Revenir aux règles » annule ce choix.',
        '« Enregistrer les sessions » enregistre les noms, l’ordre et les règles ; les retraits et ajouts à la main s’appliquent tout de suite.',
      ],
      'Sans session, toutes les catégories forment une seule session.',
      'Plus bas, « Horaires estimés » donne l’heure de fin de chaque session et de la journée ; les durées des combats s’y modifient sur place.',
    ],
  },
  'sessions.horaires': {
    title: 'Horaires estimés',
    short: 'Quand chaque session et la journée finiront, avec les durées de combat actuelles : raccourcissez-les ici pour finir plus tôt.',
    details: [
      'L’estimation compte toutes les sessions, lancées ou non, avec les inscrits du moment : elle suit la pesée, les réaffectations et les tableaux. Les résultats déjà saisis ne la changent pas.',
      'Une session commence à son « Début prévu » (onglet Combats) ; sans début prévu, juste après la précédente. Sans début prévu pour la première session, les heures sont remplacées par des durées depuis le début (« + 2 h 30 ») et les débuts prévus des sessions suivantes ne comptent pas.',
      [
        'Par session : début, fin estimée et durée ; puis chaque zone avec ses heures, son nombre de passages et une barre (la zone la plus chargée de la session a la barre pleine).',
        'Zone des finales choisie (onglet Finales) : l’heure vers laquelle commencent les finales « Fin de session ».',
        '« Chevauche la session précédente de 25 min (Zone 2) » : la session est prévue avant la fin estimée de la précédente sur cette zone (changement compris).',
        '« Décaler une session qui commence avant la fin de la précédente » (cochée par défaut, gardée sur ce poste) : sur chaque zone, la session attend la fin de la précédente et le changement. Décochée, elle commence à son heure prévue. Cette case ne change que l’estimation, pas les heures montrées aux spectateurs.',
      ],
      '« Modifier les durées » (en bas, replié) : les durées des combats, les mêmes que dans Réglages (poste Organisation seulement). « Enregistrer les durées » les enregistre pour toute la compétition ; la nouvelle fin estimée s’affiche à côté du bouton. Les catégories qui ont leur propre durée (onglet Tableaux) y sont listées, avec un lien vers chacune.',
    ],
  },
  finales: {
    title: 'Finales',
    short: 'Pour chaque session : la zone des finales, puis où et quand se joue la finale de chaque catégorie.',
    details: [
      'Chaque changement s’enregistre tout de suite. Les numéros de passage qui en découlent sont donnés au figeage de la session (onglet Combats).',
      [
        '« Zone des finales » : une zone de la compétition, ou « Aucune ». Choisir une zone y met toutes les finales de la session ; « Aucune » : chaque finale reste sur la zone de sa catégorie.',
        'Une zone cochée « Réservée aux finales » dans Réglages ne reçoit aucune catégorie de la répartition automatique : c’est la zone à choisir ici pour y jouer les finales.',
        'Où : « Sa zone » ou la zone des finales. Une catégorie qui se joue déjà sur la zone des finales est marquée « sur … » ; une discipline que la zone des finales n’accueille pas reste sur sa zone.',
        'Quand : « Dès que finie » (juste après le dernier combat de la catégorie) ou « Fin de session » (à la fin de la file de la zone, dans l’ordre des catégories).',
        '« Tout sur … », « Tout sur sa zone », « Tout dès que finie » et « Tout en fin de session » changent d’un coup toutes les catégories de la session ; une catégorie qui y arrive ensuite prend ce choix.',
        'Sur la zone des finales : d’abord tous ses propres combats, puis les finales « Dès que finie » dans l’ordre où leurs catégories se terminent, puis les finales « Fin de session ».',
        'Kata : la finale est le tour 2. « Sa zone » et « Dès que finie » gardent les numéros du tour 1 et de la finale d’affilée ; tout autre choix sépare le tour 1 et la finale.',
        '« pas de finale (poule) » : une poule unique n’a pas de finale, ses choix sont sans effet.',
      ],
      'Le résumé sous le tableau dit ce que chaque zone jouera pour la session.',
      'Session figée : les choix sont en lecture seule. Rouvrez la session dans Combats pour changer ; au moment de la refiger, les zones dont une finale a changé sont renumérotées « Mélangés ».',
    ],
  },
  'vagues.en-attente': {
    title: 'En attente',
    short: 'Les catégories qui ne sont dans aucune session : pas de pesée ni de lancement tant qu’elles n’en rejoignent pas une.',
    details: ['Cochez leur tranche d’âge dans une session, ou choisissez « Ajouter à… » pour les placer à la main.'],
  },
  pesee: {
    title: 'Pesée',
    short: 'Tapez le poids lu sur la balance puis Entrée : le combattant est marqué présent.',
    details: [
      [
        'Cherchez le combattant par son nom ou son club.',
        '« Ordre : Club | Nom » : par club (un en-tête par club, « Sans club » en dernier, pratique pour peser les élèves d’un même dojo ensemble) ou par nom ; le choix est gardé sur ce poste. La touche Entrée passe au combattant suivant dans l’ordre affiché.',
        'Tapez le poids (virgule acceptée, par exemple 54,3) puis Entrée.',
        'Un combattant qui ne vient pas : cliquez « Absent ».',
        'Le kata n’a pas de pesée : pointez seulement la présence.',
      ],
      'Chaque inscription de combat indique son règlement (Jiyu ou Shobu) et, s’il a été donné à l’inscription, le poids déclaré : « déclaré 38,5 kg ». Le poids déclaré n’est qu’une indication, la balance fait foi.',
      'Le badge « ⚖ hors catégorie → … » signale un combattant trop lourd pour sa catégorie (au-delà de la tolérance) et indique celle de son poids ; la réaffectation s’en occupera. La limite fait partie de la catégorie : 40,0 kg reste en -40 kg.',
      'La mention « réaffecté » indique un combattant déjà déplacé dans une autre catégorie.',
      '« Clôturer la pesée » marque absents tous les combattants non pesés. À faire une fois la pesée terminée.',
      'Avec des sessions : choisissez la session en haut de l’écran. La liste, les compteurs, les feuilles de pesée et « Clôturer la pesée » ne portent que sur cette session ; un combattant inscrit dans deux sessions est pointé dans chacune.',
      'Les feuilles de pesée (par club ou par catégorie) s’impriment pour peser sur papier.',
    ],
  },
  reaffectation: {
    title: 'Réaffectation',
    short: 'Trouvez une place à chaque combattant seul ou hors de sa catégorie : choisissez une proposition, regardez l’aperçu, validez.',
    details: [
      'Trois étapes : ① le plan automatique, le cas général ; ② les cartes, une par combattant, pour ce que le plan ne règle pas ; ③ les autorisations à demander aux clubs, avec leurs réponses. Les compteurs du haut montrent la situation actuelle.',
      [
        '① La liste des règles, de la plus acceptable à la moins acceptable, se lit comme un tableau. La première ligne, « Au départ, corrections imposées », compte les combattants à caser une fois faits les retours et les corrections de poids hors catégorie (et vos choix dans le plan). Chaque règle a sa barre : à gauche, en couleur, les combattants casés si on l’autorise avec toutes celles du dessus (la couleur est le coût de la règle qui les a casés) ; à droite, en rouge hachuré, ceux qui restent seuls. La barre pleine est le but.',
        'Rangez les règles, activez-les ou non, et placez la ligne « je m’arrête ici » (juste sous la première ligne : seulement les corrections imposées).',
        '« Voir le plan » liste les déplacements, du plus coûteux au moins coûteux. « Valider » confirme un déplacement à valider (il ne bougera plus), « Refuser » l’écarte, « Modifier » choisit une autre catégorie : le plan est recalculé à chaque fois, et chaque choix s’annule. Ces choix ne valent que pour le plan, sur ce poste : les cartes n’en voient rien. Les refus restent après « Appliquer le plan ».',
        '« Recommencer le plan » efface d’un coup vos validations, modifications et refus du plan ; rien de ce qui est appliqué ne change.',
        '« Tenir compte des décisions prises sur les cartes » : décochée, le plan ignore vos refus et vos mises de côté sur les cartes, et peut donc vous reproposer ces déplacements (les cartes, elles, restent telles quelles).',
        'Le calcul du plan se fait à part : une barre montre sa progression si elle dure, et « Annuler le calcul » l’arrête (le plan affiché ne tient alors pas compte de votre dernier changement ; « Relancer le calcul » le reprend).',
        '« Appliquer le plan » applique les déplacements sans validation et ceux que vous avez validés ; les autres restent en attente.',
        'Dans sa fenêtre, cochez « Appliquer aussi les déplacements à valider » pour appliquer tout le plan affiché, dans son ordre (sauf les lignes refusées) : la fenêtre liste à part les déplacements à valider, qui attendront l’autorisation des clubs ; après l’application, ③ liste toutes les demandes (⏳), y compris celles d’autres déplacements. Les catégories montrent alors l’état final ; « Refusée… » défait le déplacement en cause, et le plan ne le repropose plus.',
        '② Chaque cas (combattant sans adversaire, poids hors catégorie…) reçoit des propositions, de la meilleure à la moins bonne. « Aperçu » montre qui rencontrera qui avant de valider. « Refuser » écarte une proposition de la carte (elle reste en grisé, « Rétablir » la reprend).',
        '« Détails », sur une proposition comme sur une ligne du plan, montre la catégorie de départ et celle d’arrivée, calculées comme si le déplacement était fait (pour le plan, après les lignes du dessus) : leurs combattants, un clic sur un nom dépliant sa fiche, ou leur tableau ; « Voir dans la galaxie » et « Voir le tableau » l’ouvrent dans un nouvel onglet (le second sur la vue Liste des Tableaux). « 📋 Copier pour le club » copie la phrase à envoyer au club : le combattant, son club, sa catégorie, les règles du déplacement et sa catégorie d’arrivée.',
        '« Déplacer manuellement vers… » ne liste que les catégories cohérentes avec les réglages (âge, poids, règlement, mixité). « Toutes les catégories » ajoute les autres, marquées « ⚠ N règles enfreintes » : le détail s’affiche avant de confirmer.',
        'Les tableaux libres (créés dans l’onglet Catégories) figurent aussi dans cette liste, dans le groupe « Tableaux libres ».',
        'Un combattant placé à la main qui se retrouve seul (dans un tableau libre ou dans sa catégorie) reçoit une carte « Sans adversaire » sans proposition : le calcul ne le déplace jamais. Déplacez-le vous-même, ou « Annuler son déplacement manuel » pour le remettre dans sa catégorie.',
        '« Repartir de zéro » annule aussi les déplacements manuels (la fenêtre indique « dont N déplacements manuels »). Les tableaux libres restent, vides.',
      ],
      'Poids hors catégorie : la proposition « ⚖ Poids » l’envoie dans la catégorie de son poids réel. Si elle est vide, il y serait seul : elle passe alors en dernier, après les catégories où il aurait un adversaire (sa catégorie de poids est corrigée dans tous les cas).',
      'Sous le nom du combattant : sa tranche d’âge, sa discipline et son règlement, sa catégorie de poids, son poids (pesé ou approximatif) et les disciplines qu’il accepte.',
      'Catégorie fermée : le combattant est inscrit dans une catégorie que vous n’avez pas ouverte ; déplacez-le ou choisissez « Ne combat pas ».',
      'Split : un combattant seul peut aussi recevoir un combattant d’une autre catégorie (ou deux de la même, « pour donner une poule à… »), s’il en reste au moins deux au départ et si ce déplacement respecte les règles actives (âge, discipline, mixité, écart de poids…) : on propose d’abord les moins coûteux, puis les plus proches en poids. Jamais en kata. Sans autre règle que l’écart de poids réglé, c’est un cas simple.',
      'Badges : ⚖ Poids (catégorie de poids voisine), ⚖ Poids + (écart au-delà du seuil), ↑ Âge (tranche voisine), ⇄ Sen./Vét., ↑ Min./Adultes, ⚥ Mixte, Shobu → Jiyu, ⇄ Discipline, ↩ Retour, ✋ Placé à la main. Cliquez un badge validé pour son détail.',
      'Seul un déplacement qui ne change que la catégorie de poids, dans l’écart réglé, se fait sans validation ; tous les autres se valident à la main. « Pré-accord coach » rappelle que le club a accepté d’avance les déplacements d’âge et de poids.',
      'Avec des sessions : choisissez la session en haut de l’écran (la même que pour la pesée). Les cas, les compteurs et le plan d’ensemble ne portent que sur ses catégories.',
      'Le badge « ↪ change de session : Matin → Dimanche » signale une proposition qui ferait passer le combattant dans une catégorie d’une autre session. Elle n’est jamais appliquée sans votre validation : validez-la une par une. Le combattant repasse alors « non pesé » dans sa nouvelle session, à pointer à sa pesée ; son poids déjà relevé est gardé.',
      'Le badge « ↪ Emmène N autres combattants dans une autre session » signale un déplacement qui fait changer de session une catégorie entière (ses derniers combattants d’origine la quittent, par exemple) : mêmes règles, validation une par une, les combattants emmenés repassent « non pesés ».',
    ],
  },
  'reaffectation.autorisations': {
    title: 'Autorisations à demander',
    short: 'Les accords à demander aux clubs pour les combattants de la session, et les poids manquants : copiez le texte, puis notez chaque réponse.',
    details: [
      'La liste est recalculée à chaque changement (déplacement, pesée, absence) : elle montre ce qu’il faut demander aux clubs pour les groupes tels qu’ils sont maintenant, club par club, combattants numérotés. Un combattant inscrit dans deux disciplines a un seul numéro et une ligne par inscription.',
      [
        'Âge : il fait face à une tranche d’âge plus âgée que la sienne (ou, vétéran, à des seniors).',
        'Poids : l’écart estimé avec un adversaire d’une catégorie plus lourde dépasse 5 kg (5 kg tout juste : rien à demander).',
        'Poids manquant ⚖ : ni pesé ni poids déclaré, face à plus lourd ; ce n’est pas un accord, la ligne part quand son poids est saisi.',
        'Discipline : discipline ou règlement changés, même si la fiche du club l’acceptait.',
        'Mixité : groupe de filles et de garçons, pour chacun d’eux.',
        'Session : il combat dans une autre session que celle de sa catégorie d’origine (son horaire change).',
      ],
      '« pré-accord coché sur la fiche » à côté d’un club est une information : il ne dispense d’aucune demande.',
      '« Cette session » : « 📋 Copier pour le club » copie seulement les combattants numérotés et leurs demandes, pour les coller à la suite d’une autre session. « Toutes les sessions » : un seul texte par club, avec bonjour, combattants numérotés et demande des accords et des poids. « 📋 Copier tout » suit la même vue. Seules les demandes ⏳ en attente et les poids manquants y figurent.',
      [
        '⏳ en attente : « Accordée » note l’accord du club. L’accord ne vaut que pour la situation acceptée : si elle s’aggrave (pesée qui creuse l’écart, tranche plus âgée arrivée), la demande revient en attente.',
        '✓ accordée à telle heure : « annuler » retire l’accord noté.',
        '« Refusée… » ouvre la fenêtre d’annulation de l’historique sur les déplacements qui créent la demande, avec ce qui part avec eux ; confirmer les défait, et leurs propositions sont refusées (grisées sur leur carte en ②, avec « Rétablir ») : le plan d’ensemble ne les repropose plus. Impossible quand une session est lancée ou une catégorie commencée : le motif est écrit sous la ligne.',
        'Sans déplacement à défaire (le groupe existait déjà), « Déplacer à la main ↗ » ouvre le combattant dans les Tableaux.',
      ],
      '« Seulement en attente », cochée, cache les demandes accordées. Le compteur ⏳ du titre compte les demandes en attente de la vue choisie (cette session ou toutes).',
    ],
  },
  'recasement.de-cote': {
    title: 'Mises de côté',
    short: 'Une carte mise de côté ne compte plus dans les cas à traiter ni dans le plan d’ensemble : reprenez-la quand vous pouvez trancher.',
    details: [
      'Cliquez une ligne pour voir la carte complète : vous pouvez la traiter sans la reprendre.',
      'Si son problème disparaît (adversaire arrivé, poids corrigé), la carte disparaît aussi ; s’il revient, elle revient dans la liste principale.',
      'Le lancement de la session rappelle les cartes mises de côté.',
      'Mettre de côté, c’est « à reprendre plus tard » ; Ignorer, c’est « réglé » (voir Cartes ignorées).',
    ],
  },
  'recasement.ignorees': {
    title: 'Cartes ignorées',
    short: 'Une carte ignorée est réglée : elle ne revient que si la situation change.',
    details: [
      'La carte revient si un combattant de la catégorie arrive ou est déclaré absent, ou si un poids est pesé ou déclaré.',
      'Pour la reprendre tout de suite : « Reprendre » dans la liste des cartes ignorées, ou « Annuler… » sur la ligne « Ignoré » de l’Historique.',
      '« Repartir de zéro » reprend aussi les cartes ignorées de la session choisie.',
    ],
  },
  'recasement.valides': {
    title: 'Historique',
    short: 'Tout ce qui a été fait sur les tableaux ; vous pouvez annuler une action, avec celles qui en dépendent.',
    details: [
      'Annuler remet les tableaux touchés exactement comme avant. Les actions plus récentes qui touchent les mêmes catégories partent avec : elles sont écrites sous le bouton, surlignées au survol et listées dans la fenêtre de confirmation. Impossible si une de ces catégories a déjà commencé.',
      'Repartir de zéro annule d’un coup ce qui a été décidé depuis la session choisie (réaffectations, déplacements à la main, échanges, refus, cartes mises de côté) et efface ces lignes ; les actions Places, Tirage et Format plus récentes qui en dépendent partent avec. Les autres sessions ne bougent pas. Un combattant placé dans une session lancée ou une catégorie commencée reste où il est ; impossible si la session choisie est lancée.',
    ],
  },
  'tableaux.durees': {
    title: 'Durée des combats du tableau',
    short: 'Comme la compétition, ou une durée propre au tableau, avec des exceptions combat par combat.',
    details: [
      'Durée d’un combat = rounds × durée d’un round + (rounds − 1) × repos. Un combat avec une exception prend sa durée ; sinon une finale prend la finale du tableau, puis le tableau, puis la finale de la compétition, puis la compétition.',
      'Modifiable même quand le tableau est lancé ou commencé : les heures estimées des spectateurs sont recalculées (« vers 14:30 »).',
    ],
  },
  tableaux: {
    title: 'Tableaux',
    short: 'Les tableaux de chaque catégorie : vérifiez-les, changez le format si besoin, puis marquez-les prêts et imprimez.',
    details: [
      'Les tableaux se font tout seuls à partir des inscriptions, en séparant les combattants d’un même club au premier tour.',
      [
        'Trois vues, au choix en haut (« Planche / Liste / Galaxie », retenu sur ce poste). La planche (par défaut) montre toutes les catégories de la session en cartes, groupées par discipline, règlement et tranche d’âge, ou par zone (« Classer par »). Chaque carte montre ses combattants en pastilles, par combat du premier tour ; « Agrandir » montre le vrai tableau, avec « Nouveau tirage ». Le bac « Sans adversaire » à gauche liste les combattants seuls dans leur catégorie.',
        'La galaxie montre chaque catégorie comme une étoile, près de ses voisines : du vert (proche, en haut de la liste des règles) au rouge (loin). Les liens sont possibles en principe : la confirmation dit ce qui serait enfreint pour ce combattant. Cliquez sur une étoile : ses voisines viennent autour d’elle en cartes, où l’on glisse un combattant comme sur la planche. Dézoomez pour les renvoyer à leur place. Les voisines interdites par les réglages de la compétition ont un lien gris en pointillés : on peut quand même y glisser un combattant, la confirmation dit ce qui est enfreint.',
        'La barre (session, recherche, classement) et les pastilles des groupes restent en haut de l’écran pendant que la page défile ; une pastille mène à son groupe. Au téléphone, chacune tient sur une ligne qui défile de côté.',
        'La recherche ne cache rien : tapez une catégorie ou un combattant, les cartes trouvées sont entourées et la page défile jusqu’à la première. « 2 / 5 » dit où vous en êtes : ↓ ou Entrée pour la suivante, ↑ ou Maj+Entrée pour la précédente (les flèches à droite du champ font de même) ; Échap vide la recherche. Dans la Liste, la catégorie trouvée est choisie et son tableau s’affiche ; dans la galaxie, l’étoile trouvée est choisie et centrée. « Seulement à traiter » garde, lui, les seules cartes sans adversaire ou avec un cas de réaffectation. « Même club » (orange) prévient quand deux combattants d’un même club se rencontrent au premier tour : rien ne l’empêche. Le format, le repêchage, « Marquer prête » et l’impression restent dans la Liste (« Ouvrir dans la liste » sur une carte).',
        '« ⏳ » à côté d’un nom (planche, galaxie, liste) : une autorisation du coach est encore à obtenir pour ce combattant (le survol dit laquelle) ; la carte de la catégorie compte ces autorisations. La pastille disparaît quand la réponse est notée « Accordée » dans la Réaffectation. Un poste de Zone ne les voit pas.',
        '« ⓘ » à côté d’un nom ouvre la fiche du combattant (âge, licence, grade, présence et poids, discipline, autres inscriptions) dans une bulle, sans quitter la page ; le clic sur le nom garde son rôle (choisir, échanger).',
        'Glissez une pastille sur un combattant du même tableau : ils échangent leur place, tout de suite. Sur un combattant d’une autre catégorie : chacun prend la place de l’autre (« Échanger deux combattants »). Sur une autre carte : déplacement manuel. Ces deux-là s’affichent d’abord avec les règles enfreintes et les changements de session, à confirmer. Au doigt : touchez la pastille, puis la destination. Une catégorie lancée refuse tout dépôt. Après chaque action, « Annuler » reste 5 secondes ; « Historique » liste tout et annule.',
      ],
      [
        'Provisoire (gris) : avant la pesée et la réaffectation. Prête (bleu) : vérifiée, on peut l’imprimer. Lancée (orange) : un résultat est saisi, le tableau est figé. Terminée (vert) : podium connu.',
        'Format, repêchage et combat pour la 3e place se changent tant que la catégorie n’est pas lancée.',
        'Cliquez deux combattants pour les échanger : l’échange est gardé quand le tableau est refait (arrivée, retrait), jusqu’à « Nouveau tirage ».',
        'Un clic sur un combattant ouvre aussi « Déplacer vers… » sous le tableau : une autre catégorie, ou un tableau libre (créé dans l’onglet Catégories). Cochez « Toutes les catégories » pour voir celles dont les règles seraient enfreintes ; l’aperçu les liste avant de confirmer. Le combattant porte alors « Placé à la main » ; « Annuler son déplacement manuel » le remet dans sa catégorie.',
        '« Déverrouiller » rouvre une catégorie lancée (le tableau peut être refait si ses inscrits ont changé).',
        'Session figée : ses tableaux ne changent plus d’eux-mêmes. Si un combattant devient absent, « Régénérer (renuméroté à la suite) » refait le tableau et lui donne de nouveaux numéros, après le dernier numéro de sa zone : réimprimez-le (il porte « mis à jour à … »).',
      ],
      'Avec des sessions : la liste montre les catégories de la session choisie en haut (la même que dans les autres onglets) ; « En attente » montre celles qui ne sont dans aucune session, « Toutes » toute la compétition. Le bouton d’impression suit ce choix.',
      'Une catégorie de kata affiche son numéro de passage sur sa zone (« passage n° 1 ») : sur chaque zone, le kata passe avant les combats, le premier combat peut donc porter le n° 2.',
      'Les catégories « Sans adversaire » ou « Tous absents » ne sont pas imprimées.',
    ],
  },
  combats: {
    title: 'Combats',
    short: 'Cliquez une catégorie, puis un combat, pour saisir son résultat : le vainqueur avance tout seul.',
    details: [
      [
        'À gauche : les catégories et leur zone de combat. À droite : par zone, les prochains combats dans l’ordre des numéros de passage (avec des sessions, ceux de la session choisie en haut).',
        '« Figer et imprimer la session » : quand toutes ses catégories sont prêtes et ont une zone, les numéros de passage sont enregistrés et ne changent plus ; imprimez alors les tableaux de la session. « Reprendre les numéros à 1 » repart de 1 sur chaque zone (nouveau jour). Les sessions se figent dans l’ordre.',
        'Session figée : fermée à la réaffectation, ses tableaux ne bougent plus sans confirmation. Une catégorie nouvelle ou régénérée est « à numéroter » : « Numéroter à la suite » lui donne des numéros après le dernier de sa zone.',
        '« Rouvrir la session » rend modifiables les catégories sans résultat ; « Refiger la session » ne renumérote que celles qui ont changé, à la suite (ou « mélangés » : leurs zones d’arrivée sont entièrement renumérotées).',
        'Une zone prend du retard : dans la liste de gauche, choisissez une autre zone pour une catégorie (« Déplacer vers… »).',
        'Cliquez un combat du tableau pour saisir le vainqueur et la méthode.',
        'Une égalité de poule ou de kata s’affiche avec « Départager » : classez les ex-æquo.',
        'Un résultat corrigé rend « à revoir » les combats suivants déjà joués : ils sont encadrés en orange.',
        '« À trancher » : saisies d’un portable de zone, faites pendant une coupure du réseau, qui contredisent le PC principal. Gardez celle de la zone ou celle du PC ; d’ici là, les combats de la catégorie sont « En attente d’une décision à la table centrale ».',
      ],
    ],
  },
  'combats.categories': {
    title: 'Catégories et zones de combat',
    short: 'Chaque catégorie a une zone, répartie automatiquement ou épinglée à la main ; cliquez une catégorie pour l’ouvrir.',
    details: [
      '« Automatique (Tatami 2) » : l’app a placé la catégorie sur cette zone en équilibrant les combats. Choisir une zone l’y épingle ; « Automatique » la rend à la répartition.',
      'Dès qu’une catégorie d’une session est lancée, la répartition de la session est fixée : chaque catégorie garde sa zone (elle apparaît alors épinglée). « Automatique » la rend à la répartition, sauf dans une session figée (rouvrez-la d’abord).',
      'Session figée : choisir une autre zone ouvre « Déplacer vers… ». « À la suite » (conseillé) : les combats restants de la catégorie prennent les numéros après le dernier de la zone d’arrivée, seuls ses tableaux sont à réimprimer. « Mélangés » : tous les combats non joués de la zone d’arrivée sont renumérotés (mieux répartis, mais réimprimez tous ses tableaux). Les combats déjà joués gardent leur numéro ; l’aperçu montre ancien → nouveau numéro. Un combat en cours sur le tapis n’a pas de résultat : il serait renuméroté en « Mélangés ».',
      'L’ordre fixe le rang de la catégorie : catégories alternées en « tour par tour », enchaînées en « catégorie par catégorie » (Réglages › Ordre de passage). Les zones et leurs disciplines se règlent dans les Réglages.',
    ],
  },
  'combats.zone': {
    title: 'Prochains combats de la zone',
    short: 'Les combats à appeler sur cette zone, dans l’ordre des numéros imprimés sur les tableaux.',
    details: [
      'Cliquez « Saisir » pour entrer le résultat d’un combat, « Noter » pour un kata. Chaque kataka a son propre numéro ; la liste avance au fur et à mesure.',
      '« pas de repos : prévoir une pause » : un combattant de ce combat sort juste du précédent ; laissez-lui le temps de souffler.',
      'Le club de chaque combattant est écrit à côté de son nom, pour l’appel.',
      'Kata : « À l’appel » montre le kataka qui passe (nom, club, « kataka 2 sur 5 ») ; le suivant est la première ligne de « Ensuite ». La carte passe au suivant dès que ses notes sont enregistrées ; les absents sont sautés. En finale, « Finaliste 1 » et « Finaliste 2 » prennent leur nom dès que les finalistes sont connus.',
    ],
  },
  'combats.resultat': {
    title: 'Saisir un résultat',
    short: 'Cliquez le vainqueur, choisissez la méthode, puis « Enregistrer ».',
    details: [
      [
        'Méthode : décision des arbitres (choisie d’office), points, KO (shobu seulement), abandon, disqualification ou forfait.',
        'Le score est facultatif (par exemple 3-1).',
        'Pour corriger : rouvrez le combat et choisissez l’autre vainqueur. Les combats suivants déjà joués deviennent « à revoir ».',
        '« Effacer le résultat » remet le combat à disputer (une confirmation est demandée).',
      ],
    ],
  },
  'combats.horaires': {
    title: 'Horaires de la session',
    short: 'Début prévu, heure de démarrage réelle et heure des finales : de quoi estimer les heures de passage.',
    details: [
      'Le début prévu est affiché aux spectateurs avant le lancement. Une fois la session lancée, « Démarrée à » (bouton « Maintenant ») sert de point de départ aux estimations.',
      '« Finales à » : vide, les finales « Fin de session » de la zone des finales attendent la fin des combats éliminatoires de la session, et celles des autres zones se jouent à la fin de leur file. Saisie, la première finale « Fin de session » de chaque zone attend cette heure.',
      'Les heures affichées aux spectateurs sont des estimations (« vers 14:30 ») calculées avec les durées des combats ; chaque champ s’enregistre en le quittant.',
    ],
  },
  'combats.kata': {
    title: 'Notation du kata',
    short: 'Tapez la note de chaque arbitre pour chaque kataka, puis ✓ au bout de sa ligne (ou Entrée).',
    details: [
      [
        'Choisissez d’abord le nombre d’arbitres.',
        'Le grade du kataka (s’il a été donné à l’inscription) est affiché sous son nom, pour information.',
        'Moins de 5 arbitres : la note retenue est la moyenne. À partir de 5 : on retire la plus haute et la plus basse, puis on fait la moyenne.',
        'La finale apparaît quand toutes les notes du tour 1 sont saisies.',
        'En cas d’égalité avec au moins 5 arbitres, la note basse retirée puis la note haute retirée départagent ; sinon « Départager » vous laisse classer.',
      ],
    ],
  },
  podiums: {
    title: 'Podiums',
    short: 'Les podiums de chaque catégorie, le classement des clubs et les exports.',
    details: [
      'Un podium s’affiche quand sa catégorie est terminée.',
      [
        '« Imprimer les podiums » : une feuille pour la remise des médailles.',
        '« Feuilles de résultats » : les tableaux remplis, à archiver.',
        'Exports .ods ou .xlsx des podiums et de tous les résultats.',
        'Export FFK (.xlsx) : le fichier au format de l’export FFK, avec la situation finale de chaque combattant (catégorie où il combat, désistés retirés), pour que la FFK voie les changements.',
      ],
    ],
  },
  journal: {
    title: 'Journal',
    short: 'Tout ce qui a modifié la compétition, du plus récent au plus ancien.',
    details: [
      'Chaque modification de la compétition y est notée au moment où elle est enregistrée : ce qui a changé (l’ancienne valeur barrée, puis la nouvelle), quand, par qui et comment (l’étiquette : Saisie, Inscription sur place, Pesée…).',
      [
        'Qui : l’adresse du compte connecté, avec son rôle (« compte Table ») ; sans comptes, le poste déclaré par le navigateur (« poste Organisation », « poste Table centrale », « poste Zone 2 ») ; un club qui inscrit par son lien personnel : son nom, avec « lien du club ».',
        'Une saisie faite sur un portable de zone indique aussi son heure sur le portable (« saisi 15:12 sur le portable, reçu 15:14 »).',
        'Une opération qui touche beaucoup de combattants (clôture de la pesée, « Import FFK · fichier »…) tient sur une ligne : « ▸ Voir le détail » la déplie. Un long détail est replié après 5 lignes : « … N autres » montre le reste, et les lignes qui correspondent à la recherche restent toujours montrées.',
        'Une ligne « Opération non détaillée », sur fond orangé, note une modification que le journal ne sait pas encore décrire en détail.',
      ],
      'La recherche trouve tous les mots tapés, sans tenir compte des accents ni des majuscules : noms, clubs, catégories, valeurs, comptes, étiquettes. Les pastilles de type limitent le fil à certains types ; « Tous » les remet tous.',
      'Le fil se met à jour tout seul quand un autre poste modifie la compétition ; la suite se charge en descendant.',
      'Rien ne s’efface du journal : il part avec les données de la compétition, à la fin de la durée de conservation.',
      'Réservé à l’organisateur : l’onglet n’apparaît pas aux postes et aux comptes Table centrale et Zone, et les liens des clubs n’y donnent pas accès.',
    ],
  },
  'podiums.clubs': {
    title: 'Classement des clubs',
    short: 'Les médailles par club : or, puis argent, puis bronze.',
    details: ['Les combattants sans club ont leurs médailles dans les podiums, mais ne comptent pas dans ce classement.'],
  },
  'parametres.sauvegardes': {
    title: 'Sauvegardes',
    short: 'Une copie de toute l’installation est faite toute seule ; en cas de problème, on peut revenir à une sauvegarde.',
    details: [
      'Une sauvegarde est faite automatiquement quand quelque chose a changé ; les 200 dernières sont gardées (toute une journée de compétition). La liste montre les 10 plus récentes, la plus récente en haut.',
      [
        '« Sauvegarder maintenant » en fait une tout de suite.',
        'Pour revenir en arrière : cliquez « Télécharger » sur la sauvegarde voulue, puis « Restaurer une sauvegarde… » et choisissez ce fichier.',
        'Une sauvegarde contient toutes les compétitions, l’annuaire, les comptes, les réglages, les images et les pièces jointes des mails. Elle ne contient ni les sessions, ni les jetons de synchronisation, ni le mot de passe d’envoi des mails, ni la clé du compte Google.',
        'La restauration remplace toutes ces données par celles du fichier ; une copie de l’état actuel est faite juste avant. Le mot de passe d’envoi et le compte Google restent en place si le fichier désigne le même compte ; sinon, ressaisissez-le ou reconnectez-le.',
        '« Télécharger une sauvegarde complète » : à garder en lieu sûr, par exemple sur une clé USB en fin de journée. Le fichier contient des données personnelles et les comptes.',
      ],
    ],
  },
  reglages: {
    title: 'Réglages',
    short: 'Les informations de la compétition et ses règles : réaffectation, pesée, formats de tableaux, kata.',
    details: [
      'Ces réglages valent pour toute la compétition. Cliquez « Enregistrer » en bas de page après vos changements.',
      'Changer un format ou une option refait les tableaux qui ne sont pas encore lancés.',
    ],
  },
  'reglages.competition': {
    title: 'Compétition',
    short: 'Nom, date et lieu de la compétition.',
    details: ['Ces informations figurent sur les fiches club et les feuilles imprimées.'],
  },
  'reglages.visibilite': {
    title: 'Visibilité',
    short: 'Privée : visible des seuls organisateurs. Publique : une page ouverte à tous, sans compte, affichée sur la page d’accueil.',
    details: [
      'Une compétition est privée tant que vous ne la rendez pas publique ; vous pouvez la remettre en privé à tout moment.',
      'Sur la page publique, les tableaux et les numéros d’une session n’apparaissent qu’au lancement de cette session.',
      'Jamais en public : poids, grade, licence, coordonnées des coachs, état de pesée ou de présence, raisons de retrait, comptes, liens des clubs et notes internes.',
    ],
  },
  'reglages.zones': {
    title: 'Zones de combat',
    short: 'Les zones où se déroulent les combats (« Tatami 1 », « Ring »…) : nommez-les, rangez-les et cochez les disciplines que chacune accueille.',
    details: [
      [
        'Renommez une zone en tapant son nom ; ↑ et ↓ changent l’ordre d’affichage.',
        '« Ajouter une zone » en crée une nouvelle (elle accueille toutes les disciplines) ; ✕ la supprime (ses catégories sont réparties sur les autres zones).',
        'Une zone où se déroule une catégorie déjà lancée ne peut pas être supprimée.',
        'Deux zones ne peuvent pas porter le même nom.',
        'Disciplines accueillies : par exemple, le shido-boxing cochée seulement sur le Ring. Une zone accueille au moins une discipline.',
        'Réservée aux finales : l’app n’y répartit aucune catégorie (vous pouvez encore en épingler une à la main) ; choisissez-la ensuite comme zone des finales dans l’onglet Finales, puis « Tout dès que finie » ; tant qu’aucune catégorie n’y est épinglée, chaque finale y passe dès que sa catégorie est terminée. Les disciplines cochées disent quelles finales elle accepte.',
      ],
      'L’app répartit les catégories de chaque session sur les zones qui accueillent leur discipline, en équilibrant le nombre de combats. Dans l’onglet Combats, vous pouvez épingler une catégorie sur une zone : ce choix l’emporte. Le nom de la zone est imprimé sur les tableaux.',
    ],
  },
  'reglages.ordre': {
    title: 'Ordre de passage',
    short: 'Chaque zone numérote ses combats : kata d’abord, puis les combats tour par tour (par défaut) ou catégorie par catégorie.',
    details: [
      [
        'Tour par tour : les tours sont alignés à partir de la fin (toutes les demies ensemble…) ; on passe un tour de toutes les catégories de la zone avant le suivant. Les combattants ont ainsi le plus de repos possible.',
        'Catégorie par catégorie : une catégorie va jusqu’à son dernier combat, puis la suivante (dans l’ordre saisi dans l’onglet Combats, sinon celui de la grille).',
        'Chaque kataka a son numéro (le tour 1 dans l’ordre du tirage, puis les deux places de la finale), avant les combats de sa session, sauf si la finale est placée ailleurs ou en fin de session.',
        'Les numéros se suivent d’une session à l’autre sur une même zone. Une exemption n’a pas de numéro.',
        'Quand un combattant enchaîne deux combats sans repos, le combat porte « pas de repos : prévoir une pause ».',
        'Les finales se règlent session par session dans l’onglet Finales : sur leur zone ou sur une zone des finales, dès que leur catégorie est finie ou en fin de session (le tableau imprimé indique la zone des finales). Les combats pour la 3e place et les repêchages restent sur leur zone.',
        'Une catégorie sans numéro de passage (sans zone possible ou sans session) numérote ses combats « c1 », « c2 »… pour ne pas les confondre avec ceux d’une zone.',
      ],
      'Si aucune zone n’accueille une discipline, ses catégories restent sans zone ni numéro et un message le signale.',
    ],
  },
  'reglages.recasement': {
    title: 'Réaffectation',
    short: 'Jusqu’où la réaffectation peut aller : écart de poids et mélanges autorisés.',
    details: [
      [
        'Écart de poids max (enfants et adultes séparément) : jusqu’à cet écart, un déplacement vers un poids voisin est sans risque ; au-delà, il reste proposé mais se valide à la main (badge « ⚖ Poids + »). Dans une catégorie de la grille, l’écart toléré est au moins sa largeur (de −45 à −55 kg : 10 kg) ; une catégorie sans limite (la plus légère, ou « + ») ne donne jamais de carte « Écart de poids ».',
        'Mélange mineurs / adultes, seniors / vétérans, filles / garçons : chaque mélange coché peut être proposé, mais se valide à la main.',
        'Filles / garçons : seulement dans les tranches d’âge cochées.',
        'Passage de shobu à jiyu : désactivé par défaut. Coché, un combattant shobu sans adversaire peut être proposé dans la catégorie jiyu correspondante (validation à la main). Le passage de jiyu à shobu n’est jamais proposé.',
        'Plusieurs disciplines de combat le même jour : permet à un combattant d’être inscrit en karaté et en shido-boxing, par exemple.',
      ],
    ],
  },
  'reglages.pesee': {
    title: 'Pesée',
    short: 'La tolérance ajoutée à la limite de poids avant de déclarer un combattant hors catégorie.',
    details: [
      'Règlement FFK : 300 g pour les hommes, 500 g pour les femmes. Seul un combattant trop lourd est hors catégorie.',
      'Comme à la FFK, la limite fait partie de la catégorie : en -40 kg, un combattant pesé 40,0 kg reste en -40 kg (et jusqu’à 40,3 kg pour un homme, tolérance comprise). La dernière catégorie, ouverte (« +84 kg »), prend tous les poids au-dessus.',
    ],
  },
  'reglages.tableaux': {
    title: 'Tableaux',
    short: 'Le format de tableau choisi selon le nombre de combattants, et les options par défaut.',
    details: [
      [
        '2 combattants : un seul combat ou meilleur des trois.',
        '3 combattants : poule (chacun rencontre les autres) ou autre format.',
        '4 et plus : élimination directe par défaut.',
        'Repêchage : ceux qui ont perdu contre un finaliste se disputent le bronze.',
        'Combat pour la 3e place : un seul bronze au lieu de deux (ignoré quand le repêchage est activé).',
      ],
      'Chaque catégorie peut changer de format dans l’onglet Tableaux.',
    ],
  },
  'reglages.durees': {
    title: 'Durées des combats',
    short: 'Rounds, durée d’un round, repos et prolongation par groupe d’âge, pour estimer les heures de passage.',
    details: [
      'Durée d’un combat = rounds × durée d’un round + (rounds − 1) × repos. Le temps de changement s’ajoute après chaque passage ; la prolongation n’est pas comptée.',
      'Finale : par groupe d’âge, une autre durée pour les combats pour la 1re place (finale, grande finale, combat unique, manches d’un meilleur des trois ; pas la petite finale). Un tableau avec sa propre durée a aussi sa ligne Finale.',
      'Un tableau peut avoir sa propre durée, et un combat la sienne (onglet Tableaux) : le combat l’emporte sur le tableau (et sa finale), qui l’emporte sur la compétition (et sa finale).',
      'Les spectateurs voient des heures estimées (« vers 14:30 ») : elles se recalculent au fil des résultats.',
    ],
  },
  'reglages.kata': {
    title: 'Kata et triathlon',
    short: 'Le nombre de médailles de bronze en kata et le nombre de rounds du triathlon.',
    details: ['Kata : un ou deux bronzes (les suivants du tour 1).'],
  },
  categories: {
    title: 'Catégories',
    short: 'La grille âge / poids de la compétition (déjà remplie avec la grille FFK), les catégories ouvertes et les tableaux libres.',
    details: [
      'Modifiez-la seulement si votre compétition s’écarte de la grille FFK. Cliquez « Enregistrer la grille » après vos changements.',
      'Une catégorie de poids qui contient des inscrits ne peut pas être supprimée.',
    ],
  },
  'grille.poids': {
    title: 'Catégories de poids',
    short: 'Pour une tranche d’âge et un sexe, la liste des catégories de poids.',
    details: [
      'Le libellé suit le poids max : « -54 » pour 54 kg au plus. La dernière catégorie est ouverte (« +84 ») et n’a pas de poids max.',
    ],
  },
  'grille.tranches': {
    title: 'Tranches d’âge',
    short: 'Les tranches d’âge, avec leurs âges et la limite mineurs / adultes.',
    details: [
      'La case « Mineurs » sépare mineurs et adultes : ils ne sont jamais mélangés, sauf si le réglage le permet.',
    ],
  },
  'grille.ouvertes': {
    title: 'Catégories ouvertes',
    short: 'Décochez une case pour ne pas ouvrir cette catégorie : elle disparaît de l’inscription en ligne, et de la fiche club si toute la tranche d’âge est fermée.',
    details: [
      'Une case = une tranche d’âge, un sexe, une discipline et son règlement. Le réglage vaut pour cette compétition seulement ; tout est ouvert au départ.',
      'Les combattants déjà inscrits dans une catégorie que vous fermez apparaissent en Réaffectation : vous les déplacez ou choisissez « Ne combat pas ».',
      'Une catégorie déjà lancée ne se ferme plus. La case d’une ligne (ou d’une colonne) ferme ou rouvre toute la ligne.',
    ],
  },
  'grille.libres': {
    title: 'Tableaux libres',
    short: 'Des tableaux hors grille (gala, démonstration…) où l’on place des combattants à la main, avec leur propre session.',
    details: [
      'Un tableau libre a un nom, une discipline et un règlement. Il reste « En attente » tant qu’on ne le met pas dans une session.',
      'Son nom est affiché tel quel sur la page publique d’une compétition publique : n’y mettez pas le nom d’une personne (un combattant masqué y serait reconnu).',
      'Supprimer un tableau libre renvoie ses combattants dans leur catégorie précédente.',
      'Un tableau lancé ne change plus de nom, de discipline ni de règlement : déverrouillez-le dans l’onglet Tableaux.',
    ],
  },
  'grille.passages': {
    title: 'Passages d’âge autorisés',
    short: 'Vers quelle tranche d’âge un combattant peut être réaffecté quand il est seul dans la sienne.',
    details: [
      'La réaffectation ne propose de changer de tranche d’âge que par un passage de cette liste (par exemple Minimes → Cadets).',
      [
        '« Toujours permis » : le passage est proposé dès qu’il est utile (tranche voisine).',
        '« Seulement si le mélange seniors / vétérans est activé » : le passage dépend de ce réglage (onglet Réglages, section Réaffectation).',
        'Un passage de mineurs vers adultes (par exemple Juniors → Seniors) dépend en plus du réglage « mélange mineurs / adultes ».',
      ],
      'La grille FFK est déjà réglée : en général, il n’y a rien à changer ici.',
    ],
  },
  'grille.modeles': {
    title: 'Modèles de grille',
    short: 'Enregistrez cette grille pour la réutiliser dans une prochaine compétition.',
    details: ['« Charger un modèle » remplace la grille actuelle par celle du modèle (impossible si cela supprime des catégories utilisées).'],
  },
};
