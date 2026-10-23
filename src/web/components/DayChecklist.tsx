import { Checkbox, Code, Stack, Text } from '@mantine/core';
import { useState } from 'react';

const STEPS = [
  'Un routeur Wi-Fi pour la salle (internet pas nécessaire), avec un mot de passe.',
  'Une adresse fixe pour le PC principal (réservation dans le routeur), pour que les postes la gardent toute la journée.',
  'Pare-feu Windows : autoriser les connexions entrantes sur le port 3000.',
  'PC principal toujours branché, sans mise en veille (écran et disque).',
  'Windows Update suspendu pour la journée (pas de redémarrage automatique).',
  'Ne jamais quitter Docker Desktop sur le PC principal : fermer le navigateur ne pose aucun problème, quitter Docker arrête tout.',
  'Sur chaque poste, ouvrir l’adresse ci-dessous et choisir son poste en haut de l’écran de la compétition.',
  'Si possible, un second PC avec la copie de secours réglée (Réglages de l’application).',
  'Portables de zone (si vous en avez) : chacun relié au PC principal (Réglages de l’application → Portable de zone). Si le réseau tombe : « Continuer sans réseau » sur le portable ; au retour, « Repasser en ligne » (ou le journal par clé USB).',
  'Sur chaque poste, peu d’onglets de compétition ouverts à la fois : un navigateur n’ouvre que 6 connexions vers le PC principal (les onglets cachés libèrent la leur).',
];

/** Jour J tout en ligne : ce qu'il faut en plus, et le secours par le PC si internet tombe. */
const ONLINE_STEPS = [
  'Jour J en ligne : un compte Zone par zone de la compétition, et un compte Table centrale (menu Comptes du serveur).',
  'Jour J en ligne : le PC de la salle relié au serveur, avec « Garder cette copie à jour » coché sur la compétition.',
  'Si internet tombe : sur le PC, « Prendre la main en secours », puis les postes ouvrent l’adresse du PC ; quand internet revient, « Prévenir le serveur ».',
];

/** Fiche « Préparer le jour J » : la liste à cocher et l'adresse à ouvrir sur les autres postes. */
export function DayChecklist() {
  const [done, setDone] = useState<boolean[]>([...STEPS, ...ONLINE_STEPS].map(() => false));
  const here = window.location.hostname;
  const local = here === 'localhost' || here === '127.0.0.1' || here === '[::1]';
  return (
    <Stack gap="xs">
      <Text size="sm">Adresse à ouvrir sur les autres postes :</Text>
      {local ? (
        <Text size="sm" data-testid="day-address">
          Ouvrez l’application depuis l’adresse du PC sur le réseau (dans Windows : <Code>ipconfig</Code>, ligne « Adresse IPv4 ») : <Code>http://&lt;adresse&gt;:3000</Code>
        </Text>
      ) : (
        <Text fz={28} fw={700} data-testid="day-address">{window.location.origin}</Text>
      )}
      {[...STEPS, ...ONLINE_STEPS].map((step, i) => (
        <Checkbox key={step} label={step} checked={done[i]} onChange={(e) => setDone((d) => d.map((x, j) => (j === i ? e.currentTarget.checked : x)))} />
      ))}
    </Stack>
  );
}
