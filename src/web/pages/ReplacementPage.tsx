import { Alert, Box, Button, Card, Chip, Collapse, Group, Loader, Modal, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, type ComboboxData } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type { Case, CaseKind, Proposal, ProposalType } from '../../domain/replacement/index.js';
import type { Wave } from '../../domain/waves.js';
import {
  useApplyProposal,
  useCategories,
  useCompetition,
  useGrid,
  useManualMove,
  usePreviewReplacement,
  usePlan,
  useResetRules,
  useSetRules,
  type PlanChoice,
  type PlanMove,
  useRefuseProposal,
  useUnrefuseProposal,
  useRegistrations,
  useReplacement,
  useUndoRecasement,
  useWithdrawRegistration,
  useSetAsideCase,
  useResumeCase,
  type CaseFighter,
} from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { HELP } from '../help.js';
import { HelpButton } from '../components/Help.js';
import { ProposalPreview } from '../components/ProposalPreview.js';
import { PROPOSAL_TYPES, ReplacementBadge } from '../components/ReplacementBadge.js';
import { ageBandLabel, disciplineLabel, prefsLabel, rulesetShort, weightLabel } from '../labels.js';
import { RuleLadder } from '../components/replacement/RuleLadder.js';
import { PlanView, type PlanFighter } from '../components/replacement/PlanView.js';
import { rulesView } from '../../domain/replacement/rules.js';
import { usePlanChoices } from '../usePlanChoices.js';
import { useSelectedWave } from '../useSelectedWave.js';
import type { CategoryGrid } from '../../domain/types.js';
import { plural } from '../../domain/plural.js';

type Dialog =
  | { kind: 'proposal'; proposal: Proposal; confirm: boolean }
  | { kind: 'undo'; recasementId: string; label: string }
  | { kind: 'move'; registrationId: string; categoryId: string }
  | { kind: 'withdraw'; registrationId: string; categoryLabel: string }
  | { kind: 'set-aside'; caseId: string }
  | null;

const CASE_KINDS: Record<CaseKind, string> = { closed: 'Catégorie fermée', alone: 'Sans adversaire', weight_out: 'Poids hors catégorie', weight_gap: 'Écart de poids', return: 'Retour possible' };
const kg = (x: number) => Number(x.toFixed(1)).toString().replace('.', ',');

/**
 * Ce qu'entraîne un changement de vague : le combattant (et ceux que sa catégorie emmène) repasse « non pesé »
 * dans sa nouvelle vague ; vague d'arrivée déjà clôturée ou catégorie en attente signalées.
 */
function WaveChangeWarning({ proposal, waves, name }: { proposal: Proposal | undefined; waves: Wave[]; name: (registrationId: string) => string }) {
  if (!proposal || (!proposal.waveChange && proposal.waveShifts.length === 0)) return null;
  const waveName = (w: string | null) => waves.find((x) => x.id === w)?.name ?? 'en attente';
  const where = (to: string | null) => (to === null ? 'dans une catégorie en attente (dans aucune session)' : `dans la session « ${waveName(to)} »`);
  const then = (to: string | null) =>
    to === null
      ? 'il n’apparaîtra dans aucune pesée tant qu’elle n’est pas placée dans une session (écran Sessions).'
      : waves.find((w) => w.id === to)?.weighInClosed
        ? 'la pesée de cette session est déjà clôturée : pointez-le à la main dans l’écran Pesée.'
        : 'à pointer (et à peser si besoin) dans cette session.';
  return (
    <Alert color="grape" data-testid="wave-change-warning">
      <Stack gap={4}>
        {proposal.waveChange && (
          <Text size="sm">
            {name(proposal.registrationId)} passera {where(proposal.waveChange.to)} : {then(proposal.waveChange.to)} Son poids déjà relevé est gardé.
          </Text>
        )}
        {proposal.waveShifts.map((x) => (
          <Text size="sm" key={x.registrationId}>
            {x.label}, dont la catégorie change de session, passera {where(x.to)} : {then(x.to)}
          </Text>
        ))}
      </Stack>
    </Alert>
  );
}

/** Le combattant d'un cas en une ligne : tranche d'âge, sexe, discipline, règlement, catégorie de poids, poids, préférences. */
function FighterDetail({ f, grid }: { f: CaseFighter | undefined; grid: CategoryGrid | undefined }) {
  if (!f) return null;
  const e = f.sex === 'F' ? 'e' : '';
  const weight = f.weighInKg !== null ? `pesé${e} ${kg(f.weighInKg)} kg` : f.approxWeightKg !== null ? `≈ ${kg(f.approxWeightKg)} kg (non pesé${e})` : `non pesé${e}`;
  const parts = [
    `${ageBandLabel(grid, f.ageBandCode)} ${f.sex === 'F' ? 'F' : 'M'}`,
    `${disciplineLabel(f.discipline)}${f.ruleset ? ` ${rulesetShort(f.ruleset)}` : ''}`,
    ...(f.weightClassId ? [`${weightLabel(grid, f.weightClassId)} kg`, weight] : []),
    ...(f.otherDisciplines.length ? [`accepte : ${prefsLabel(f.otherDisciplines)}`] : []),
    ...(f.ruleset === 'shobu' && f.acceptsJiyuFirst ? ['accepte le jiyu en priorité'] : []),
  ];
  return <Text size="sm" data-testid="case-fighter">{parts.join(' · ')}</Text>;
}

/** Compteur du tableau de bord ; `tone` : à traiter (attention), réglé (succès) ou bloquant (erreur). */
function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'danger' }) {
  const color = tone === 'ok' ? 'var(--sk-ok-text)' : tone === 'warn' ? 'var(--sk-warn-text)' : tone === 'danger' ? 'var(--mantine-color-red-text)' : undefined;
  return (
    <Card withBorder padding="sm">
      <Text fz={28} fw={700} lh={1.1} c={color} className="num">{value}</Text>
      <Text size="sm" c="dimmed">{label}</Text>
    </Card>
  );
}

const sameChoice = (a: PlanChoice, b: PlanChoice) =>
  a.kind === 'validate' ? b.kind === 'validate' && a.proposalId === b.proposalId && a.caseId === b.caseId : b.kind === 'manual' && a.registrationId === b.registrationId && a.categoryId === b.categoryId;
/** Inscription d'un choix (l'identifiant d'une proposition est `${type}:${inscription}>${cible}`). */
const choiceRegistration = (c: PlanChoice) => (c.kind === 'manual' ? c.registrationId : c.proposalId.slice(c.proposalId.indexOf(':') + 1, c.proposalId.indexOf('>')));

/**
 * La liste des règles de la compétition avec ses barres, et le plan d'ensemble de la session choisie (même calcul, avec les
 * épingles et les choix de l'organisateur). Sans plan (calcul en cours ou en erreur), la liste reste réglable, sans barres.
 */
function RulesPanel({ id, waveId, ready, fighter, targets }: {
  id: string;
  waveId: string | null;
  ready: boolean;
  fighter: (registrationId: string) => PlanFighter;
  targets: (move: PlanMove) => ComboboxData | null;
}) {
  const [choices, setChoices] = usePlanChoices(id, waveId);
  const [dropped, setDropped] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  // Avec des sessions, le plan n'existe que pour la session choisie.
  const { data: shownPlan, error, isFetching, isPlaceholderData } = usePlan(id, waveId, choices, ready);
  // Le plan gardé pendant un recalcul est celui de la même session seulement (pas celui de la session d'avant).
  const [loadedWave, setLoadedWave] = useState<string | null | undefined>(undefined);
  if (shownPlan && !isPlaceholderData && loadedWave !== waveId) setLoadedWave(waveId);
  const plan = loadedWave === waveId ? shownPlan : undefined;
  const { data: competition } = useCompetition(id);
  const setRules = useSetRules(id);
  const reset = useResetRules(id);
  // Un choix qui n'est plus possible (données changées ailleurs) est retiré ; on dit lesquels.
  useEffect(() => {
    if (!plan || isPlaceholderData || plan.plan.dropped.length === 0) return;
    const gone = plan.plan.dropped;
    setDropped(gone.map((c) => fighter(choiceRegistration(c)).name));
    setChoices(choices.filter((c) => !gone.some((d) => sameChoice(c, d))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, isPlaceholderData]);
  const choose = (c: PlanChoice[]) => { setDropped([]); setChoices(c); };
  const view = plan?.view ?? (competition ? rulesView(competition.settings) : null);
  if (!view) return <ApiErrorAlert error={error} />;
  const k = view.order.indexOf(view.cutAfter) + 1;
  return (
    <SectionCard title="Règles de réaffectation" description="L’ordre est la priorité ; la ligne pointillée marque où les règles s’arrêtent.">
      <RuleLadder view={view} rows={plan?.rows} busy={setRules.isPending || reset.isPending} onChange={(v) => setRules.mutate(v)} />
      <ApiErrorAlert error={setRules.error ?? reset.error ?? error} />
      <Group>
        <Button variant="subtle" size="compact-sm" loading={reset.isPending} onClick={() => reset.mutate()}>Revenir aux réglages par défaut</Button>
      </Group>
      {plan && (
        <Group>
          <Button data-testid="plan-show" variant={open ? 'default' : 'filled'} aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ maxWidth: '100%', height: 'auto', minHeight: 36, whiteSpace: 'normal' }}>
            Voir le plan jusqu’à la règle {k} ({plural(plan.plan.moves.length, 'déplacement', 'déplacements')}, {plural(plan.plan.alone.length, 'seul', 'seuls')})
          </Button>
        </Group>
      )}
      {plan && open && (
        <PlanView key={waveId ?? ''} id={id} waveId={waveId} data={plan} choices={choices} onChoices={choose} dropped={dropped}
          busy={isFetching} fighter={fighter} targets={targets} />
      )}
    </SectionCard>
  );
}

export function ReplacementPage() {
  const { id = '' } = useParams();
  // Avec des vagues : le tableau de bord de la vague choisie (même choix que la Pesée).
  const { waves, waveId, select, ready } = useSelectedWave(id);
  const { data } = useReplacement(id, waveId, ready);
  const waveName = (w: string | null) => (w === null ? 'en attente' : (waves.find((x) => x.id === w)?.name ?? '?'));
  const { data: rows = [] } = useRegistrations(id);
  const { data: categories = [] } = useCategories(id);
  const preview = usePreviewReplacement(id);
  const apply = useApplyProposal(id);
  const refuse = useRefuseProposal(id);
  const unrefuse = useUnrefuseProposal(id);
  const undo = useUndoRecasement(id);
  const move = useManualMove(id);
  const withdraw = useWithdrawRegistration(id);
  const setAside = useSetAsideCase(id);
  const resume = useResumeCase(id);
  const [note, setNote] = useState('');
  const [asideOpen, setAsideOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [moveTarget, setMoveTarget] = useState<Record<string, string | null>>({});
  const [allTargets, setAllTargets] = useState<Record<string, boolean>>({});
  const { data: grid } = useGrid(id);
  const [kinds, setKinds] = useState<string[]>([]);
  const [logState, setLogState] = useState<'all' | 'validated' | 'undone'>('all');
  const [logType, setLogType] = useState<string | null>(null);
  const reg = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const name = (rid: string) => {
    const r = reg.get(rid);
    return r ? `${r.fighter.lastName} ${r.fighter.firstName} — ${r.club?.name ?? 'sans club'}` : rid;
  };

  const openProposal = (proposal: Proposal, confirm: boolean) => {
    setDialog({ kind: 'proposal', proposal, confirm });
    preview.mutate({ proposalId: proposal.id });
  };
  const done = (message: string) => {
    setDialog(null);
    notifications.show({ color: 'green', message });
  };

  const waveSelector = waves.length > 0 && (
    <Group gap="xs">
      <Text size="sm" fw={600}>Session :</Text>
      <SegmentedControl data-testid="replacement-wave" value={waveId ?? ''} onChange={select} data={waves.map((w) => ({ value: w.id, label: w.name }))} />
    </Group>
  );
  // Tant que les vagues ne sont pas chargées, on ne sait pas quels cas afficher.
  if (!ready || !data) return <Stack>{waveSelector}<Loader /></Stack>;
  const s = data.summary;
  /** Catégories proposées au déplacement manuel : les cohérentes avec les réglages, et les autres si on les demande. */
  const moveOptions = (caseId: string, all = allTargets[caseId] ?? false, sessionOnly = false): ComboboxData => {
    const band = data.fighters[data.cases.find((x) => x.id === caseId)?.registrationId ?? '']?.ageBandCode;
    const option = (t: { categoryId: string; warnings: string[] }) => {
      const x = categories.find((k) => k.id === t.categoryId);
      // Le plan d'ensemble ne change personne de session : il ne propose que les catégories de la session choisie.
      if (!x || (sessionOnly && waveId && x.waveId !== waveId)) return null;
      const otherBand = band !== undefined && !x.key.ageBandCodes.includes(band);
      return {
        value: x.id,
        label: `${x.label} (${x.registrationIds.length - x.absentIds.length})${otherBand ? ' · autre tranche d’âge' : ''}${waveId && x.waveId !== waveId ? ` · session ${waveName(x.waveId)}` : ''}${t.warnings.length ? ` ⚠ ${plural(t.warnings.length, 'règle enfreinte', 'règles enfreintes')}` : ''}`,
      };
    };
    const targets = data.moveTargets[caseId] ?? [];
    const ok = targets.filter((t) => t.warnings.length === 0).map(option).filter((o) => o !== null);
    if (!all) return ok;
    const others = targets.filter((t) => t.warnings.length > 0).map(option).filter((o) => o !== null);
    return [{ group: 'Cohérentes avec les réglages', items: ok }, { group: 'Règles enfreintes (avertissement)', items: others }].filter((g) => g.items.length > 0);
  };
  /** Combattant d'une ligne du plan : nom et club. */
  const fighter = (rid: string): PlanFighter => {
    const r = reg.get(rid);
    return r ? { name: `${r.fighter.lastName} ${r.fighter.firstName}`, club: r.club?.name ?? null } : { name: rid, club: null };
  };
  /**
   * « Modifier » une ligne du plan : la liste du déplacement manuel de son cas, quand c'est le combattant du cas qui bouge,
   * limitée aux catégories de la session choisie.
   */
  const planTargets = (m: PlanMove): ComboboxData | null => {
    const c = data.cases.find((x) => x.id === m.caseId);
    if (!c || c.registrationId !== m.registrationId || (data.moveTargets[c.id] ?? []).length === 0) return null;
    const options = moveOptions(c.id, true, true);
    return options.length > 0 ? options : null;
  };
  const activeCases = data.cases.filter((c) => !data.setAside[c.id]);
  const asideCases = data.cases.filter((c) => data.setAside[c.id]);
  /** Une carte de cas : le combattant, ses propositions, le déplacement manuel (et « Ne combat pas » pour une catégorie fermée). */
  const caseCard = (c: Case) => {
    const proposals = data.proposals[c.id] ?? [];
    const open = proposals.filter((p) => !p.refused);
    return (
      <Card key={c.id} withBorder data-testid="replacement-case" padding="md">
        <Group justify="space-between" align="flex-start" mb="sm" wrap="nowrap">
          <div style={{ minWidth: 0 }}>
            <Text fw={700} size="lg" data-testid="case-name">{name(c.registrationId)}</Text>
            <FighterDetail f={data.fighters[c.registrationId]} grid={grid} />
            <Text size="sm" c="dimmed">
              {c.detail}
              {c.categoryId && categories.find((x) => x.id === c.categoryId) ? ` · catégorie actuelle : ${categories.find((x) => x.id === c.categoryId)!.label}` : ''}
            </Text>
          </div>
          <Stack gap={4} align="flex-end">
            <StatusBadge tone={c.kind === 'return' ? 'neutral' : 'warn'} size="lg">{CASE_KINDS[c.kind]}</StatusBadge>
            {!data.setAside[c.id] && (
              <Button size="compact-xs" variant="subtle" color="gray" data-testid="case-set-aside" onClick={() => { setNote(''); setDialog({ kind: 'set-aside', caseId: c.id }); }}>
                Mettre de côté
              </Button>
            )}
          </Stack>
        </Group>
        <Stack gap="xs">
          {open.length === 0 && <Text size="sm" c="red.6" fw={500}>{c.kind === 'closed' ? 'Aucune solution automatique : déplacer manuellement ou choisir « Ne combat pas ».' : 'Aucune solution automatique : déplacer manuellement ou laisser sans adversaire.'}</Text>}
          {proposals.map((p) => {
            if (p.refused) {
              return (
                <Group key={p.id} justify="space-between" wrap="nowrap" data-testid="replacement-proposal-refused" style={{ opacity: 0.55 }}>
                  <Group gap="xs" wrap="nowrap">
                    <ReplacementBadge type={p.type} state="refused" gapKg={p.checks.weightGapKg} checks={p.checks} />
                    <Text size="sm" td="line-through">{p.reason}</Text>
                    <Text size="xs" c="dimmed">refusée</Text>
                  </Group>
                  <Button size="xs" variant="subtle" data-testid="proposal-unrefuse" onClick={() => unrefuse.mutate({ proposalId: p.id })}>Rétablir</Button>
                </Group>
              );
            }
            return (
              <Group key={p.id} justify="space-between" wrap="nowrap" data-testid="replacement-proposal" p="xs"
                style={{ border: '1px solid var(--sk-line)', borderRadius: 'var(--mantine-radius-md)', background: 'var(--sk-bg)' }}>
                <Group gap="xs" wrap="nowrap">
                  <Box style={{ flexShrink: 0 }}><ReplacementBadge type={p.type} state="proposed" gapKg={'newKey' in p.target ? undefined : p.checks.weightGapKg} checks={p.checks} /></Box>
                  <div>
                    <Text size="sm">{p.reason}</Text>
                    <Text size="xs" c="dimmed">
                      {'newKey' in p.target ? 'Catégorie de son poids réel (encore vide)' : PROPOSAL_TYPES[p.type].title}
                      {!('newKey' in p.target) && (p.type === 'A' || p.type === 'B' || p.checks.weightGapKg > 0)
                        ? ` · écart de poids ${kg(p.checks.weightGapKg)} kg entre le plus léger et le plus lourd (max ${kg(p.checks.threshold)} kg)`
                        : ''}
                      {p.checks.ageMove !== 'same' ? (p.checks.ageDirections.includes('down') ? ' · âge : une tranche au-dessous' : ' · âge : une tranche au-dessus') : ''}
                      {p.checks.mixedSex ? ' · mixte' : ''}
                      {p.manual ? ' · validation manuelle' : ' · cas simple'}
                    </Text>
                  </div>
                  {p.preApproved && <StatusBadge tone="ok" size="sm">Pré-accord coach</StatusBadge>}
                  {p.waveChange && (
                    <StatusBadge tone="accent" size="sm" data-testid="wave-change">
                      ↪ Change de session : {waveName(p.waveChange.from)} → {waveName(p.waveChange.to)}
                    </StatusBadge>
                  )}
                  {p.waveShifts.length > 0 && (
                    <StatusBadge tone="accent" size="sm" data-testid="wave-shift">
                      ↪ Emmène {plural(p.waveShifts.length, 'autre combattant', 'autres combattants')} dans une autre session
                    </StatusBadge>
                  )}
                </Group>
                <Group gap={4} wrap="nowrap">
                  <Button size="xs" variant="default" data-testid="proposal-preview" onClick={() => openProposal(p, false)}>Aperçu</Button>
                  <Button size="xs" data-testid="proposal-apply" onClick={() => openProposal(p, true)}>Valider</Button>
                  <Button size="xs" variant="subtle" color="red" data-testid="proposal-refuse" onClick={() => refuse.mutate({ proposalId: p.id })}>Refuser</Button>
                </Group>
              </Group>
            );
          })}
          <Group gap="xs">
            <Select size="xs" w={420} placeholder="Déplacer manuellement vers…" searchable clearable data-testid="manual-move-select"
              nothingFoundMessage={allTargets[c.id] ? 'Aucune catégorie' : 'Aucune catégorie compatible : cochez « Toutes les catégories »'}
              data={moveOptions(c.id)}
              value={moveTarget[c.id] ?? null} onChange={(v) => setMoveTarget({ ...moveTarget, [c.id]: v })} />
            <Switch size="xs" label="Toutes les catégories (règles enfreintes)" data-testid="manual-move-all" checked={allTargets[c.id] ?? false}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                setAllTargets({ ...allTargets, [c.id]: on });
                if (!on && moveTarget[c.id] && !data.moveTargets[c.id]?.some((t) => t.categoryId === moveTarget[c.id] && t.warnings.length === 0)) setMoveTarget({ ...moveTarget, [c.id]: null });
              }} />
            <Button size="xs" variant="default" disabled={!moveTarget[c.id]} data-testid="manual-move"
              onClick={() => {
                setDialog({ kind: 'move', registrationId: c.registrationId, categoryId: moveTarget[c.id]! });
                preview.mutate({ move: { registrationId: c.registrationId, categoryId: moveTarget[c.id]! } });
              }}>
              Déplacer…
            </Button>
          </Group>
          {c.kind === 'closed' && (
            <Group gap="xs">
              <Button size="xs" variant="default" data-testid="case-withdraw"
                onClick={() => setDialog({ kind: 'withdraw', registrationId: c.registrationId, categoryLabel: categories.find((x) => x.id === c.categoryId)?.label ?? 'sa catégorie' })}>
                Ne combat pas
              </Button>
            </Group>
          )}
          {open.some((p) => 'newKey' in p.target) && (
            <Text size="xs" c="dimmed" data-testid="manual-move-new-hint">
              Le déplacement manuel ne liste que les catégories qui existent déjà : pour l’envoyer dans une catégorie encore vide, utilisez la proposition ci-dessus.
            </Text>
          )}
        </Stack>
      </Card>
    );
  };
  return (
    <Stack gap="md">
      {waveSelector}
      <RulesPanel id={id} waveId={waveId} ready={ready && (waves.length === 0 || waveId !== null)} fighter={fighter} targets={planTargets} />
      <SimpleGrid cols={{ base: 2, sm: 3, md: 5, xl: 9 }} spacing="sm" data-testid="replacement-summary">
        <Stat label="Présents" value={s.present} />
        <Stat label="Absents" value={s.absent} />
        <Stat label="Non pesés" value={s.unknown} />
        <Stat label="Cas à traiter" value={s.cases} tone={s.cases ? 'warn' : 'ok'} />
        <Stat label="Mises de côté" value={s.setAside} tone={s.setAside ? 'warn' : undefined} />
        <Stat label="Catégorie fermée" value={s.closed} />
        <Stat label="Sans adversaire" value={s.alone} />
        <Stat label="Sans solution automatique" value={s.withoutProposal} tone={s.withoutProposal ? 'danger' : undefined} />
        <Stat label="Catégories lancées" value={s.startedCategories} />
      </SimpleGrid>
      {waves.length > 0 && <Text size="sm" c="dimmed">Les changements de session se valident un par un.</Text>}
      <ApiErrorAlert error={apply.error ?? refuse.error ?? unrefuse.error ?? undo.error ?? move.error ?? withdraw.error ?? setAside.error ?? resume.error} />

      {activeCases.length === 0 && (
        <EmptyState icon="✓" title="Aucun cas à traiter"
          text={asideCases.length > 0 ? `${plural(asideCases.length, 'carte mise de côté', 'cartes mises de côté')}, à retrouver plus bas.` : 'Toutes les catégories ont au moins deux combattants et aucun poids n’est hors catégorie.'} />
      )}
      {activeCases.length > 0 && (
        <Chip.Group multiple value={kinds} onChange={setKinds}>
          <Group gap="xs" data-testid="case-filters">
            <Text size="sm" c="dimmed">Afficher :</Text>
            {(Object.keys(CASE_KINDS) as CaseKind[]).filter((k) => activeCases.some((c) => c.kind === k)).map((k) => (
              <Chip key={k} value={k} size="xs">{CASE_KINDS[k]} ({activeCases.filter((c) => c.kind === k).length})</Chip>
            ))}
          </Group>
        </Chip.Group>
      )}
      {activeCases.filter((c) => kinds.length === 0 || kinds.includes(c.kind)).map(caseCard)}

      {asideCases.length > 0 && (
        <Card withBorder padding="md" data-testid="set-aside-section">
          <Group justify="space-between" wrap="nowrap">
            <Group gap={4}>
              <Button variant="subtle" color="gray" size="compact-md" data-testid="set-aside-toggle" onClick={() => setAsideOpen((o) => !o)}>
                {asideOpen ? '▾' : '▸'} Mises de côté ({asideCases.length})
              </Button>
              <HelpButton topic="recasement.de-cote" />
            </Group>
          </Group>
          <Collapse in={asideOpen}>
            <Stack gap="xs" mt="sm">
              {asideCases.map((c) => {
                const mark = data.setAside[c.id]!;
                return (
                  <Stack key={c.id} gap="xs">
                    <Group justify="space-between" wrap="nowrap" data-testid="set-aside-row" p="xs" style={{ border: '1px solid var(--sk-line)', borderRadius: 'var(--mantine-radius-md)', cursor: 'pointer' }}
                      onClick={() => setExpanded((e) => ({ ...e, [c.id]: !e[c.id] }))}>
                      <Group gap="xs" wrap="wrap" style={{ minWidth: 0 }}>
                        <Text fw={600} size="sm">{name(c.registrationId)}</Text>
                        <StatusBadge tone="warn" size="sm">{CASE_KINDS[c.kind]}</StatusBadge>
                        {mark.note && <Text size="sm" c="dimmed">« {mark.note} »</Text>}
                        <Text size="xs" c="dimmed" className="num">{new Date(mark.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</Text>
                      </Group>
                      <Button size="xs" variant="default" data-testid="case-resume" onClick={(e) => { e.stopPropagation(); resume.mutate({ caseId: c.id }); }}>Reprendre</Button>
                    </Group>
                    {expanded[c.id] && caseCard(c)}
                  </Stack>
                );
              })}
            </Stack>
          </Collapse>
        </Card>
      )}

      <SectionCard title={HELP['recasement.valides'].title} help="recasement.valides"
        actions={data.recasements.length > 0 && (
          <Group gap="xs" data-testid="recasement-filters">
            <SegmentedControl size="xs" value={logState} onChange={(v) => setLogState(v as typeof logState)}
              data={[{ value: 'all', label: 'Toutes' }, { value: 'validated', label: 'Validées' }, { value: 'undone', label: 'Annulées' }]} />
            <Select size="xs" w={200} placeholder="Tous les types" clearable value={logType} onChange={setLogType}
              data={[...new Set(data.recasements.map((r) => r.type))].map((t) => ({ value: t, label: `${PROPOSAL_TYPES[t as ProposalType].label} — ${PROPOSAL_TYPES[t as ProposalType].title}` }))} />
          </Group>
        )}>
      {data.recasements.length === 0 ? (
        <Text size="sm" c="dimmed">Aucune pour l’instant.</Text>
      ) : (
        <Table>
          <Table.Tbody>
            {data.recasements.filter((r) => (logState === 'all' || r.status === logState) && (!logType || r.type === logType)).map((r) => (
              <Table.Tr key={r.id} data-testid="recasement-row">
                <Table.Td style={{ whiteSpace: 'nowrap' }}><ReplacementBadge type={r.type} state={r.status === 'undone' ? 'refused' : 'validated'} detail={r} /></Table.Td>
                <Table.Td fw={500}>{name(r.registrationId)}</Table.Td>
                <Table.Td>{r.fromLabel} → {r.toLabel}{r.reason && <Text size="xs" c="dimmed">{r.reason}</Text>}</Table.Td>
                <Table.Td>
                  {r.bulk ? 'en masse' : 'unitaire'}{r.bulk && r.manual ? ' · validé à la main' : ''}{r.preApproved ? ' · pré-accord coach' : ''}{r.status === 'undone' ? ' · annulée' : ''}
                  <Text size="xs" c="dimmed" className="num">{new Date(r.createdAt).toLocaleTimeString('fr-FR')}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  {r.status === 'validated' && (
                    <Button size="compact-sm" variant="subtle" color="red" data-testid="recasement-undo" onClick={() => setDialog({ kind: 'undo', recasementId: r.id, label: name(r.registrationId) })}>
                      Annuler
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      </SectionCard>

      <Modal opened={dialog?.kind === 'proposal' || dialog?.kind === 'move'} onClose={() => setDialog(null)} size="xl"
        title={dialog?.kind === 'move' ? 'Déplacement manuel' : 'Aperçu de la réaffectation'}>
        <Stack>
          {preview.isPending && <Text size="sm">Calcul de l’aperçu…</Text>}
          <ApiErrorAlert error={preview.error} />
          {preview.data?.warnings && preview.data.warnings.length > 0 && (
            <Alert color="orange" title="Règles enfreintes" data-testid="move-warnings">{preview.data.warnings.join(' ')}</Alert>
          )}
          {(dialog?.kind === 'proposal' || dialog?.kind === 'move') && (
            <WaveChangeWarning proposal={dialog.kind === 'proposal' ? dialog.proposal : preview.data?.steps[0]?.proposal} waves={waves} name={name} />
          )}
          {preview.data && <ProposalPreview data={preview.data} />}
          {dialog?.kind === 'move' && (
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDialog(null)}>Annuler</Button>
              <Button data-testid="manual-move-confirm" loading={move.isPending} disabled={!preview.data}
                onClick={() => move.mutate({ registrationId: dialog.registrationId, categoryId: dialog.categoryId }, { onSuccess: () => { setMoveTarget({}); done('Déplacement manuel effectué.'); } })}>
                Confirmer le déplacement
              </Button>
            </Group>
          )}
          {dialog?.kind === 'proposal' && dialog.confirm && (
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDialog(null)}>Annuler</Button>
              <Button data-testid="proposal-confirm" loading={apply.isPending}
                onClick={() => apply.mutate({ proposalId: dialog.proposal.id, fingerprint: data.fingerprint }, { onSuccess: () => done('Réaffectation validée.') })}>
                {/* Un cas simple n'a pas de validation manuelle ; une correction de poids au-delà de l'écart en a une. */}
                {dialog.proposal.manual ? 'Confirmer la validation' : 'Êtes-vous sûr ? Valider'}
              </Button>
            </Group>
          )}
        </Stack>
      </Modal>
      <Modal opened={dialog?.kind === 'set-aside'} onClose={() => setDialog(null)} title="Mettre cette carte de côté ?">
        <Stack>
          <Text size="sm">Elle ne comptera plus dans les cas à traiter ni dans le plan d’ensemble ; vous la retrouverez dans « Mises de côté ».</Text>
          <TextInput label="Note (facultative)" placeholder="ex. on attend le coach" maxLength={80} value={note} onChange={(e) => setNote(e.currentTarget.value)} data-testid="case-set-aside-note" />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDialog(null)}>Annuler</Button>
            <Button data-testid="case-set-aside-confirm" loading={setAside.isPending}
              onClick={() => dialog?.kind === 'set-aside' && setAside.mutate({ caseId: dialog.caseId, note }, { onSuccess: () => done('Carte mise de côté.') })}>
              Mettre de côté
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={dialog?.kind === 'withdraw'} onClose={() => setDialog(null)} title="Ne combat pas ?">
        <Stack>
          {dialog?.kind === 'withdraw' && <Text>{name(dialog.registrationId)} ne combattra pas en {dialog.categoryLabel}. Le coach le verra sur sa page d’inscription.</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDialog(null)}>Annuler</Button>
            <Button color="red" data-testid="case-withdraw-confirm" loading={withdraw.isPending}
              onClick={() => dialog?.kind === 'withdraw' && withdraw.mutate({ registrationId: dialog.registrationId, fingerprint: data.fingerprint }, { onSuccess: () => done('Inscription retirée : ne combat pas.') })}>
              Confirmer
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={dialog?.kind === 'undo'} onClose={() => setDialog(null)} title="Annuler cette réaffectation ?">
        <Stack>
          <Text>{dialog?.kind === 'undo' && dialog.label} retrouvera sa place d’avant.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDialog(null)}>Non</Button>
            <Button color="red" data-testid="recasement-undo-confirm"
              onClick={() => dialog?.kind === 'undo' && undo.mutate({ recasementId: dialog.recasementId }, { onSuccess: () => done('Réaffectation annulée.') })}>
              Annuler la réaffectation
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
