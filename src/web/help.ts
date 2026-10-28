/**
 * Textes d'aide de l'app, regroupés ici pour être relus d'un coup.
 * `short` : une phrase visible sous le titre. `details` : l'aide complète du bouton ⓘ
 * (un texte = un paragraphe ; un tableau de textes = une liste à puces).
 */
export type HelpTopicId =
  | 'competitions'
  | 'annuaire'
  | 'synchro-google'
  | 'comptes'
  | 'parametres'
  | 'impression'
  | 'inscriptions'
  | 'clubs'
  | 'fiche-club'
  | 'import-ffk'
  | 'sessions'
  | 'vagues.en-attente'
  | 'pesee'
  | 'reaffectation'
  | 'tableaux'
  | 'combats'
  | 'podiums'
  | 'reglages'
  | 'grille'
  | 'fiche-club.en-ligne'
  | 'fiche-club.envoyer'
  | 'fiche-club.importer'
  | 'fiche-club.saisir'
  | 'import-ffk.clubs'
  | 'import-ffk.rapprochements'
  | 'import-ffk.mises-a-jour'
  | 'import-ffk.creations'
  | 'recasement.valides'
  | 'recasement.de-cote'
  | 'combats.categories'
  | 'combats.zone'
  | 'combats.resultat'
  | 'combats.kata'
  | 'podiums.clubs'
  | 'podiums.sauvegardes'
  | 'reglages.competition'
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
  | 'grille.poids'
  | 'grille.tranches'
  | 'grille.ouvertes'
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
  annuaire: {
    title: 'Annuaire des clubs',
    short: 'Les clubs connus, d’une compétition à l’autre : invitez-les ensuite aux inscriptions en ligne d’une compétition.',
    details: [
      'L’annuaire ne dépend d’aucune compétition. Il se remplit tout seul avec les clubs des fiches, de l’import FFK et des saisies ; vous pouvez aussi y créer des clubs à l’avance.',
      [
        'Le numéro d’affiliation FFK (les chiffres en tête du club dans l’export FFK) reconnaît un club à coup sûr, même si son nom est écrit autrement.',
        '« Modifier » change le nom, le numéro d’affiliation, le coach, les adresses e-mail ou les notes ; « Archiver » cache un club qui ne vient plus, sans rien effacer.',
        'Un club peut avoir plusieurs adresses e-mail (coach, président, secrétariat…) : tapez-les dans « E-mails », Entrée ou virgule entre deux. À l’envoi des liens, vous choisissez lesquelles reçoivent le mail.',
        '« Fusionner avec… » réunit deux fiches du même club : les compétitions de l’une passent à l’autre, la fiche gardée reçoit les adresses e-mail qu’elle n’avait pas, puis la première est supprimée.',
        '« Synchroniser avec Google » (sur le serveur en ligne, avec un compte Google connecté) compare les coachs de l’annuaire aux contacts Google ; un club lié porte la marque « Google ». « Ne plus synchroniser avec Google » retire ce lien sans rien effacer.',
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
        'Table centrale : inscriptions, clubs, pesée, réaffectations, tableaux, sessions à lancer et résultats de toutes les zones ; pas les réglages, la grille, les imports ni les invitations.',
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
      'Message aux clubs : le modèle de mail, avec les variables {club}, {coach}, {competition}, {date}, {lieu}, {date_limite} et {lien} ; chaque compétition peut avoir le sien.',
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
    short: 'La liste de tous les combattants inscrits ; ajoutez une inscription sur place ou corrigez une ligne.',
    details: [
      'Une ligne = un combattant dans une discipline. Un même combattant peut avoir plusieurs lignes (kata et combat, par exemple).',
      [
        'Recherche : tapez une partie du nom ou du club.',
        '« Sans inscription FFK » : inscriptions pas encore confirmées par l’export FFK (fiche club, saisie, inscription sur place).',
        'Le crayon modifie une inscription, la croix la supprime (impossible si sa catégorie a déjà commencé).',
        'Une inscription sur place le jour J se saisit ici, avec la case « Inscription sur place ».',
        'Club : choisissez-le dans la liste (clubs de la compétition et de l’annuaire) ou laissez vide. Un club absent de la liste s’ajoute avec l’option « Ajouter le club « … » », proposée quand le nom tapé n’y est pas.',
      ],
      'La colonne « Origine » indique d’où vient la ligne : fiche club, export FFK ou saisie.',
    ],
  },
  clubs: {
    title: 'Clubs',
    short: 'Les clubs, leur coach et leur pré-accord pour les réaffectations.',
    details: [
      'Les clubs sont créés par l’import des fiches club, par l’import FFK ou par la saisie des inscriptions.',
      [
        'Coach : nom, téléphone et adresses e-mail (une ou plusieurs), pour le joindre le jour J.',
        'Pré-accord : le coach accepte d’avance qu’on réaffecte ses combattants. Les déplacements d’âge et de poids portent alors la mention « pré-accord coach » (une indication : ils se valident toujours à la main).',
      ],
    ],
  },
  'fiche-club': {
    title: 'Fiche club',
    short: 'Envoyez la fiche aux clubs (tableur ou papier), puis importez ou saisissez chaque fiche qu’ils vous renvoient.',
    details: [
      'La fiche club apporte ce que l’export FFK n’a pas : le poids actuel, les disciplines acceptées en cas de reclassement, la priorité en shobu, le grade pour le kata et le coach.',
      'Elle part plusieurs semaines avant la compétition ; l’export FFK n’arrive qu’à la clôture des inscriptions.',
    ],
  },
  'fiche-club.en-ligne': {
    title: 'Inscriptions en ligne',
    short: 'Chaque club invité reçoit un lien personnel pour inscrire et corriger lui-même ses combattants, jusqu’au gel.',
    details: [
      'Le coach ouvre son lien sur ordinateur ou sur téléphone. Il voit tous les combattants de son club dans cette compétition, quelle que soit leur origine (fiche, export FFK, saisie), et peut en ajouter, en modifier ou en retirer.',
      [
        'Choisissez des clubs de l’annuaire dans « Clubs à inviter » puis « Inviter les clubs choisis » : un lien est créé pour chacun. Copiez-les tout de suite : pour des raisons de sécurité, un lien ne s’affiche qu’une seule fois.',
        '« Régénérer le lien » crée un nouveau lien et désactive l’ancien (lien perdu, mauvais destinataire) ; « Révoquer » désactive le lien sans en créer d’autre.',
        '« Ouvrir les inscriptions » rend les pages des clubs modifiables ; la date limite est seulement affichée aux clubs.',
        '« Envoyer le lien par mail » : un seul mail par club. Pour un club qui a plusieurs adresses, chacune a sa case, toutes cochées : décochez celles qui ne doivent pas recevoir ce mail (cela ne vaut que pour cet envoi). « Ouvrir dans ma messagerie » propose le même choix.',
        '« Figer les inscriptions » met toutes les pages des clubs en lecture seule ; les changements suivants se font par l’organisation. On peut rouvrir.',
        'Les mails envoyés par l’application portent aussi en pièces jointes la fiche à imprimer (PDF) et le tableur (.ods) : un club peut inscrire ses élèves par l’un ou l’autre. « Ouvrir dans ma messagerie » ne peut pas joindre de fichier : joignez-les vous-même (ils sont proposés au téléchargement).',
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
      'Seules les tranches d’âge cochées « Fiche club » dans la grille sont proposées.',
    ],
  },
  'fiche-club.importer': {
    title: '2. Importer une fiche renvoyée',
    short: 'Choisissez le fichier renvoyé par un club, vérifiez l’aperçu, puis importez.',
    details: [
      [
        'L’aperçu montre chaque ligne : les lignes en erreur (rouge) ne seront pas importées, les remarques (orange) le seront.',
        'Réimporter la fiche d’un club remplace les inscriptions de sa fiche précédente : l’aperçu liste celles qui seront retirées.',
        'Une inscription d’une catégorie qui a déjà commencé n’est jamais retirée.',
      ],
      'Si le fichier est refusé, le message dit pourquoi (fiche modifiée, nom du club manquant…).',
      'Les fiches remplies avec l’ancien format (une ligne par inscription, catégorie de poids) sont toujours acceptées.',
    ],
  },
  'fiche-club.saisir': {
    title: '3. Saisir une fiche papier',
    short: 'Recopiez une fiche papier ligne par ligne (page par page), cliquez « Vérifier », puis « Enregistrer la fiche ».',
    details: [
      [
        'Le tableau suit la fiche papier, dans le même ordre : une ligne par combattant.',
        'Cliquez les cases cochées sur la fiche ; un second clic décoche.',
        'Kata et combat sur une même ligne donnent deux inscriptions. La catégorie de poids est déduite du poids actuel.',
        '« Ajouter une ligne » pour les fiches de plus de 5 combattants.',
        'Rien n’est enregistré avant « Enregistrer la fiche » ; quitter la page abandonne la saisie.',
      ],
      'Une fiche de plusieurs pages se saisit page par page : chaque page s’ajoute aux inscriptions déjà enregistrées pour ce club, et une ligne déjà saisie est mise à jour (pas de doublon). Rien n’est retiré : pour retirer un combattant, supprimez-le dans l’onglet Inscriptions.',
    ],
  },
  'import-ffk': {
    title: 'Import FFK',
    short: 'Importez l’export des inscriptions FFK, vérifiez l’aperçu, tranchez les doutes, puis validez.',
    details: [
      'L’export FFK fait foi pour l’âge et le poids. Les fichiers .xlsx, .ods et .csv sont acceptés.',
      [
        'Choisissez les onglets à importer et vérifiez la correspondance des colonnes (elle est mémorisée).',
        'L’aperçu rapproche chaque ligne d’un combattant déjà connu (fiche club) ou en crée un nouveau.',
        'Les rapprochements douteux (homonymes, fautes de frappe) doivent être tranchés avant l’import.',
      ],
      'Réimporter un export plus récent ajoute, modifie ou retire des inscriptions sans créer de doublons.',
    ],
  },
  'import-ffk.clubs': {
    title: 'Clubs',
    short: 'Vérifiez à quel club de l’app correspond chaque club de l’export FFK.',
    details: [
      'Un lien « à vérifier » est une ressemblance de nom : vérifiez-le, et changez-le si ce n’est pas le bon club. Laissé tel quel, il est utilisé pour cet import.',
    ],
  },
  'import-ffk.rapprochements': {
    title: 'Rapprochements à trancher',
    short: 'Pour chaque cas, dites s’il s’agit du même combattant ou d’un nouveau.',
    details: [
      'L’app a trouvé un combattant proche (même nom dans un autre club, faute de frappe…). Choisissez le bon combattant, ou « Nouveau combattant ».',
      'L’import reste bloqué tant qu’un cas n’est pas tranché.',
    ],
  },
  'import-ffk.mises-a-jour': {
    title: 'Mises à jour',
    short: 'Les inscriptions déjà connues que l’export FFK va compléter ou corriger.',
    details: ['L’âge et le poids de l’export remplacent ceux de la fiche club. Les préférences de la fiche sont gardées.'],
  },
  'import-ffk.creations': {
    title: 'Créations',
    short: 'Les inscriptions de l’export FFK qui n’existent pas encore et seront créées.',
    details: ['Ces combattants n’ont pas envoyé de fiche club : ils n’auront pas de préférences, sauf si vous les ajoutez à la main.'],
  },
  sessions: {
    title: 'Sessions',
    short: 'Regroupez les catégories qui se pèsent et se lancent ensemble (« Samedi matin », « Dimanche »…) : cochez leurs tranches d’âge ou disciplines.',
    details: [
      'Une session a sa propre pesée et sa propre réaffectation ; pendant qu’une session combat, la suivante peut déjà se peser.',
      [
        '« Ajouter une session », nommez-la, puis cochez les tranches d’âge (et, si besoin, les disciplines) qu’elle prend. « Tout cocher » prend d’un coup toutes les tranches (ou toutes les disciplines).',
        'Une catégorie suit la plus jeune tranche d’âge de ses combattants ; un combattant réaffecté depuis une autre tranche ne la fait pas changer de session. Une catégorie créée plus tard (inscription sur place) rejoint d’office la session qui lui correspond.',
        'Si une catégorie correspond à deux sessions, elle va dans la première (dans l’ordre des cartes) et une alerte l’indique.',
        '« Retirer » met une catégorie en attente ; « Ajouter à… » la place à la main dans une session (marquée « ajoutée à la main ») ; « Revenir aux règles » annule ce choix.',
        '« Enregistrer les sessions » enregistre les noms, l’ordre et les règles ; les retraits et ajouts à la main s’appliquent tout de suite.',
      ],
      'Sans session, toutes les catégories forment une seule session.',
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
        'Tapez le poids (virgule acceptée, par exemple 54,3) puis Entrée.',
        'Un combattant qui ne vient pas : cliquez « Absent ».',
        'Le kata n’a pas de pesée : pointez seulement la présence.',
      ],
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
      'Deux étapes : ① le plan automatique, le cas général ; ② les cartes, une par combattant, pour ce que le plan ne règle pas. Les compteurs du haut montrent la situation actuelle.',
      [
        '① La liste des règles, de la plus acceptable à la moins acceptable, se lit comme un tableau. La première ligne, « Au départ, corrections imposées », compte les combattants à caser une fois faits les retours et les corrections de poids hors catégorie (et vos choix dans le plan). Chaque règle a sa barre : à gauche, en couleur, les combattants casés si on l’autorise avec toutes celles du dessus (la couleur est le coût de la règle qui les a casés) ; à droite, en rouge hachuré, ceux qui restent seuls. La barre pleine est le but.',
        'Rangez les règles, activez-les ou non, et placez la ligne « je m’arrête ici » (juste sous la première ligne : seulement les corrections imposées).',
        '« Voir le plan » liste les déplacements, du plus coûteux au moins coûteux. « Valider » confirme un déplacement à valider (il ne bougera plus), « Refuser » l’écarte, « Modifier » choisit une autre catégorie : le plan est recalculé à chaque fois, et chaque choix s’annule. Ces choix ne valent que pour le plan, sur ce poste : les cartes n’en voient rien. Les refus restent après « Appliquer le plan ».',
        '« Recommencer le plan » efface d’un coup vos validations, modifications et refus du plan ; rien de ce qui est appliqué ne change.',
        '« Tenir compte des décisions prises sur les cartes » : décochée, le plan ignore vos refus et vos mises de côté sur les cartes, et peut donc vous reproposer ces déplacements (les cartes, elles, restent telles quelles).',
        'Le calcul du plan se fait à part : une barre montre sa progression si elle dure, et « Annuler le calcul » l’arrête (le plan affiché ne tient alors pas compte de votre dernier changement ; « Relancer le calcul » le reprend).',
        '« Appliquer le plan » applique les déplacements sans validation et ceux que vous avez validés ; les autres restent en attente.',
        '② Chaque cas (combattant sans adversaire, poids hors catégorie…) reçoit des propositions, de la meilleure à la moins bonne. « Aperçu » montre qui rencontrera qui avant de valider. « Refuser » écarte une proposition de la carte (elle reste en grisé, « Rétablir » la reprend).',
        '« Déplacer manuellement vers… » ne liste que les catégories cohérentes avec les réglages (âge, poids, règlement, mixité). « Toutes les catégories » ajoute les autres, marquées « ⚠ N règles enfreintes » : le détail s’affiche avant de confirmer.',
      ],
      'Poids hors catégorie : la proposition « ⚖ Poids » l’envoie dans la catégorie de son poids réel. Si elle est vide, il y serait seul : elle passe alors en dernier, après les catégories où il aurait un adversaire (sa catégorie de poids est corrigée dans tous les cas).',
      'Sous le nom du combattant : sa tranche d’âge, sa discipline et son règlement, sa catégorie de poids, son poids (pesé ou approximatif) et les disciplines qu’il accepte.',
      'Catégorie fermée : le combattant est inscrit dans une catégorie que vous n’avez pas ouverte ; déplacez-le ou choisissez « Ne combat pas ».',
      'Split : un combattant seul peut aussi recevoir un combattant d’une autre catégorie (ou deux de la même, « pour donner une poule à… »), s’il en reste au moins deux au départ et si ce déplacement respecte les règles actives (âge, discipline, mixité, écart de poids…) : on propose d’abord les moins coûteux, puis les plus proches en poids. Jamais en kata. Sans autre règle que l’écart de poids réglé, c’est un cas simple.',
      'Badges : ⚖ Poids (catégorie de poids voisine), ⚖ Poids + (écart au-delà du seuil), ↑ Âge (tranche voisine), ⇄ Sen./Vét., ↑ Min./Adultes, ⚥ Mixte, Shobu → Jiyu, ⇄ Discipline, ↩ Retour, ✋ Manuel. Cliquez un badge validé pour son détail.',
      'Seul un déplacement qui ne change que la catégorie de poids, dans l’écart réglé, se fait sans validation ; tous les autres se valident à la main. « Pré-accord coach » rappelle que le club a accepté d’avance les déplacements d’âge et de poids.',
      'Avec des sessions : choisissez la session en haut de l’écran (la même que pour la pesée). Les cas, les compteurs et le plan d’ensemble ne portent que sur ses catégories.',
      'Le badge « ↪ change de session : Matin → Dimanche » signale une proposition qui ferait passer le combattant dans une catégorie d’une autre session. Elle n’est jamais appliquée sans votre validation : validez-la une par une. Le combattant repasse alors « non pesé » dans sa nouvelle session, à pointer à sa pesée ; son poids déjà relevé est gardé.',
      'Le badge « ↪ Emmène N autres combattants dans une autre session » signale un déplacement qui fait changer de session une catégorie entière (ses derniers combattants d’origine la quittent, par exemple) : mêmes règles, validation une par une, les combattants emmenés repassent « non pesés ».',
    ],
  },
  'recasement.de-cote': {
    title: 'Mises de côté',
    short: 'Une carte mise de côté ne compte plus dans les cas à traiter ni dans le plan d’ensemble : reprenez-la quand vous pouvez trancher.',
    details: [
      'Cliquez une ligne pour voir la carte complète : vous pouvez la traiter sans la reprendre.',
      'Si son problème disparaît (adversaire arrivé, poids corrigé), la carte disparaît aussi ; s’il revient, elle revient dans la liste principale.',
      'Le lancement de la session rappelle les cartes mises de côté.',
    ],
  },
  'recasement.valides': {
    title: 'Réaffectations validées',
    short: 'L’historique des déplacements ; vous pouvez annuler le plus récent d’un combattant.',
    details: [
      'Annuler remet le combattant dans sa catégorie d’avant. Impossible si sa catégorie a déjà commencé.',
      'Repartir de zéro annule d’un coup ce qui a été décidé depuis la session choisie (réaffectations, refus, cartes mises de côté) et efface cet historique ; les autres sessions ne bougent pas. Un combattant placé dans une session lancée ou une catégorie commencée reste où il est ; impossible si la session choisie est lancée.',
    ],
  },
  tableaux: {
    title: 'Tableaux',
    short: 'Les tableaux de chaque catégorie : vérifiez-les, changez le format si besoin, puis marquez-les prêts et imprimez.',
    details: [
      'Les tableaux se font tout seuls à partir des inscriptions, en séparant les combattants d’un même club au premier tour.',
      [
        'Provisoire (gris) : avant la pesée et la réaffectation. Prête (bleu) : vérifiée, on peut l’imprimer. Lancée (orange) : un résultat est saisi, le tableau est figé. Terminée (vert) : podium connu.',
        'Format, repêchage et combat pour la 3e place se changent tant que la catégorie n’est pas lancée.',
        'Cliquez deux combattants pour les échanger.',
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
      'Cliquez « Saisir » pour entrer le résultat d’un combat, « Noter » pour un kata (« n° 14 — Kata… » : toute la catégorie de kata sous un seul numéro). La liste avance au fur et à mesure.',
      '« pas de repos : prévoir une pause » : un combattant de ce combat sort juste du précédent ; laissez-lui le temps de souffler.',
    ],
  },
  'combats.resultat': {
    title: 'Saisir un résultat',
    short: 'Cliquez le vainqueur, choisissez la méthode, puis « Enregistrer ».',
    details: [
      [
        'Méthode : points, décision, KO (shobu seulement), abandon, disqualification ou forfait.',
        'Le score est facultatif (par exemple 3-1).',
        'Pour corriger : rouvrez le combat et choisissez l’autre vainqueur. Les combats suivants déjà joués deviennent « à revoir ».',
        '« Effacer le résultat » remet le combat à disputer (une confirmation est demandée).',
      ],
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
    short: 'Les podiums de chaque catégorie, le classement des clubs, les exports et les sauvegardes.',
    details: [
      'Un podium s’affiche quand sa catégorie est terminée.',
      [
        '« Imprimer les podiums » : une feuille pour la remise des médailles.',
        '« Feuilles de résultats » : les tableaux remplis, à archiver.',
        'Exports .ods ou .xlsx des podiums et de tous les résultats.',
      ],
    ],
  },
  'podiums.clubs': {
    title: 'Classement des clubs',
    short: 'Les médailles par club : or, puis argent, puis bronze.',
    details: ['Les combattants sans club ont leurs médailles dans les podiums, mais ne comptent pas dans ce classement.'],
  },
  'podiums.sauvegardes': {
    title: 'Sauvegardes',
    short: 'Une copie de la base est faite toute seule ; en cas de problème, on peut revenir à une sauvegarde.',
    details: [
      'Une sauvegarde est faite automatiquement toutes les 5 minutes quand quelque chose a changé ; les 200 dernières sont gardées (toute une journée de compétition). La liste montre les 10 plus récentes, la plus récente en haut.',
      [
        '« Sauvegarder maintenant » en fait une tout de suite.',
        'Pour revenir en arrière : cliquez « Télécharger » sur la sauvegarde voulue, puis « Restaurer une sauvegarde… » et choisissez ce fichier.',
        'La restauration remplace toutes les données (toutes les compétitions) par celles du fichier ; une copie de l’état actuel est faite juste avant.',
        '« Télécharger la base complète » : à garder sur une clé USB en fin de journée.',
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
      ],
      'L’app répartit les catégories de chaque session sur les zones qui accueillent leur discipline, en équilibrant le nombre de combats. Dans l’onglet Combats, vous pouvez épingler une catégorie sur une zone : ce choix l’emporte. Le nom de la zone est imprimé sur les tableaux.',
    ],
  },
  'reglages.ordre': {
    title: 'Ordre de passage',
    short: 'Chaque zone numérote ses combats : kata d’abord, puis les combats tour par tour (par défaut) ou catégorie par catégorie.',
    details: [
      [
        'Tour par tour : les tours sont alignés à partir de la fin (toutes les finales ensemble, toutes les demies ensemble…) ; on passe un tour de toutes les catégories de la zone avant le suivant, et les finales à la fin de la session. Les combattants ont ainsi le plus de repos possible.',
        'Catégorie par catégorie : une catégorie va jusqu’à sa finale, puis la suivante (dans l’ordre saisi dans l’onglet Combats, sinon celui de la grille).',
        'Chaque catégorie de kata forme un seul numéro, avant les combats de sa session.',
        'Les numéros se suivent d’une session à l’autre sur une même zone. Une exemption n’a pas de numéro.',
        'Quand un combattant enchaîne deux combats sans repos, le combat porte « pas de repos : prévoir une pause ».',
        '« Finales sur la zone » : le combat pour la 1re place de chaque catégorie passe sur cette zone, à la fin de la session, l’un après l’autre (le tableau imprimé l’indique). Les combats pour la 3e place et les repêchages restent sur leur zone. Option : les finales de kata aussi (le tour 1 reste sur sa zone).',
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
        'Écart de poids max (enfants et adultes séparément) : jusqu’à cet écart, un déplacement vers un poids voisin est sans risque ; au-delà, il reste proposé mais se valide à la main (badge « ⚖ Poids + »).',
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
  'reglages.kata': {
    title: 'Kata et triathlon',
    short: 'Le nombre de médailles de bronze en kata et le nombre de rounds du triathlon.',
    details: ['Kata : un ou deux bronzes (les suivants du tour 1).'],
  },
  grille: {
    title: 'Grille âge / poids',
    short: 'Les tranches d’âge et les catégories de poids de la compétition ; la grille FFK est déjà remplie.',
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
    short: 'Décochez une case pour ne pas ouvrir cette catégorie : elle disparaît de la fiche club et de l’inscription en ligne.',
    details: [
      'Une case = une tranche d’âge, un sexe, une discipline et son règlement. Le réglage vaut pour cette compétition seulement ; tout est ouvert au départ.',
      'Les combattants déjà inscrits dans une catégorie que vous fermez apparaissent en Réaffectation : vous les déplacez ou choisissez « Ne combat pas ».',
      'Une catégorie déjà lancée ne se ferme plus. La case d’une ligne (ou d’une colonne) ferme ou rouvre toute la ligne.',
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
