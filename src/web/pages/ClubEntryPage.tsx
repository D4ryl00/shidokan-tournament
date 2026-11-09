import { Accordion, Alert, Box, Button, Card, Checkbox, Container, Group, Loader, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Fragment, useState } from 'react';
import { useParams } from 'react-router';
import { PRE_APPROVAL_TEXT, kgText, orderedPrefs, weightWarning, type ClubFormLine } from '../../domain/club-form.js';
import { useClubEntry, useCoachLineOps, useSaveClubHeader, type ClubEntryHeader, type ClubEntryView, type ClubLine } from '../api.js';
import { useDocumentTitle } from '../documentTitle.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { ClubLineForm } from '../components/ClubLineForm.js';
import { Logo } from '../components/Logo.js';
import { clubEntryStatusText } from '../components/OnlineEntryPanel.js';
import { ThemeToggle } from '../components/ThemeToggle.js';
import { EmailsInput } from '../components/EmailsInput.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { JumpLinks } from '../components/ui/JumpLinks.js';
import { GROUP_MODES, groupClubLines, type GroupMode, type Hidden } from '../components/club-entry/groups.js';
import { disciplineLabel, SEX_LABELS } from '../labels.js';

const RULESET_LABEL = { jiyu: 'jiyu', shobu: 'shobu' } as const;

/** « Si sans adversaire : Shido-boxing, puis Shido-mix-martial » ou « … : reste en karaté ». */
function reclassText(line: ClubFormLine): string {
  const choices = orderedPrefs(line.prefs).map(disciplineLabel);
  return `Si sans adversaire : ${choices.length ? choices.join(', puis ') : `reste en ${disciplineLabel(line.combats[0]!).toLowerCase()}`}`;
}

/** Coordonnées du club et pré-accord, enregistrés d'un bouton. */
function HeaderForm({ token, view }: { token: string; view: ClubEntryView }) {
  const save = useSaveClubHeader(token);
  const initial: ClubEntryHeader = { coachName: view.club.coachName, coachPhone: view.club.coachPhone, coachEmails: view.club.coachEmails, preApproval: view.club.preApproval, affiliationNumber: view.club.affiliationNumber };
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<ClubEntryHeader>) => setForm((f) => ({ ...f, ...patch }));
  // Texte gardé tel que tapé pendant la saisie (un `trim` à chaque touche mangerait l'espace qu'on vient de taper) ; nettoyé à l'enregistrement.
  const typed = (v: string) => v || null;
  const orNull = (v: string | null) => v?.trim() || null;
  const cleaned = (f: ClubEntryHeader): ClubEntryHeader => ({ ...f, coachName: orNull(f.coachName), coachPhone: orNull(f.coachPhone), affiliationNumber: orNull(f.affiliationNumber) });
  const ro = !view.editable;
  return (
    <Card withBorder padding="lg">
      <Stack>
        <Title order={2} fz="lg">Votre club : {view.club.name}</Title>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          <TextInput label="Coach" readOnly={ro} value={form.coachName ?? ''} onChange={(e) => set({ coachName: typed(e.currentTarget.value) })} />
          <TextInput label="Téléphone" readOnly={ro} inputMode="tel" value={form.coachPhone ?? ''} onChange={(e) => set({ coachPhone: typed(e.currentTarget.value) })} />
          <EmailsInput readOnly={ro} value={form.coachEmails} onChange={(coachEmails) => set({ coachEmails })} />
          <TextInput data-testid="club-affiliation" label="N° d’affiliation FFK (facultatif)" readOnly={ro} inputMode="numeric" value={form.affiliationNumber ?? ''}
            onChange={(e) => set({ affiliationNumber: typed(e.currentTarget.value) })} />
        </SimpleGrid>
        <Checkbox label="Pré-accord du coach" description={`Pour trouver un adversaire à vos combattants, ${PRE_APPROVAL_TEXT} Le changement de discipline se choisit combattant par combattant.`} disabled={ro} checked={form.preApproval}
          onChange={(e) => set({ preApproval: e.currentTarget.checked })} />
        <ApiErrorAlert error={save.error} />
        {!ro && (
          <Group justify="flex-end">
            <Button variant="default" loading={save.isPending}
              onClick={() => save.mutate(cleaned(form), { onSuccess: () => notifications.show({ color: 'green', message: 'Coordonnées enregistrées.' }) })}>
              Enregistrer les coordonnées
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

const MODE_KEY = 'inscription:regroupement';
const savedMode = (): GroupMode => {
  try { const v = localStorage.getItem(MODE_KEY); return GROUP_MODES.some((m) => m.value === v) ? (v as GroupMode) : 'category'; } catch { return 'category'; }
};

/** Étiquettes d'une ligne : sexe, tranche d'âge, poids, disciplines ; sans ce que les titres disent déjà (`hide`). */
function LineTags({ line, view, hide }: { line: ClubFormLine; view: ClubEntryView; hide: Hidden }) {
  const age = view.ageBands.find((b) => b.code === line.ageBandCode)?.label ?? line.ageBandCode;
  const weightClass = view.weightClasses.find((w) => w.id === line.weightClassId);
  const weight = [weightClass ? `${weightClass.label} kg` : null, line.weightKg !== null ? `${kgText(line.weightKg)} kg` : null].filter(Boolean).join(' · ');
  return (
    <Group gap={5} data-testid="club-line-tags">
      {line.sex && <span className="sk-tag" data-kind="sex" title={SEX_LABELS[line.sex]}>{line.sex}</span>}
      {!hide.age && age && <span className="sk-tag">{age}</span>}
      {!hide.kata && weight && <span className="sk-tag">{weight}</span>}
      {!hide.combat && line.combats.map((c) => <span key={c} className="sk-tag" data-kind="discipline">{disciplineLabel(c)}{line.ruleset ? ` ${RULESET_LABEL[line.ruleset]}` : ''}</span>)}
      {line.kata && !hide.kata && (hide.combat
        ? <Text span size="xs" c="dimmed">aussi en Kata</Text>
        : <span className="sk-tag" data-kind="discipline">Kata</span>)}
      {hide.kata && line.combats.length > 0 && <Text span size="xs" c="dimmed">aussi en {line.combats.map(disciplineLabel).join(', ')}{line.ruleset ? ` ${RULESET_LABEL[line.ruleset]}` : ''}</Text>}
    </Group>
  );
}

function LineRow({ l, view, hide, onEdit }: { l: ClubLine; view: ClubEntryView; hide: Hidden; onEdit: (l: ClubLine) => void }) {
  return (
    <Group className="sk-club-row" justify="space-between" wrap="nowrap" align="start" px="md" py="sm" data-testid="club-line" data-fighter={l.fighterId}>
      <Stack gap={4} style={{ minWidth: 0 }}>
        <Text fw={700}>{l.line.lastName} {l.line.firstName}</Text>
        <LineTags line={l.line} view={view} hide={hide} />
        {l.line.combats.length > 0 && !hide.kata && <Text size="xs" c="dimmed" data-testid="club-line-reclass">{reclassText(l.line)}</Text>}
        {[...l.notices, hide.kata ? null : weightWarning(l.line, view.weightClasses)].filter((n) => n !== null).map((n) => <Text key={n} size="xs" c="var(--sk-warn-text)" data-testid="line-notice">{n}</Text>)}
        {!l.editable && (
          <Group gap={6} mt={2}>
            <StatusBadge tone="neutral" size="sm">Verrouillé</StatusBadge>
            <Text size="xs" c="dimmed">{l.reason}</Text>
          </Group>
        )}
      </Stack>
      {view.editable && l.editable && <Button size="xs" variant="default" style={{ flexShrink: 0 }} onClick={() => onEdit(l)}>Modifier</Button>}
    </Group>
  );
}

/**
 * « Vos combattants » : par catégorie (défaut : discipline et règlement, puis une carte par tranche d'âge), par âge ou par nom
 * (choix gardé sur l'appareil), avec recherche et sommaire.
 */
function ClubLinesList({ view, onEdit }: { view: ClubEntryView; onEdit: (l: ClubLine) => void }) {
  const [mode, setMode] = useState<GroupMode>(savedMode);
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const choose = (m: string) => {
    setMode(m as GroupMode);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* stockage refusé : le choix vaut pour cette visite */ }
  };
  const fold = (id: string) => setFolded((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const groups = groupClubLines(view.lines, { mode, query, ageBands: view.ageBands, weightClasses: view.weightClasses });
  const domId = (id: string) => `club-group-${id}`;
  const scrollTo = (id: string) => () => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  // Par catégorie : une pastille par discipline et règlement (une par carte en ferait des dizaines) ; par âge : une par tranche.
  const jumps = mode === 'name' ? [] : mode === 'category'
    ? groups.filter((g, i) => g.section && g.section !== groups[i - 1]?.section)
      .map((g) => ({ key: g.section!.key, label: g.section!.short, count: g.section!.size, onClick: scrollTo(domId(`section-${g.section!.key}`)) }))
    : groups.map((g) => ({ key: g.id, label: g.title ?? '', count: g.lines.length, onClick: scrollTo(domId(g.id)) }));
  return (
    <Stack gap="sm">
      {view.lines.length > 1 && (
        <Group gap="sm" align="center" data-testid="club-lines-tools">
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" c="dimmed" fw={500} id="club-group-label">Regrouper par</Text>
            <SegmentedControl size="xs" value={mode} onChange={choose} data={GROUP_MODES} aria-labelledby="club-group-label" data-testid="club-group-mode" />
          </Group>
          <TextInput placeholder="Chercher un nom" aria-label="Chercher un nom" type="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: '1 1 180px', minWidth: 0 }} styles={{ input: { fontSize: 16 } }} data-testid="club-search" />
        </Group>
      )}
      {jumps.length > 1 && <JumpLinks label="Aller au groupe" data-testid="club-jumps" items={jumps} />}
      {groups.length === 0 && <EmptyState title={`Aucun combattant ne correspond à « ${query.trim()} ».`} />}
      {groups.map((g, i) => {
        const open = g.title === null || !folded.has(g.id);
        const section = g.section && g.section !== groups[i - 1]?.section ? g.section : null;
        return (
          <Fragment key={g.id}>
          {section && (
            <Group gap={8} align="baseline" mt={i === 0 ? 0 : 'sm'} id={domId(`section-${section.key}`)} style={{ scrollMarginTop: 12 }} data-testid="club-section">
              <Text fw={700} size="sm" tt="uppercase" c="dimmed" style={{ letterSpacing: 0.4 }} data-testid="club-section-title">{section.title}</Text>
              {section.sub && <Text size="xs" c="dimmed">{section.sub}</Text>}
            </Group>
          )}
          <Card id={domId(g.id)} withBorder padding={0} style={{ scrollMarginTop: 12 }} data-testid="club-group">
            {g.title !== null && (
              <UnstyledButton onClick={() => fold(g.id)} aria-expanded={open} px="md" py="sm"
                style={{ display: 'flex', alignItems: 'baseline', gap: 10, background: 'var(--sk-row)', borderBottom: open ? '1px solid var(--sk-card-line)' : 0 }}>
                <IconChevron open={open} />
                <Text fw={700} data-testid="club-group-title">{g.title}</Text>
                {g.sub && <Text size="sm" c="dimmed">{g.sub}</Text>}
                <Text size="sm" c="dimmed" ml="auto" className="num" style={{ whiteSpace: 'nowrap' }}>{g.count}</Text>
              </UnstyledButton>
            )}
            {open && g.lines.map((l) => <LineRow key={l.fighterId} l={l} view={view} hide={g.hide} onEdit={onEdit} />)}
          </Card>
          </Fragment>
        );
      })}
    </Stack>
  );
}

const IconChevron = ({ open }: { open: boolean }) => (
  <Text span c="dimmed" aria-hidden style={{ display: 'inline-block', width: 10, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }}>›</Text>
);

export function ClubEntryPage() {
  const { token = '' } = useParams();
  const { data: view, error, isLoading } = useClubEntry(token);
  useDocumentTitle(view ? `Inscriptions · ${view.competition.name}` : 'Inscriptions');
  const [editing, setEditing] = useState<ClubLine | 'new' | null>(null);
  const coachOps = useCoachLineOps(token);

  const close = (message?: string) => {
    setEditing(null);
    if (message) notifications.show({ color: 'orange', message });
  };

  return (
    <Box mih="100vh" style={{ background: 'var(--sk-bg)' }}>
      <Box component="header" style={{ background: 'var(--sk-bar)', borderBottom: '1px solid var(--sk-line)' }}>
        <Container size="sm" py="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <Logo size={36} />
              <Text fw={700}>Shidokan France</Text>
            </Group>
            <ThemeToggle />
          </Group>
        </Container>
      </Box>
    <Container size="sm" py="lg">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1} fz={26} lh={1.2}>{view?.competition.name ?? 'Inscription des combattants'}</Title>
          {view && (
            <Text c="dimmed">
              {new Date(`${view.competition.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {view.competition.location ? ` · ${view.competition.location}` : ''}
            </Text>
          )}
        </Stack>
        {isLoading && <Loader />}
        {error && <Alert color="red" data-testid="club-entry-error">{error.message}</Alert>}
        {view && (
          <>
            <Group>
              <StatusBadge tone={view.editable ? 'ok' : 'neutral'} size="lg" wrap data-testid="club-entry-state">
                {view.editable ? clubEntryStatusText('open', view.competition.deadline) : 'Inscriptions closes : contactez l’organisateur.'}
              </StatusBadge>
            </Group>
            <HeaderForm key={JSON.stringify(view.club)} token={token} view={view} />
            <Group justify="space-between" mt="sm">
              <Title order={2} fz="lg">{view.lines.length === 0 ? 'Vos combattants' : `Vos combattants (${view.lines.length})`}</Title>
              {view.editable && <Button data-testid="add-fighter" onClick={() => setEditing('new')}>Ajouter un combattant</Button>}
            </Group>
            {view.closedSummary.length > 0 && (
              <Accordion variant="contained" radius="md" data-testid="club-entry-closed">
                <Accordion.Item value="closed">
                  <Accordion.Control>
                    <Text size="sm" fw={500}>Catégories non ouvertes à cette compétition</Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap={2}>{view.closedSummary.map((l) => <Text key={l} size="sm">{l}</Text>)}</Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            )}
            {view.lines.length === 0 && (
              <EmptyState title="Aucun combattant pour l’instant" text={view.editable ? 'Ajoutez-les un par un avec « Ajouter un combattant ».' : undefined} />
            )}
            {view.lines.length > 0 && <ClubLinesList view={view} onEdit={setEditing} />}
            <Text size="xs" c="dimmed" mt="lg" data-testid="privacy-notice">{view.privacyNotice}</Text>
            <ClubLineForm key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.fighterId} ops={coachOps} mode="coach" multipleCombats={view.multipleCombats} line={editing === 'new' ? null : editing}
              ageBands={view.ageBands} weightClasses={view.weightClasses} closed={view.closed} opened={editing !== null} onClose={close} />
          </>
        )}
      </Stack>
    </Container>
    </Box>
  );
}
