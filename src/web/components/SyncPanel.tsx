import { Alert, Anchor, Badge, Button, Checkbox, CopyButton, FileButton, Group, Modal, Radio, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ApiError,
  useAuthMe,
  useCreateSyncToken,
  useImportCompetition,
  useManagement,
  usePull,
  useReceivedCopies,
  useRevokeSyncToken,
  useServerCompetitions,
  useSyncCopy,
  useSyncReturn,
  useSyncSettings,
  useSyncTokens,
  useTakeBack,
  useUpdateSyncSettings,
  type Management,
} from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

/** Texte du bandeau : où est la main sur la compétition. */
export function managementText(m: Management): string {
  if (m.managedHere) return 'Gérée ici';
  if (m.copyOfServer) return `Copie du serveur — synchronisé le ${when(m.lastSyncAt)} — lecture seule`;
  return `Gérée par ${m.ownerName ?? 'une autre installation'} depuis le ${day(m.ownerSince)} — lecture seule`;
}

/** Bandeau de chaque écran de compétition. */
export function ManagementBanner({ competitionId }: { competitionId: string }) {
  const { data } = useManagement(competitionId);
  if (!data) return null;
  if (data.managedHere) return <Badge variant="light" color="gray" data-testid="management-banner">Gérée ici</Badge>;
  return <Alert color="yellow" data-testid="management-banner">{managementText(data)}</Alert>;
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
  const { data: settings } = useSyncSettings();
  const pull = usePull();
  const copy = useSyncCopy(competitionId);
  const back = useSyncReturn(competitionId);
  const takeBack = useTakeBack(competitionId);
  const server = me?.role === 'serveur';
  const copies = useReceivedCopies(competitionId, server && !!m && !m.managedHere);
  const [source, setSource] = useState<'server' | 'lastCopy'>('server');
  const [handOver, setHandOver] = useState(false);
  if (!m) return null;
  const linked = !server && !!settings?.url && settings.hasToken;
  const done = (message: string) => () => notifications.show({ color: 'green', message });

  return (
    <Stack data-testid="sync-panel">
      <Text fw={600}>{managementText(m)}</Text>
      {!server && !linked && <Text size="sm" c="dimmed">Ce PC n’est pas relié au serveur (Réglages de l’application → Synchronisation) : les échanges se font par fichier.</Text>}
      {linked && m.copyOfServer && (
        <Group>
          <Button variant="light" data-testid="sync-refresh" loading={pull.isPending && !pull.variables?.take}
            onClick={() => pull.mutate({ competitionId, take: false }, { onSuccess: done('Copie mise à jour.') })}>Récupérer une copie</Button>
          <Confirmed testId="sync-take" label="Prendre la main" loading={pull.isPending && !!pull.variables?.take}
            text="Ce PC devient le seul endroit où modifier la compétition. En ligne, elle passe en lecture seule et les inscriptions des clubs sont figées."
            onConfirm={() => pull.mutate({ competitionId, take: true }, { onSuccess: done('Ce PC a la main sur la compétition.') })} />
        </Group>
      )}
      {linked && m.managedHere && (
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
        <Anchor href={`/api/competitions/${competitionId}/export.json${handOver ? '?handOver=1' : ''}`} download data-testid="export-file"
          onClick={() => handOver && setTimeout(() => setHandOver(false), 500)}>
          <Button component="span" variant="default">Exporter la compétition (fichier)</Button>
        </Anchor>
        {server && m.managedHere && (
          <Checkbox label="et donner la main au PC qui l’importera (la compétition passe en lecture seule en ligne)" checked={handOver} onChange={(e) => setHandOver(e.currentTarget.checked)} />
        )}
      </Group>
      <ApiErrorAlert error={pull.error ?? copy.error ?? back.error ?? takeBack.error} />
    </Stack>
  );
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
  const { data: settings } = useSyncSettings();
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
                      <Button size="xs" loading={pull.isPending} onClick={() => get(c.id, true)}>Prendre la main</Button>
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
  const settings = useSyncSettings();
  const update = useUpdateSyncSettings();
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
          <TextInput label="Nom du jeton" value={name} onChange={(e) => setName(e.currentTarget.value)} />
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
        <Table>
          <Table.Tbody>
            {(tokens.data ?? []).map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>{t.name}</Table.Td>
                <Table.Td>créé le {day(t.createdAt)} · utilisé le {when(t.lastUsedAt)}</Table.Td>
                <Table.Td>{t.revoked ? <Badge color="gray">révoqué</Badge> : <Button size="xs" variant="subtle" color="red" onClick={() => revoke.mutate(t.id)}>Révoquer</Button>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <ApiErrorAlert error={create.error ?? revoke.error} />
      </Stack>
    );
  }
  const shownUrl = url ?? settings.data?.url ?? '';
  return (
    <Stack>
      <TextInput data-testid="sync-url" label="Adresse du serveur" placeholder="https://competitions.shidokanfrance.com" value={shownUrl} onChange={(e) => setUrl(e.currentTarget.value)} />
      <TextInput data-testid="sync-token" label="Jeton de synchronisation" placeholder={settings.data?.hasToken ? 'laisser vide pour garder le jeton enregistré' : 'créé dans les réglages du serveur en ligne'}
        value={token} onChange={(e) => setToken(e.currentTarget.value)} />
      <Group>
        <Button data-testid="sync-save" loading={update.isPending} disabled={!shownUrl}
          onClick={() => update.mutate({ url: shownUrl, token: token || null }, { onSuccess: () => { setToken(''); notifications.show({ color: 'green', message: 'Serveur relié.' }); } })}>
          Enregistrer
        </Button>
      </Group>
      <ApiErrorAlert error={update.error} />
    </Stack>
  );
}
