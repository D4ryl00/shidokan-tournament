import { Button, Group, NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useAuthMe, useProbeMain, useSetZoneLink, useZoneLink } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

/** Réglages de l'application (portable de zone) : adresse du PC principal, compétition et zone suivies. */
export function ZoneLinkCard() {
  const { data: me } = useAuthMe();
  const local = me?.role === 'local';
  const { data } = useZoneLink(local);
  const probe = useProbeMain();
  const set = useSetZoneLink();
  const [url, setUrl] = useState<string | null>(null);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  if (!local || !data) return null;
  const shownUrl = url ?? data.link?.mainUrl ?? '';
  const competitions = probe.data?.competitions ?? [];
  const shownCompetition = competitionId ?? data.link?.competitionId ?? competitions[0]?.id ?? '';
  const zones = competitions.find((c) => c.id === shownCompetition)?.zones ?? [];
  const shownZone = zoneId ?? (data.link?.competitionId === shownCompetition ? data.link.zoneId : null) ?? zones[0]?.id ?? '';
  const autonomous = !!data.link?.autonomous;
  return (
    <Stack>
      <Text size="sm">
        Sur le PC portable d’une zone, gardez une copie de la compétition du PC principal, à jour dans les secondes qui suivent chaque changement. Si le réseau tombe, la zone pourra continuer
        sur ce portable (écran de la compétition, « Continuer sans réseau »).
      </Text>
      <Group align="end">
        <TextInput data-testid="zone-link-url" label="Adresse du PC principal" placeholder="http://192.168.1.10:3000" value={shownUrl} onChange={(e) => setUrl(e.currentTarget.value)} w={300} disabled={autonomous} />
        <Button variant="light" data-testid="zone-link-probe" loading={probe.isPending} disabled={!shownUrl.trim() || autonomous} onClick={() => probe.mutate(shownUrl.trim())}>
          Chercher
        </Button>
      </Group>
      {competitions.length > 0 && (
        <Group align="end">
          <NativeSelect data-testid="zone-link-competition" label="Compétition" data={competitions.map((c) => ({ value: c.id, label: c.name }))} value={shownCompetition}
            onChange={(e) => { setCompetitionId(e.currentTarget.value); setZoneId(null); }} w={260} />
          <NativeSelect data-testid="zone-link-zone" label="Zone de ce portable" data={zones.map((z) => ({ value: z.id, label: z.name }))} value={shownZone}
            onChange={(e) => setZoneId(e.currentTarget.value)} w={200} />
          <Button data-testid="zone-link-save" loading={set.isPending} disabled={!shownZone}
            onClick={() => set.mutate({ mainUrl: shownUrl.trim(), competitionId: shownCompetition, zoneId: shownZone }, { onSuccess: () => notifications.show({ color: 'green', message: 'Portable relié au PC principal.' }) })}>
            Enregistrer
          </Button>
        </Group>
      )}
      {data.link && (
        <Group>
          <Text size="sm" c={data.status.lastError ? 'red' : 'dimmed'} data-testid="zone-link-status">
            {data.zoneName ? `Zone ${data.zoneName} — ` : ''}
            {data.status.lastError ?? (data.status.lastCopyAt ? `Copie à jour à ${new Date(data.status.lastCopyAt).toLocaleTimeString('fr-FR')}` : 'Copie en cours…')}
          </Text>
          {!autonomous && (
            <Button size="xs" variant="subtle" color="gray" loading={set.isPending} onClick={() => set.mutate(null, { onSuccess: () => notifications.show({ message: 'Portable délié du PC principal.' }) })}>
              Délier
            </Button>
          )}
        </Group>
      )}
      <ApiErrorAlert error={probe.error ?? set.error} />
    </Stack>
  );
}
