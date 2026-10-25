import { Alert, Box, Button, Center, Group, Loader, Modal, Select, Stack, Tabs, Text, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCompetition, useZones } from '../api.js';
import { useDocumentTitle } from '../documentTitle.js';
import { posteTabs, tabFor, usePoste, type Poste } from '../poste.js';
import { HELP, type HelpTopicId } from '../help.js';
import { rememberTab, showsTabBar, stageOf, stageTarget, visibleStages } from '../stages.js';
import { COMPETITION_TABS } from '../tabs.js';
import { useHasUnsaved } from '../unsaved.js';
import { sessionParam } from '../useSelectedWave.js';
import { HelpButton, HelpText } from './Help.js';
import { AppMenu, Brand } from './AppHeader.js';
import { ManagementBanner, ManagementChip } from './SyncPanel.js';
import { ThemeToggle } from './ThemeToggle.js';
import { UserMenu } from './UserMenu.js';
import { ZoneAutonomyBar } from './ZoneAutonomyBar.js';
import { EmptyState } from './ui/EmptyState.js';
import { useCompetitionEvents } from '../liveUpdates.js';

const labelOf = (tab: string) => COMPETITION_TABS.find((t) => t.path === tab)?.label ?? tab;

/** Hauteur de la barre d'une compétition (la page défile dessous). */
export const COMPETITION_BAR_HEIGHT = 56;

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
  const stages = visibleStages(poste);
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
  useEffect(() => {
    if (posteTabs(poste).includes(current)) rememberTab(id, current);
  }, [id, current, poste]);
  const stage = stages.find((s) => s.id === stageOf(current)) ?? stages[0];
  useDocumentTitle(data ? `${labelOf(current)} · ${data.name}` : undefined);
  // Une étape ouvre son dernier onglet visité (s'il est encore permis), sinon son premier ; l'étape en cours ne fait rien.
  const openStage = (s: (typeof stages)[number]) => {
    const tab = stageTarget(id, s, current);
    if (tab) go(tab);
  };
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
  if (isLoading) return <Center mih="50vh"><Loader /></Center>;
  if (!data) {
    // Ni barre de l'application ni barre de compétition ici : le bouton ramène à la liste.
    return (
      <Center mih="60vh">
        <EmptyState data-testid="competition-not-found" title="Compétition introuvable"
          text="Elle a peut-être été supprimée, ou son adresse est incomplète."
          action={<Button component={Link} to="/">Retour aux compétitions</Button>} />
      </Center>
    );
  }
  const posteOptions = [{ value: 'organisation', label: 'Organisation' }, { value: 'table', label: 'Table centrale' }, ...zones.map((z) => ({ value: `zone:${z.id}`, label: `Zone : ${z.name}` }))];
  const when = new Date(`${data.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <Stack gap="md">
      <Box
        className="no-print"
        style={{
          position: 'sticky', top: 0, zIndex: 100, height: COMPETITION_BAR_HEIGHT, margin: 'calc(-1 * var(--app-shell-padding)) calc(-1 * var(--app-shell-padding)) 0',
          padding: '0 var(--mantine-spacing-lg)', background: 'var(--sk-bar)', borderBottom: '1px solid var(--sk-line)', display: 'flex', alignItems: 'center', gap: 'var(--mantine-spacing-md)',
        }}
      >
        <Brand compact />
        <Stack gap={0} style={{ minWidth: 0, flex: '1 1 0' }}>
          <Title order={1} fz="md" fw={700} className="sk-ellipsis" title={data.name} data-testid="competition-title">{data.name}</Title>
          <Text size="xs" c="dimmed" className="sk-ellipsis">{when}{data.location ? ` · ${data.location}` : ''}</Text>
        </Stack>
        {stages.length > 1 && (
          <Group gap={4} wrap="nowrap" role="navigation" aria-label="Étapes" style={{ flexShrink: 0 }}>
            {stages.map((s) => {
              const active = s.id === stage?.id;
              return (
                <UnstyledButton key={s.id} data-testid={`stage-${s.id}`} aria-current={active ? 'page' : undefined} onClick={() => openStage(s)}
                  style={{ padding: '6px 12px', borderRadius: 999, fontWeight: active ? 700 : 500, fontSize: 14, whiteSpace: 'nowrap', color: active ? 'var(--sk-chip-text)' : 'var(--sk-muted)', background: active ? 'var(--sk-chip)' : 'transparent' }}>
                  {s.label}
                </UnstyledButton>
              );
            })}
          </Group>
        )}
        {/* À droite, rien ne rétrécit : c'est le nom de la compétition qui se coupe (points de suspension) quand la place manque. */}
        <Group gap="xs" wrap="nowrap" justify="flex-end" style={{ flex: '0 0 auto', marginLeft: 'auto' }}>
          <ManagementChip competitionId={id} />
          {imposed ? (
            <Text size="sm" fw={600} className="sk-ellipsis" data-testid="poste-account" title="Poste imposé par le compte">
              Poste : {poste.kind === 'table' ? 'Table centrale' : `Zone : ${zones.find((z) => poste.kind === 'zone' && z.id === poste.zoneId)?.name ?? '?'}`}
            </Text>
          ) : (
            <Select size="xs" w={160} style={{ flexShrink: 0 }} aria-label="Poste" data-testid="poste-select" allowDeselect={false} value={posteValue} onChange={choosePoste} comboboxProps={{ width: 260 }}
              title={`Poste de ce navigateur : ${posteOptions.find((o) => o.value === posteValue)?.label ?? ''}`} styles={{ input: { textOverflow: 'ellipsis' } }}
              data={posteOptions} />
          )}
          <ThemeToggle />
          <AppMenu />
          <UserMenu />
        </Group>
      </Box>
      {stage && showsTabBar(stage) && (
        <Tabs value={current} onChange={(v) => v && v !== current && go(v)} className="no-print">
          <Tabs.List>
            {stage.tabs.map((t) => <Tabs.Tab key={t} value={t}>{labelOf(t)}</Tabs.Tab>)}
          </Tabs.List>
        </Tabs>
      )}
      <ManagementBanner competitionId={id} />
      <ZoneAutonomyBar competitionId={id} />
      {zoneMissing && <Alert color="orange" data-testid="account-zone-missing">La zone de ce compte n’existe plus : demandez à un organisateur.</Alert>}
      {current in HELP && (
        <Group gap={4} wrap="nowrap" mt={-6}>
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
