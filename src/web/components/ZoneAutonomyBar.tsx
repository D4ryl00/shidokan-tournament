import { Alert, Anchor, Button, FileButton, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { ApiError, downloadZoneJournal, useAuthMe, useGoOnline, useManagement, usePlayFinalsHere, useRefreshZoneCopy, useStartAutonomy, useStopAutonomy, useZoneLink } from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { journalReportText } from './ZoneCards.js';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const rebaseText = (r: { reapplied: number; present: number; conflicts: number }) =>
  `Nouvelle copie prise : ${plural(r.reapplied, 'saisie réappliquée', 'saisies réappliquées')}, ${plural(r.present, 'déjà présente', 'déjà présentes')}, ${r.conflicts} en conflit (elles seront tranchées à la table centrale).`;

/** « Recevoir une copie plus récente » : par le réseau s'il revient un moment, ou avec un fichier de compétition (clé USB). */
function RefreshCopy() {
  const refresh = useRefreshZoneCopy();
  const [open, setOpen] = useState(false);
  const run = (pkg: unknown) =>
    refresh.mutate(pkg, { onSuccess: (r) => { setOpen(false); notifications.show({ color: r.conflicts > 0 ? 'orange' : 'green', message: rebaseText(r), autoClose: false }); } });
  const onFile = async (file: File | null) => {
    if (!file) return;
    try {
      run(JSON.parse(await file.text()));
    } catch {
      notifications.show({ color: 'red', message: 'Ce fichier n’est pas une compétition exportée par l’application.' });
    }
  };
  return (
    <>
      <Button size="xs" variant="light" data-testid="zone-refresh" onClick={() => setOpen(true)}>Recevoir une copie plus récente</Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Recevoir une copie plus récente">
        <Stack>
          <Text size="sm">
            La copie de ce portable est remplacée par une version plus récente du PC principal (par exemple après le retour des journaux des autres zones), puis les saisies
            de ce portable pas encore renvoyées sont réappliquées dessus. Elles restent à renvoyer.
          </Text>
          <Group justify="flex-end">
            <FileButton onChange={onFile} accept="application/json,.json">
              {(props) => <Button variant="default" loading={refresh.isPending} {...props}>Avec un fichier</Button>}
            </FileButton>
            <Button data-testid="zone-refresh-network" loading={refresh.isPending} onClick={() => run(null)}>Par le réseau</Button>
          </Group>
          <ApiErrorAlert error={refresh.error} />
        </Stack>
      </Modal>
    </>
  );
}

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
  const finals = usePlayFinalsHere();
  // Dernière saisie du fichier exporté (null : pas encore exporté) : « Arrêter » est refusé si une saisie a suivi l'export.
  const [exported, setExported] = useState<number | null>(null);
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
          onClick={() => downloadZoneJournal().then((seq) => { setExported(seq); setExportError(null); }, setExportError)}>
          Exporter le journal (fichier)
        </Button>
        {!link.autonomous.finals && (
          <Confirmed label="Jouer ici les finales de mes catégories" testId="zone-finals" variant="light" loading={finals.isPending}
            text="Les finales de vos catégories se joueront ici, même si une zone des finales est prévue. Si elle les joue aussi, la table centrale tranchera."
            onConfirm={() => finals.mutate()} />
        )}
        <RefreshCopy />
        {exported !== null && (
          <Confirmed label="Arrêter la zone autonome" testId="zone-stop" color="red" variant="subtle" loading={stop.isPending}
            text="Importez le fichier exporté sur le PC principal (onglet Combats, « Importer un journal de zone (fichier) »). Ce qui serait saisi ici ensuite ne serait pas dans le fichier : ce portable redevient une copie en lecture seule."
            onConfirm={() => stop.mutate(exported, { onSuccess: () => setExported(null) })} />
        )}
      </Group>
      {online.error instanceof ApiError && online.error.status === 502 && (
        <Text size="sm" mt="xs" c="red">{online.error.message} La zone reste autonome et rien n’est perdu : réessayez plus tard, ou exportez le journal (fichier).</Text>
      )}
      {!(online.error instanceof ApiError && online.error.status === 502) && <ApiErrorAlert error={online.error} />}
      <ApiErrorAlert error={exportError ?? stop.error ?? finals.error} />
    </Alert>
  );
}
