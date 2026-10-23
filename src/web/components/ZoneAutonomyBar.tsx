import { Alert, Anchor, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { ApiError, downloadZoneJournal, useAuthMe, useGoOnline, useManagement, useStartAutonomy, useStopAutonomy, useZoneLink } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { journalReportText } from './ZoneCards.js';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Un geste confirmé : le texte dit ce qui va se passer. */
function Confirmed({ label, text, onConfirm, loading, testId, color, variant = 'filled' }: { label: string; text: string; onConfirm: () => void; loading: boolean; testId: string; color?: string; variant?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant={variant} color={color} data-testid={testId} loading={loading} onClick={() => setOpen(true)}>{label}</Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={label}>
        <Stack>
          <Text size="sm">{text}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>Annuler</Button>
            <Button color={color} data-testid={`${testId}-confirm`} onClick={() => { setOpen(false); onConfirm(); }}>{label}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** Portable de zone, en haut de l'écran de la compétition qu'il suit : passer en zone autonome, et en revenir. */
export function ZoneAutonomyBar({ competitionId }: { competitionId: string }) {
  const { data: me } = useAuthMe();
  const { data } = useZoneLink(me?.role === 'local');
  const { data: m } = useManagement(competitionId);
  const start = useStartAutonomy();
  const online = useGoOnline();
  const stop = useStopAutonomy();
  const [exported, setExported] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [back, setBack] = useState<string | null>(null);
  const link = data?.link;
  if (!link || link.competitionId !== competitionId) return null;
  const name = data.zoneName ?? 'de ce portable';
  if (back && !link.autonomous) {
    return (
      <Alert color="green" data-testid="zone-back-online" withCloseButton onClose={() => setBack(null)}>
        Journal renvoyé. Rouvrez maintenant le PC principal dans ce navigateur : <Anchor href={back} data-testid="zone-open-main">Ouvrir le PC principal</Anchor>
      </Alert>
    );
  }
  if (!link.autonomous) {
    if (!m?.copyOfMain) return null;
    return (
      <Group>
        <Confirmed label={`Continuer sans réseau (zone ${name})`} testId="zone-autonomous" color="orange" variant="light" loading={start.isPending}
          text={`À utiliser seulement si le réseau est coupé. Ce portable devient la zone ${name} : seules les saisies de cette zone sont possibles ici, chacune est notée pour être renvoyée au PC principal au retour du réseau (ou par clé USB).`}
          onConfirm={() => start.mutate()} />
        <ApiErrorAlert error={start.error} />
      </Group>
    );
  }
  const pending = data.pending;
  return (
    <Alert color="orange" data-testid="zone-autonomy-bar" title={`Zone autonome ${name} depuis ${hhmm(link.autonomous.since)} — ${pending} saisie${pending > 1 ? 's' : ''} à renvoyer`}>
      <Group gap="xs">
        <Button size="xs" data-testid="zone-online" loading={online.isPending}
          onClick={() => online.mutate(undefined, {
            onSuccess: (r) => {
              notifications.show({ color: r.report.conflicts + r.report.waiting > 0 ? 'orange' : 'green', message: journalReportText(r.zoneName, r.report), autoClose: false });
              setBack(r.mainUrl);
            },
          })}>
          Repasser en ligne
        </Button>
        <Button size="xs" variant="default" data-testid="zone-journal-export"
          onClick={() => downloadZoneJournal().then(() => { setExported(true); setExportError(null); }, setExportError)}>
          Exporter le journal (fichier)
        </Button>
        {exported && (
          <Confirmed label="Arrêter la zone autonome" testId="zone-stop" color="red" variant="subtle" loading={stop.isPending}
            text="Importez le fichier exporté sur le PC principal (onglet Combats, « Importer un journal de zone (fichier) »). Ce qui serait saisi ici ensuite ne serait pas dans le fichier : ce portable redevient une copie en lecture seule."
            onConfirm={() => stop.mutate(undefined, { onSuccess: () => setExported(false) })} />
        )}
      </Group>
      {online.error instanceof ApiError && online.error.status === 502 && (
        <Text size="sm" mt="xs" c="red">{online.error.message} La zone reste autonome et rien n’est perdu : réessayez plus tard, ou exportez le journal (fichier).</Text>
      )}
      {!(online.error instanceof ApiError && online.error.status === 502) && <ApiErrorAlert error={online.error} />}
      <ApiErrorAlert error={exportError ?? stop.error} />
    </Alert>
  );
}
