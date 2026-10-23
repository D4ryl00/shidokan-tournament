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
];

/** Fiche « Préparer le jour J » : la liste à cocher et l'adresse à ouvrir sur les autres postes. */
export function DayChecklist() {
  const [done, setDone] = useState<boolean[]>(STEPS.map(() => false));
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
      {STEPS.map((step, i) => (
        <Checkbox key={step} label={step} checked={done[i]} onChange={(e) => setDone((d) => d.map((x, j) => (j === i ? e.currentTarget.checked : x)))} />
      ))}
    </Stack>
  );
}
