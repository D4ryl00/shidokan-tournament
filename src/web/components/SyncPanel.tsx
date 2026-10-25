import { Alert, Anchor, Button, Checkbox, CopyButton, FileButton, Group, Modal, NumberInput, Radio, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ApiError,
  useAuthMe,
  useCreateSyncToken,
  useExportHandOver,
  useImportCompetition,
  useUnlinkSync,
  useManagement,
  usePull,
  useReceivedCopies,
  useRescue,
  useRescueNotify,
  useRevokeSyncToken,
  useServerCompetitions,
  useSetSyncFollow,
  useSyncFollow,
  useSyncCopy,
  useSyncReturn,
  useSyncSettings,
  useSyncTokens,
  useTakeBack,
  useUpdateSyncSettings,
  type Management,
} from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { StatusBadge } from './ui/StatusBadge.js';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

/** Texte du bandeau : où est la main sur la compétition. */
export function managementText(m: Management): string {
  if (m.managedHere && m.rescueSince) return `Gérée ici en secours depuis le ${when(m.rescueSince)} — le serveur n’est pas encore prévenu`;
  if (m.managedHere) return m.lastSyncAt ? `Gérée ici — dernier échange avec le serveur le ${when(m.lastSyncAt)}` : 'Gérée ici';
  if (m.copyOfMain) return `Copie du PC principal — à jour à ${m.lastSyncAt ? new Date(m.lastSyncAt).toLocaleTimeString('fr-FR') : '—'} — lecture seule`;
  if (m.copyOfServer) {
    const held = m.ownerName?.match(/— la main est à (.+)$/)?.[1];
    return `Copie du serveur — synchronisé le ${when(m.lastSyncAt)} — lecture seule${held ? ` (la main est à ${held})` : ''}`;
  }
  return `Gérée par ${m.ownerName ?? 'une autre installation'} depuis le ${day(m.ownerSince)} — lecture seule`;
}

/** Puce courte de la barre d'une compétition : où est la main (le texte complet au survol). */
export function managementChipLabel(m: Management): { label: string; tone: 'ok' | 'warn' } {
  if (m.managedHere) return m.rescueSince ? { label: 'En secours', tone: 'warn' } : { label: 'Gérée ici', tone: 'ok' };
  if (m.copyOfMain) return { label: 'Copie du PC principal', tone: 'warn' };
  if (m.copyOfServer) return { label: 'Copie du serveur', tone: 'warn' };
  return { label: 'Lecture seule', tone: 'warn' };
}

export function ManagementChip({ competitionId }: { competitionId: string }) {
  const { data } = useManagement(competitionId);
  if (!data) return null;
  const { label, tone } = managementChipLabel(data);
  // Gérée ici sans rien à signaler : la puce est le seul bandeau.
  const plain = data.managedHere && !data.rescueSince;
  return (
    <StatusBadge tone={tone} size="lg" title={managementText(data)} data-testid={plain ? 'management-banner' : 'management-chip'} style={{ flexShrink: 0 }}
      leftSection={<span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />}>
      {label}
    </StatusBadge>
  );
}

/** Bandeau sous les onglets, quand la main demande l'attention (lecture seule, secours). */
export function ManagementBanner({ competitionId }: { competitionId: string }) {
  const { data } = useManagement(competitionId);
  if (!data || (data.managedHere && !data.rescueSince)) return null;
  return <Alert color={data.managedHere ? 'orange' : 'yellow'} data-testid="management-banner">{managementText(data)}</Alert>;
}

/** Une action qui change la main : confirmation avec le texte de ce qui va se passer. */
function Confirmed({ label, text, onConfirm, loading, testId, color }: { label: string; text: string; onConfirm: () => void; loading: boolean; testId: string; color?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="light" color={color} data-testid={testId} loading={loading} onClick={() => setOpen(true)}>{label}</Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={label}>
        <Stack>
          <Text size="sm">{text}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setOpen(false)}>Annuler</Button>
            <Button data-testid={`${testId}-confirm`} onClick={() => { setOpen(false); onConfirm(); }}>{label}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** Section « Échanges avec le serveur » des réglages d'une compétition. */
export function SyncPanel({ competitionId }: { competitionId: string }) {
  const { data: me } = useAuthMe();
  const { data: m } = useManagement(competitionId);
  const { data: settings } = useSyncSettings(me?.role === 'local');
  const pull = usePull();
  const copy = useSyncCopy(competitionId);
  const back = useSyncReturn(competitionId);
  const takeBack = useTakeBack(competitionId);
  const rescue = useRescue(competitionId);
  const notify = useRescueNotify(competitionId);
  const diverged = notify.error instanceof ApiError && notify.error.code === 'RESCUE_DIVERGED';
  const server = me?.role === 'serveur';
  const copies = useReceivedCopies(competitionId, server && !!m && !m.managedHere);
  const [source, setSource] = useState<'server' | 'lastCopy'>('server');
  const [handOver, setHandOver] = useState(false);
  const exportHandOver = useExportHandOver(competitionId);
  if (!m) return null;
  const linked = !server && !!settings?.url && settings.hasToken;
  const done = (message: string) => () => notifications.show({ color: 'green', message });

  return (
    <Stack data-testid="sync-panel">
      <Text fw={600}>{managementText(m)}</Text>
      {!server && !linked && <Text size="sm" c="dimmed">Ce PC n’est pas relié au serveur (Réglages de l’application → Synchronisation) : les échanges se font par fichier.</Text>}
      {linked && m.copyOfServer && <FollowControl competitionId={competitionId} />}
      {linked && m.copyOfServer && (
        <Group>
          <Button variant="light" data-testid="sync-refresh" loading={pull.isPending && !pull.variables?.take}
            onClick={() => pull.mutate({ competitionId, take: false }, { onSuccess: done('Copie mise à jour.') })}>Récupérer une copie</Button>
          <Confirmed testId="sync-take" label="Prendre la main" loading={pull.isPending && !!pull.variables?.take}
            text="Ce PC devient le seul endroit où modifier la compétition. En ligne, elle passe en lecture seule et les inscriptions des clubs sont figées."
            onConfirm={() => pull.mutate({ competitionId, take: true }, { onSuccess: done('Ce PC a la main sur la compétition.') })} />
          <Confirmed testId="sync-rescue" color="red" label="Prendre la main en secours" loading={rescue.isPending}
            text="À utiliser seulement si le serveur est injoignable (internet coupé). Ce PC devient modifiable tout de suite, sans prévenir le serveur : faites passer toutes les saisies sur ce réseau. Quand internet revient, cliquez « Prévenir le serveur »."
            onConfirm={() => rescue.mutate(undefined, { onSuccess: done('Ce PC a la main en secours : prévenez le serveur dès qu’internet revient.') })} />
        </Group>
      )}
      {linked && m.managedHere && m.rescueSince && (
        <Stack gap="xs">
          <Group>
            <Button data-testid="sync-rescue-notify" loading={notify.isPending && notify.variables === false}
              onClick={() => notify.mutate(false, { onSuccess: done('Le serveur est prévenu : ce PC a la main.') })}>Prévenir le serveur</Button>
          </Group>
          {diverged && (
            <Alert color="orange">
              <Stack gap="xs">
                <Text size="sm">{notify.error!.message}</Text>
                <Group>
                  <Confirmed testId="sync-rescue-replace" color="red" label="Remplacer la version en ligne" loading={notify.isPending && notify.variables === true}
                    text="La version de ce PC remplace celle du serveur, et la main passe à ce PC. Ce qui a été saisi en ligne depuis la dernière copie de ce PC n’est plus visible (il reste dans une sauvegarde du serveur)."
                    onConfirm={() => notify.mutate(true, { onSuccess: done('La version de ce PC est en ligne : ce PC a la main.') })} />
                </Group>
              </Stack>
            </Alert>
          )}
        </Stack>
      )}
      {linked && m.managedHere && !m.rescueSince && (
        <Group>
          <Button variant="light" data-testid="sync-copy" loading={copy.isPending} onClick={() => copy.mutate(undefined, { onSuccess: done('Copie envoyée au serveur.') })}>
            Envoyer une copie au serveur
          </Button>
          <Confirmed testId="sync-return" label="Rendre la main au serveur" loading={back.isPending}
            text="Le serveur reprend la compétition entière, avec ses résultats. Sur ce PC, elle passera en lecture seule."
            onConfirm={() => back.mutate(undefined, { onSuccess: done('La main est rendue au serveur.') })} />
        </Group>
      )}
      {server && !m.managedHere && (
        <Stack gap="xs">
          <Radio.Group value={source} onChange={(v) => setSource(v as 'server' | 'lastCopy')} label="Reprendre la main à partir de">
            <Group mt={4}>
              <Radio value="server" label="la version du serveur (d’avant la prise de main)" />
              <Radio value="lastCopy" disabled={!copies.data?.length} label={copies.data?.length ? `la dernière copie reçue (${when(copies.data[0]!.receivedAt)})` : 'la dernière copie reçue (aucune)'} />
            </Group>
          </Radio.Group>
          <Group>
            <Confirmed testId="take-back" color="red" label="Reprendre la main" loading={takeBack.isPending}
              text={`À utiliser si le PC est perdu ou en panne. Le serveur reprend la main ; le PC ne pourra plus la rendre (il pourra encore exporter un fichier).`}
              onConfirm={() => takeBack.mutate(source, { onSuccess: done('Le serveur a repris la main.') })} />
          </Group>
        </Stack>
      )}
      <Group>
        {handOver ? (
          <Confirmed testId="export-handover" label="Exporter la compétition (fichier)" loading={exportHandOver.isPending}
            text="La compétition passe en lecture seule en ligne, et les inscriptions des clubs sont figées, jusqu’à ce que le fichier du PC soit importé ici."
            onConfirm={() => exportHandOver.mutate(undefined, { onSuccess: (pkg) => { download(pkg, competitionId); setHandOver(false); } })} />
        ) : (
          <Anchor href={`/api/competitions/${competitionId}/export.json`} download data-testid="export-file">
            <Button component="span" variant="default">Exporter la compétition (fichier)</Button>
          </Anchor>
        )}
        {server && m.managedHere && (
          <Checkbox label="et donner la main au PC qui l’importera (la compétition passe en lecture seule en ligne)" checked={handOver} onChange={(e) => setHandOver(e.currentTarget.checked)} />
        )}
      </Group>
      <ApiErrorAlert error={pull.error ?? copy.error ?? back.error ?? takeBack.error ?? exportHandOver.error ?? rescue.error ?? (diverged ? null : notify.error)} />
    </Stack>
  );
}

/** « Garder cette copie à jour » : la copie est récupérée de nouveau toutes les N minutes, tant que le serveur a la main. */
function FollowControl({ competitionId }: { competitionId: string }) {
  const { data } = useSyncFollow(true);
  const set = useSetSyncFollow();
  const [typed, setTyped] = useState<number | null>(null);
  if (!data) return null;
  const on = data.competitionId === competitionId;
  const minutes = typed ?? data.intervalMin;
  return (
    <Stack gap={4}>
      <Group align="end">
        <Checkbox label="Garder cette copie à jour" data-testid="sync-follow" checked={on} disabled={set.isPending}
          onChange={(e) => set.mutate(e.currentTarget.checked ? { competitionId, intervalMin: minutes } : null)} />
        <NumberInput size="xs" w={150} min={1} max={60} label="toutes les … minutes" value={minutes}
          onChange={(v) => setTyped(typeof v === 'number' ? v : null)}
          onBlur={() => on && minutes !== data.intervalMin && minutes >= 1 && minutes <= 60 && set.mutate({ competitionId, intervalMin: minutes })} />
      </Group>
      {on && (
        <Text size="sm" c={data.lastError ? 'red' : 'dimmed'} data-testid="sync-follow-status">
          {data.lastError ?? (data.lastSuccessAt ? `Dernière mise à jour : ${when(data.lastSuccessAt)}` : 'Première mise à jour dans la minute.')}
        </Text>
      )}
      <ApiErrorAlert error={set.error} />
    </Stack>
  );
}

/** Téléchargement d'un paquet reçu par une requête (export en donnant la main). */
function download(pkg: unknown, competitionId: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(pkg)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `competition-${competitionId}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** « Importer une compétition (fichier) » : confirmation quand elle existe déjà ou est gérée ailleurs. */
export function ImportCompetitionButton() {
  const imp = useImportCompetition();
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ pkg: unknown; message: string; confirm: 'replace' | 'takeOver' } | null>(null);
  const run = (pkg: unknown, confirm?: 'replace' | 'takeOver') =>
    imp.mutate({ pkg, confirm }, {
      onSuccess: (r) => { setPending(null); navigate(`/competitions/${r.competitionId}/reglages`); },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) setPending({ pkg, message: e.message, confirm: e.message.startsWith('Cette compétition existe déjà ici') ? 'replace' : 'takeOver' });
      },
    });
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
      <FileButton onChange={onFile} accept="application/json,.json">
        {(props) => <Button variant="default" data-testid="import-file" loading={imp.isPending} {...props}>Importer une compétition (fichier)</Button>}
      </FileButton>
      {imp.error && !(imp.error instanceof ApiError && imp.error.status === 409) && <ApiErrorAlert error={imp.error} />}
      <Modal opened={pending !== null} onClose={() => setPending(null)} title="Importer une compétition">
        <Stack>
          <Text size="sm">{pending?.message}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPending(null)}>Annuler</Button>
            <Button color="red" onClick={() => pending && run(pending.pkg, pending.confirm)}>{pending?.confirm === 'replace' ? 'Remplacer' : 'Reprendre la main'}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** « Récupérer depuis le serveur » (PC relié) : la liste des compétitions en ligne. */
export function ServerCompetitionsButton() {
  const { data: me } = useAuthMe();
  const { data: settings } = useSyncSettings(me?.role === 'local');
  const [open, setOpen] = useState(false);
  const list = useServerCompetitions(open);
  const pull = usePull();
  const navigate = useNavigate();
  if (!settings?.url || !settings.hasToken) return null;
  const get = (competitionId: string, take: boolean) => pull.mutate({ competitionId, take }, { onSuccess: (r) => { setOpen(false); navigate(`/competitions/${r.competitionId}/reglages`); } });
  return (
    <>
      <Button variant="default" data-testid="server-competitions" onClick={() => setOpen(true)}>Récupérer depuis le serveur</Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Compétitions du serveur" size="lg">
        <Stack>
          <ApiErrorAlert error={list.error ?? pull.error} />
          <Table>
            <Table.Tbody>
              {(list.data ?? []).map((c) => (
                <Table.Tr key={c.id} data-testid="server-competition">
                  <Table.Td>{c.name}<Text size="xs" c="dimmed">{new Date(`${c.date}T12:00:00`).toLocaleDateString('fr-FR')}{c.managedHere ? '' : ` — gérée par ${c.ownerName}`}</Text></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button size="xs" variant="light" loading={pull.isPending} onClick={() => get(c.id, false)}>Récupérer une copie</Button>
                      {c.managedHere ? (
                        <Confirmed testId="server-take" label="Prendre la main" loading={pull.isPending}
                          text={`Ce PC devient le seul endroit où modifier « ${c.name} » ; en ligne, elle passe en lecture seule.${c.clubEntryStatus === 'open' ? ' Attention : les inscriptions en ligne des clubs sont ouvertes, elles seront figées.' : ''}`}
                          onConfirm={() => get(c.id, true)} />
                      ) : (
                        <Text size="xs" c="dimmed">main à {c.ownerName}</Text>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed">« Prendre la main » : ce PC devient le seul endroit où modifier la compétition ; en ligne, elle passe en lecture seule.</Text>
        </Stack>
      </Modal>
    </>
  );
}

/** Réglages de l'application → Synchronisation : sur le PC, le serveur relié ; sur le serveur, les jetons. */
export function SyncSettingsCard({ role }: { role: 'serveur' | 'local' }) {
  const settings = useSyncSettings(role === 'local');
  const update = useUpdateSyncSettings();
  const unlink = useUnlinkSync();
  const tokens = useSyncTokens(role === 'serveur');
  const create = useCreateSyncToken();
  const revoke = useRevokeSyncToken();
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [name, setName] = useState('PC de la compétition');
  const [created, setCreated] = useState<string | null>(null);
  if (role === 'serveur') {
    return (
      <Stack>
        <Group align="end">
          <TextInput label="Nom du jeton" value={name} w={260} onChange={(e) => setName(e.currentTarget.value)} />
          <Button data-testid="create-sync-token" loading={create.isPending} onClick={() => create.mutate(name, { onSuccess: (t) => setCreated(t.token) })}>Créer un jeton</Button>
        </Group>
        {created && (
          <Alert color="yellow" data-testid="sync-token-created">
            <Stack gap={4}>
              <Text size="sm">Copiez ce jeton maintenant dans les réglages du PC : il ne sera plus affiché.</Text>
              <Group wrap="nowrap">
                <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }} data-testid="sync-token-value">{created}</Text>
                <CopyButton value={created}>{({ copied, copy }) => <Button size="xs" variant="light" onClick={copy}>{copied ? 'Copié' : 'Copier'}</Button>}</CopyButton>
              </Group>
            </Stack>
          </Alert>
        )}
        {(tokens.data ?? []).length > 0 && (
          <Table>
            <Table.Thead><Table.Tr><Table.Th>Jeton</Table.Th><Table.Th>Créé le</Table.Th><Table.Th>Dernière utilisation</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {(tokens.data ?? []).map((t) => (
                <Table.Tr key={t.id} c={t.revoked ? 'dimmed' : undefined}>
                  <Table.Td fw={500}>{t.name}</Table.Td>
                  <Table.Td className="num">{day(t.createdAt)}</Table.Td>
                  <Table.Td className="num">{when(t.lastUsedAt)}</Table.Td>
                  <Table.Td ta="right">{t.revoked ? <StatusBadge tone="neutral">Révoqué</StatusBadge> : <Button size="compact-sm" variant="subtle" color="red" onClick={() => revoke.mutate(t.id)}>Révoquer</Button>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <ApiErrorAlert error={create.error ?? revoke.error} />
      </Stack>
    );
  }
  const shownUrl = url ?? settings.data?.url ?? '';
  return (
    <Stack maw={560}>
      <TextInput data-testid="sync-url" label="Adresse du serveur" placeholder="https://competitions.shidokanfrance.com" value={shownUrl} onChange={(e) => setUrl(e.currentTarget.value)} />
      <TextInput data-testid="sync-token" label="Jeton de synchronisation" placeholder={settings.data?.hasToken ? 'laisser vide pour garder le jeton enregistré' : 'créé dans les réglages du serveur en ligne'}
        value={token} onChange={(e) => setToken(e.currentTarget.value)} />
      <Group>
        <Button data-testid="sync-save" loading={update.isPending} disabled={!shownUrl}
          onClick={() => update.mutate({ url: shownUrl, token: token || null }, { onSuccess: () => { setToken(''); notifications.show({ color: 'green', message: 'Serveur relié.' }); } })}>
          Enregistrer
        </Button>
        {settings.data?.url && (
          <Button variant="subtle" color="red" loading={unlink.isPending} onClick={() => unlink.mutate(undefined, { onSuccess: () => { setUrl(''); notifications.show({ color: 'green', message: 'Ce PC n’est plus relié au serveur.' }); } })}>
            Délier ce PC
          </Button>
        )}
      </Group>
      <ApiErrorAlert error={update.error ?? unlink.error} />
    </Stack>
  );
}
