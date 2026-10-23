import { Alert, Button, Group, Loader, Modal, Select, Stack, Tabs, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCompetition, useZones } from '../api.js';
import { posteTabs, tabFor, usePoste, type Poste } from '../poste.js';
import { HELP, type HelpTopicId } from '../help.js';
import { COMPETITION_TABS } from '../tabs.js';
import { useHasUnsaved } from '../unsaved.js';
import { sessionParam } from '../useSelectedWave.js';
import { HelpButton, HelpText } from './Help.js';
import { ManagementBanner } from './SyncPanel.js';
import { useCompetitionEvents } from '../liveUpdates.js';


export function CompetitionLayout() {
  const { id = '' } = useParams();
  const { data, isLoading } = useCompetition(id);
  useCompetitionEvents(id);
  const navigate = useNavigate();
  const current = useLocation().pathname.split('/')[3] ?? 'reglages';
  const [poste, setPoste, imposed] = usePoste(id);
  const { data: zones = [], isSuccess: zonesLoaded } = useZones(id);
  // Compte Zone dont la zone a été supprimée (ou d'une autre compétition) : rien n'est permis.
  const zoneMissing = imposed && poste.kind === 'zone' && zonesLoaded && !zones.some((z) => z.id === poste.zoneId);
  const allowed = posteTabs(poste);
  const unsaved = useHasUnsaved();
  const [pending, setPending] = useState<string | null>(null);
  // La vague choisie (`?session=`) suit d'un onglet à l'autre : de la pesée d'une vague à son recasement.
  const session = sessionParam(useSearchParams()[0]);
  const path = (tab: string) => `/competitions/${id}/${tab}${session ? `?session=${encodeURIComponent(session)}` : ''}`;
  const go = (tab: string) => (unsaved ? setPending(tab) : navigate(path(tab)));
  // Un onglet masqué pour ce poste (adresse tapée, poste changé) mène à l'onglet par défaut du poste.
  const target = tabFor(poste, current);
  useEffect(() => {
    // Pas pendant une saisie non enregistrée (poste changé dans un autre onglet) : la redirection attend.
    if (target !== current && !unsaved) navigate(path(target), { replace: true });
  }, [target, current, unsaved]); // eslint-disable-line react-hooks/exhaustive-deps
  const posteValue = poste.kind === 'zone' ? `zone:${poste.zoneId}` : poste.kind;
  const choosePoste = (v: string | null) => {
    if (!v) return;
    if (unsaved) {
      notifications.show({ color: 'orange', message: 'Enregistrez ou abandonnez la saisie en cours avant de changer de poste.' });
      return;
    }
    const p: Poste = v.startsWith('zone:') ? { kind: 'zone', zoneId: v.slice(5) } : v === 'table' ? { kind: 'table' } : { kind: 'organisation' };
    setPoste(p);
  };
  if (isLoading) return <Loader />;
  if (!data) return <Text>Compétition introuvable.</Text>;
  return (
    <Stack>
      <div>
        <Title order={2}>{data.name}</Title>
        <Text c="dimmed">
          {new Date(`${data.date}T12:00:00`).toLocaleDateString('fr-FR', { dateStyle: 'full' })}
          {data.location ? ` — ${data.location}` : ''}
        </Text>
        <Group justify="space-between" align="center" mt={4}>
          <ManagementBanner competitionId={id} />
          {imposed ? (
            <Text size="sm" data-testid="poste-account">Poste : {poste.kind === 'table' ? 'Table centrale' : `Zone : ${zones.find((z) => poste.kind === 'zone' && z.id === poste.zoneId)?.name ?? '?'}`}</Text>
          ) : (
            <Select size="xs" w={220} label="Poste" data-testid="poste-select" allowDeselect={false} value={posteValue} onChange={choosePoste}
              data={[{ value: 'organisation', label: 'Organisation (tout)' }, { value: 'table', label: 'Table centrale' }, ...zones.map((z) => ({ value: `zone:${z.id}`, label: `Zone : ${z.name}` }))]} />
          )}
        </Group>
        {zoneMissing && <Alert color="orange" mt="xs" data-testid="account-zone-missing">La zone de ce compte n’existe plus : demandez à un organisateur.</Alert>}
      </div>
      <Tabs value={current} onChange={(v) => v && v !== current && go(v)}>
        <Tabs.List>
          {COMPETITION_TABS.filter((t) => allowed.includes(t.path)).map((t) => (
            <Tabs.Tab key={t.path} value={t.path}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {current in HELP && (
        <Group gap={4} wrap="nowrap">
          <HelpText topic={current as HelpTopicId} />
          <HelpButton topic={current as HelpTopicId} />
        </Group>
      )}
      <Modal opened={pending !== null} onClose={() => setPending(null)} title="Quitter sans enregistrer ?">
        <Stack data-testid="leave-confirm">
          <Text size="sm">La saisie en cours n’est pas enregistrée : elle sera perdue si vous quittez cet onglet.</Text>
          <Group justify="flex-end">
            <Button variant="default" data-testid="leave-stay" onClick={() => setPending(null)}>Rester</Button>
            <Button color="red" data-testid="leave-go" onClick={() => { const tab = pending; setPending(null); if (tab) navigate(path(tab)); }}>
              Quitter sans enregistrer
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Outlet />
    </Stack>
  );
}
