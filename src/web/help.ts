/**
 * Textes d'aide de l'app, regroupés ici pour être relus d'un coup.
 * `short` : une phrase visible sous le titre. `details` : l'aide complète du bouton ⓘ
 * (un texte = un paragraphe ; un tableau de textes = une liste à puces).
 */
export type HelpTopicId =
  | 'competitions'
  | 'impression'
  | 'inscriptions'
  | 'clubs'
  | 'fiche-club'
  | 'import-ffk'
  | 'pesee'
  | 'recasement'
  | 'tableaux'
  | 'combats'
  | 'podiums'
  | 'reglages'
  | 'grille'
  | 'fiche-club.envoyer'
  | 'fiche-club.importer'
  | 'import-ffk.clubs'
  | 'import-ffk.rapprochements'
  | 'import-ffk.mises-a-jour'
  | 'import-ffk.creations'
  | 'recasement.valides'
  | 'combats.categories'
  | 'combats.zone'
  | 'combats.resultat'
  | 'combats.kata'
  | 'podiums.clubs'
  | 'podiums.sauvegardes'
  | 'reglages.competition'
  | 'reglages.recasement'
  | 'reglages.pesee'
  | 'reglages.tableaux'
  | 'reglages.kata'
  | 'grille.poids'
  | 'grille.tranches'
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
        '« Nouvelle compétition » : nom, date, lieu, nombre de tatamis. Une grille enregistrée comme modèle peut servir de point de départ.',
        'Cliquez le nom d’une compétition pour l’ouvrir.',
      ],
      'Ordre habituel : réglages et grille, fiche club envoyée aux clubs, inscriptions, import FFK, pesée, recasement, tableaux, combats, podiums.',
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
      ],
      'La colonne « Origine » indique d’où vient la ligne : fiche club, export FFK ou saisie.',
    ],
  },
  clubs: {
    title: 'Clubs',
    short: 'Les clubs, leur coach et leur pré-accord pour les recasements.',
    details: [
      'Les clubs sont créés par l’import des fiches club, par l’import FFK ou par la saisie des inscriptions.',
      [
        'Coach : nom, téléphone et e-mail, pour le joindre le jour J.',
        'Pré-accord : le coach accepte d’avance qu’on recase ses combattants. Les propositions qui demanderaient son accord sont alors marquées « pré-accord coach ».',
      ],
    ],
  },
  'fiche-club': {
    title: 'Fiche club',
    short: 'Envoyez le modèle de fiche aux clubs, puis importez chaque fiche qu’ils vous renvoient.',
    details: [
      'La fiche club apporte ce que l’export FFK n’a pas : les préférences de discipline, l’accord pour le jiyu, le poids approximatif et le coach.',
      'Elle part plusieurs semaines avant la compétition ; l’export FFK n’arrive qu’à la clôture des inscriptions.',
    ],
  },
  'fiche-club.envoyer': {
    title: '1. Envoyer le modèle aux clubs',
    short: 'Téléchargez le modèle (.ods) et envoyez-le aux clubs par e-mail.',
    details: [
      'Le modèle contient des listes déroulantes (sexe, tranche d’âge, discipline, règlement, oui / non) ; le poids s’écrit à la main (-35, +65…). Il s’ouvre avec LibreOffice ou Excel.',
      'Les clubs le remplissent, une ligne par combattant et par discipline, puis vous le renvoient.',
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
      'Le badge « ⚖ hors catégorie → … » signale un combattant trop lourd pour sa catégorie (au-delà de la tolérance) et indique celle de son poids ; le recasement s’en occupera.',
      'La mention « recasé » indique un combattant déjà déplacé dans une autre catégorie.',
      '« Clôturer la pesée » marque absents tous les combattants non pesés. À faire une fois la pesée terminée.',
      'Les feuilles de pesée (par club ou par catégorie) s’impriment pour peser sur papier.',
    ],
  },
  recasement: {
    title: 'Recasement',
    short: 'Trouvez une place à chaque combattant seul ou hors de sa catégorie : choisissez une proposition, regardez l’aperçu, validez.',
    details: [
      'Chaque cas (combattant sans adversaire, poids hors catégorie…) reçoit des propositions, de la meilleure à la moins bonne.',
      [
        '« Aperçu » montre qui rencontrera qui avant de valider.',
        '« Refuser » écarte une proposition (elle reste en grisé, « Rétablir » la reprend).',
        '« Classer automatiquement tous les cas simples » valide d’un coup les propositions sans risque (poids voisin, retour dans la catégorie d’origine) ; « Tout classer automatiquement » valide aussi les autres, sous votre responsabilité.',
        '« Déplacer manuellement vers… » place un combattant où vous voulez, avec les règles enfreintes affichées.',
      ],
      'Badges : ⚖ Poids (catégorie de poids voisine), ⚖ Poids + (écart au-delà du seuil), ↑ Âge (tranche au-dessus), ⇄ Sen./Vét., ↑ Min./Adultes, ⚥ Mixte, Shobu → Jiyu, ⇄ Discipline, ↩ Retour, ✋ Manuel. Cliquez un badge validé pour son détail.',
      'Certains déplacements demandent normalement l’accord des coachs ; en les validant vous en prenez la responsabilité.',
    ],
  },
  'recasement.valides': {
    title: 'Recasements validés',
    short: 'L’historique des déplacements ; vous pouvez annuler le plus récent d’un combattant.',
    details: ['Annuler remet le combattant dans sa catégorie d’avant. Impossible si sa catégorie a déjà commencé.'],
  },
  tableaux: {
    title: 'Tableaux',
    short: 'Les tableaux de chaque catégorie : vérifiez-les, changez le format si besoin, puis marquez-les prêts et imprimez.',
    details: [
      'Les tableaux se font tout seuls à partir des inscriptions, en séparant les combattants d’un même club au premier tour.',
      [
        'Provisoire : avant la pesée et le recasement. Prête : vérifiée, on peut l’imprimer. Lancée : un résultat est saisi, le tableau est figé. Terminée : podium connu.',
        'Format, repêchage et combat pour la 3e place se changent tant que la catégorie n’est pas lancée.',
        'Cliquez deux combattants pour les échanger.',
        '« Déverrouiller » rouvre une catégorie lancée (le tableau peut être refait si ses inscrits ont changé).',
      ],
      'Les catégories « Sans adversaire » ou « Tous absents » ne sont pas imprimées.',
    ],
  },
  combats: {
    title: 'Combats',
    short: 'Cliquez une catégorie, puis un combat, pour saisir son résultat : le vainqueur avance tout seul.',
    details: [
      [
        'À gauche : les catégories et leur tatami. À droite : par tatami, les prochains combats.',
        'Cliquez un combat du tableau pour saisir le vainqueur et la méthode.',
        'Une égalité de poule ou de kata s’affiche avec « Départager » : classez les ex-æquo.',
        'Un résultat corrigé rend « à revoir » les combats suivants déjà joués : ils sont encadrés en orange.',
      ],
    ],
  },
  'combats.categories': {
    title: 'Catégories et tatamis',
    short: 'Choisissez le tatami et l’ordre de passage de chaque catégorie ; cliquez une catégorie pour l’ouvrir.',
    details: ['L’ordre fixe la place de la catégorie dans la file de son tatami. Une catégorie sans tatami n’apparaît pas dans les files.'],
  },
  'combats.zone': {
    title: 'Prochains combats du tatami',
    short: 'Les combats à appeler sur ce tatami, dans l’ordre.',
    details: ['Cliquez « Saisir » pour entrer le résultat d’un combat. La liste avance au fur et à mesure.'],
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
    short: 'Les informations de la compétition et ses règles : recasement, pesée, formats de tableaux, kata.',
    details: [
      'Ces réglages valent pour toute la compétition. Cliquez « Enregistrer » en bas de page après vos changements.',
      'Changer un format ou une option refait les tableaux qui ne sont pas encore lancés.',
    ],
  },
  'reglages.competition': {
    title: 'Compétition',
    short: 'Nom, date, lieu et nombre de tatamis.',
    details: ['Le nombre de tatamis fixe les choix proposés dans l’onglet Combats.'],
  },
  'reglages.recasement': {
    title: 'Recasement',
    short: 'Jusqu’où le recasement peut aller : écart de poids et mélanges autorisés.',
    details: [
      [
        'Écart de poids max (enfants et adultes séparément) : jusqu’à cet écart, un déplacement vers un poids voisin est sans risque ; au-delà, il reste proposé mais se valide à la main (badge « ⚖ Poids + »).',
        'Mélange mineurs / adultes, seniors / vétérans, filles / garçons : chaque mélange coché peut être proposé, mais se valide à la main.',
        'Filles / garçons : seulement dans les tranches d’âge cochées.',
        'Plusieurs disciplines de combat le même jour : permet à un combattant d’être inscrit en karaté et en shido-boxing, par exemple.',
      ],
    ],
  },
  'reglages.pesee': {
    title: 'Pesée',
    short: 'La tolérance ajoutée à la limite de poids avant de déclarer un combattant hors catégorie.',
    details: ['Règlement FFK : 300 g pour les hommes, 500 g pour les femmes. Seul un combattant trop lourd est hors catégorie.'],
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
    details: ['La case « Mineurs » sépare mineurs et adultes : ils ne sont jamais mélangés, sauf si le réglage le permet.'],
  },
  'grille.passages': {
    title: 'Passages d’âge autorisés',
    short: 'Vers quelle tranche d’âge un combattant peut être recasé quand il est seul dans la sienne.',
    details: [
      'Le recasement ne propose de changer de tranche d’âge que par un passage de cette liste (par exemple Minimes → Cadets).',
      [
        '« Toujours permis » : le passage est proposé dès qu’il est utile (tranche voisine).',
        '« Seulement si le mélange seniors / vétérans est activé » : le passage dépend de ce réglage (onglet Réglages, section Recasement).',
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
