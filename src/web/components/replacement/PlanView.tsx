import { Alert, Box, Button, Group, Modal, Select, Stack, Text, type ComboboxData } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { plural } from '../../../domain/plural.js';
import { applyRulesView, COST_BAND_LABELS, costBand, NO_VALIDATION_RULES, RULE_LABELS, type CostBand } from '../../../domain/replacement/rules.js';
import { defaultSettings, type RuleId } from '../../../domain/settings.js';
import { useApplyPlan, usePlanForApply, useRefuseProposal, useUnrefuseProposal, type PlanChoice, type PlanMove, type PlanResponse } from '../../api.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { ProposalPreview } from '../ProposalPreview.js';
import { BAND_COLOR } from './RuleLadder.js';

export interface PlanFighter {
  name: string;
  club: string | null;
}

const OUTSIDE: Record<NonNullable<PlanMove['outside']>, string> = { disabled: 'règle désactivée', 'below-cut': 'sous la ligne', 'breaks-rules': 'hors règles' };
const BANDS: CostBand[] = [4, 3, 2, 1, 0];
const ON_COLOR = 'var(--sk-on-cost)';
/** Message d'attention (recalcul, annulation, choix retirés) aux couleurs du thème. */
export const WARN_ALERT = {
  root: { background: 'var(--sk-warn)', border: '1px solid var(--sk-warn-text)' },
  title: { color: 'var(--sk-warn-text)' },
  message: { color: 'var(--sk-text)' },
};

/** « 1–3 », « 4, 6–7 » : les numéros de règles, regroupés quand ils se suivent. */
function ranges(ns: number[]): string {
  const sorted = [...new Set(ns)].sort((a, b) => a - b);
  const parts: [number, number][] = [];
  for (const n of sorted) {
    const last = parts[parts.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else parts.push([n, n]);
  }
  return parts.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
}

interface Change {
  registrationId: string;
  text: string;
}

/** Ce que le recalcul a changé, inscription par inscription (destination changée, ajout, retrait). */
function diff(before: PlanMove[], after: PlanMove[], name: (rid: string) => string): Change[] {
  const was = new Map(before.map((m) => [m.registrationId, m.toLabel]));
  const now = new Map(after.map((m) => [m.registrationId, m.toLabel]));
  const out: Change[] = [];
  for (const [rid, to] of now) {
    const old = was.get(rid);
    if (old === undefined) out.push({ registrationId: rid, text: `${name(rid)} : ${to}.` });
    else if (old !== to) out.push({ registrationId: rid, text: `${name(rid)} passe en ${to} au lieu de ${old}.` });
  }
  for (const rid of was.keys()) if (!now.has(rid)) out.push({ registrationId: rid, text: `${name(rid)} n’est plus déplacé.` });
  return out;
}

const pillStyle = (color: string, main: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '2px 7px', borderRadius: 10,
  border: `1.5px solid ${color}`, fontWeight: main ? 700 : 400, maxWidth: '100%', overflowWrap: 'anywhere',
});
const numberStyle = (color: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 16, height: 16, borderRadius: 8,
  background: color, color: ON_COLOR, fontSize: 10, fontWeight: 700, flex: 'none',
});

/**
 * Le plan d'ensemble de la session : résumé, ce que le dernier recalcul a changé, les déplacements par groupe de coût
 * (Valider, Refuser, Modifier, et leurs annulations), les refus, qui reste seul ; puis « Appliquer le plan ».
 * Les choix (épingles et « Modifier ») sont des données de la page ; les refus sont enregistrés sur le serveur.
 */
export function PlanView({
  id, waveId, data, choices, onChoices, dropped, computing, cancelled, fighter, targets,
}: {
  id: string;
  waveId: string | null;
  data: PlanResponse;
  choices: PlanChoice[];
  onChoices: (c: PlanChoice[]) => void;
  /** Noms des combattants dont un choix n'est plus possible et a été retiré. */
  dropped: string[];
  /** Un recalcul (ou l'enregistrement d'une règle) est en cours : les gestes restent possibles (chacun relance le calcul), « Appliquer le plan » attend. */
  computing: boolean;
  /** Calcul annulé : le plan affiché est périmé, on ne l'applique pas (les autres gestes relancent le calcul). */
  cancelled: boolean;
  fighter: (registrationId: string) => PlanFighter;
  /** Catégories proposées à « Modifier » ; `null` : pas de « Modifier » pour ce déplacement. */
  targets: (move: PlanMove) => ComboboxData | null;
}) {
  const { plan, view } = data;
  const refuse = useRefuseProposal(id);
  const unrefuse = useUnrefuseProposal(id);
  const forApply = usePlanForApply(id);
  const apply = useApplyPlan(id);
  const [confirming, setConfirming] = useState(false);
  const [modifying, setModifying] = useState<string | null>(null);
  const name = (rid: string) => fighter(rid).name;

  // Message du recalcul : on compare le plan affiché au précédent.
  const [shown, setShown] = useState(plan.moves);
  const [changes, setChanges] = useState<Change[]>([]);
  // Inscriptions dont le déplacement vient d'être appliqué : leur départ du plan n'est pas un changement à signaler.
  const [justApplied, setJustApplied] = useState<ReadonlySet<string>>(new Set());
  if (shown !== plan.moves) {
    setChanges(diff(shown, plan.moves, name).filter((c) => !justApplied.has(c.registrationId) || plan.moves.some((m) => m.registrationId === c.registrationId)));
    setShown(plan.moves);
  }
  const changed = new Set(changes.filter((c) => plan.moves.some((m) => m.registrationId === c.registrationId)).map((c) => c.registrationId));

  const settings = applyRulesView(defaultSettings(), view);
  const cut = view.order.indexOf(view.cutAfter);
  const isOn = (r: RuleId) => r === 'return' || view.on[r];
  const bandOf = (r: RuleId) => costBand(settings, r, !NO_VALIDATION_RULES.has(r));
  const number = (r: RuleId) => view.order.indexOf(r) + 1;

  const validateChoice = (m: PlanMove) => choices.find((c) => c.kind === 'validate' && c.proposalId === m.id);
  const manualChoice = (m: PlanMove) => (m.type === 'M' ? choices.find((c) => c.kind === 'manual' && c.registrationId === m.registrationId) : undefined);
  const without = (pred: (c: PlanChoice) => boolean) => choices.filter((c) => !pred(c));
  // L'erreur d'un refus (ou de son annulation) s'efface au geste suivant.
  const clearErrors = () => {
    if (refuse.isError) refuse.reset();
    if (unrefuse.isError) unrefuse.reset();
  };
  const choose = (c: PlanChoice[]) => { clearErrors(); setJustApplied(new Set()); onChoices(c); };

  // Déplacements dont les règles demandent une validation (un « Modifier » sans règle à valider n'en est pas un).
  const manualMoves = plan.moves.filter((m) => m.band !== 0);
  const validatedCount = manualMoves.filter((m) => m.validated).length;

  // Fermer la confirmation (ou quitter l'écran) annule le calcul du plan à appliquer.
  const applyAbort = useRef<AbortController | null>(null);
  useEffect(() => () => applyAbort.current?.abort(), []);
  const openApply = () => {
    apply.reset();
    setConfirming(true);
    applyAbort.current?.abort();
    applyAbort.current = new AbortController();
    forApply.mutate({ waveId, choices, signal: applyAbort.current.signal });
  };
  const closeApply = () => {
    applyAbort.current?.abort();
    forApply.reset();
    setConfirming(false);
  };
  const toApply = forApply.data;
  // À l'écran sans validation (ou validés), mais absents du plan à appliquer : ils dépendaient d'un déplacement à valider.
  const applied = new Set((toApply?.plan.moves ?? []).map((m) => m.registrationId));
  const skipped = toApply ? plan.moves.filter((m) => (m.band === 0 || m.validated) && !applied.has(m.registrationId)) : [];
  const confirm = () => {
    if (!toApply) return;
    // Posé avant l'envoi : le plan recalculé arrive avant la fin de la mutation (les données sont relues d'abord).
    setJustApplied(new Set(toApply.plan.moves.map((m) => m.registrationId)));
    apply.mutate(
      { ...(waveId ? { waveId } : {}), choices, fingerprint: toApply.fingerprint, hash: toApply.plan.hash },
      {
        onSuccess: (r) => {
          setConfirming(false);
          // Les choix appliqués disparaissent ; ceux qui attendent un déplacement à valider restent épinglés.
          onChoices(toApply.plan.waiting);
          notifications.show({ color: 'green', message: `${plural(r.applied ?? 0, 'réaffectation appliquée', 'réaffectations appliquées')}.` });
        },
        // Plan périmé ou changé : les choix restent, le plan est recalculé (rechargement des données) et l'erreur affichée.
        onError: () => { setJustApplied(new Set()); setConfirming(false); },
      },
    );
  };

  const moveRow = (m: PlanMove) => {
    const f = fighter(m.registrationId);
    const pinned = validateChoice(m);
    const chosen = manualChoice(m);
    const options = chosen ? null : targets(m);
    const highlight = changed.has(m.registrationId) ? 'var(--sk-warn)' : m.validated ? 'var(--sk-ok)' : undefined;
    return (
      <Box key={m.id} data-testid="plan-move" data-registration={m.registrationId}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', padding: '8px', borderTop: '1px solid var(--sk-line)', background: highlight }}>
        <Box style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
            {f.name}
            {(m.alsoMoved ?? []).map((r) => ` + ${name(r)}`).join('')}
            {f.club && <Text span size="xs" c="dimmed" fw={400}> · {f.club}</Text>}
          </Text>
          <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{m.reason.startsWith(`${f.name} : `) ? m.reason.slice(f.name.length + 3) : m.reason}</Text>
          {m.type === 'M' && <Text size="xs" style={{ overflowWrap: 'anywhere' }}>→ {m.toLabel}</Text>}
        </Box>
        <Box style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {m.details.map((d) => {
            const color = BAND_COLOR[bandOf(d.rule)]!;
            return (
              <span key={d.rule} data-testid="plan-rule" style={pillStyle(color, d.rule === m.costRule)}>
                <span style={numberStyle(color)} className="num">{number(d.rule)}</span>
                {RULE_LABELS[d.rule]}
                {d.detail && <Text span size="xs" c="dimmed" fw={400}>{d.detail}</Text>}
              </span>
            );
          })}
          {m.preApproved && <Text span size="xs" c="dimmed">pré-accord coach</Text>}
          {m.outside && <Text span size="xs" fw={600} c="var(--sk-warn-text)">{OUTSIDE[m.outside]}</Text>}
        </Box>
        <Group gap={4} style={{ flex: '0 1 auto', maxWidth: '100%' }}>
          {pinned ? (
            <Button size="compact-xs" variant="default" data-testid="plan-move-unvalidate" onClick={() => choose(without((c) => c === pinned))}>
              Annuler la validation
            </Button>
          ) : m.manual && !m.validated ? (
            <Button size="compact-xs" data-testid="plan-move-validate"
              onClick={() => choose([...choices, { kind: 'validate', proposalId: m.id, caseId: m.caseId }])}>
              Valider
            </Button>
          ) : null}
          {!chosen && (
            <Button size="compact-xs" variant="subtle" color="red" data-testid="plan-move-refuse" loading={refuse.isPending && refuse.variables?.proposalId === m.id}
              onClick={() => {
                // Refusé, il n'est plus épinglé : retiré tout de suite (pas au retour du serveur, qui partirait d'anciens choix).
                if (pinned) choose(without((c) => c === pinned));
                if (unrefuse.isError) unrefuse.reset();
                refuse.mutate({ proposalId: m.id });
              }}>
              Refuser
            </Button>
          )}
          {chosen ? (
            <Button size="compact-xs" variant="default" data-testid="plan-move-unchoose" onClick={() => choose(without((c) => c === chosen))}>
              Annuler le choix
            </Button>
          ) : options ? (
            <Button size="compact-xs" variant="default" data-testid="plan-move-modify" onClick={() => setModifying(modifying === m.id ? null : m.id)}>
              Modifier
            </Button>
          ) : null}
        </Group>
        {modifying === m.id && options && (
          <Box style={{ flex: '1 1 100%', minWidth: 0 }}>
            <Select size="xs" maw={420} placeholder="Choisir la catégorie…" searchable data-testid="plan-move-target" data={options}
              nothingFoundMessage="Aucune catégorie" comboboxProps={{ withinPortal: true }}
              onChange={(v) => {
                if (!v) return;
                setModifying(null);
                choose([
                  ...without((c) => (c.kind === 'validate' && c.proposalId === m.id) || (c.kind === 'manual' && c.registrationId === m.registrationId)),
                  { kind: 'manual', registrationId: m.registrationId, categoryId: v },
                ]);
              }} />
          </Box>
        )}
      </Box>
    );
  };

  const groupTitle: CSSProperties = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--sk-muted)' };

  return (
    <Stack gap="sm" data-testid="plan-view">
      <Group gap="lg" wrap="wrap">
        <Text size="sm">Restent seuls{' '}<b className="num">{plan.alone.length}</b>{' '}<Text span size="sm" c="dimmed">(au lieu de {plan.aloneBefore})</Text></Text>
        <Text size="sm">Déplacements{' '}<b className="num">{plan.moves.length}</b></Text>
        <Text size="sm">Validés{' '}<b className="num">{validatedCount} / {manualMoves.length}</b></Text>
        <Button size="xs" data-testid="plan-apply" onClick={openApply} loading={forApply.isPending} disabled={computing || cancelled || refuse.isPending || unrefuse.isPending}>Appliquer le plan</Button>
      </Group>
      <ApiErrorAlert error={apply.error ?? refuse.error ?? unrefuse.error} />

      {changes.length > 0 && (
        <Alert data-testid="plan-changes" p="xs" styles={WARN_ALERT}>
          <Stack gap={2}>{changes.map((c) => <Text key={c.registrationId} size="sm">{c.text}</Text>)}</Stack>
        </Alert>
      )}

      {BANDS.map((b) => {
        const moves = plan.moves.filter((m) => m.band === b);
        if (moves.length === 0) return null;
        const covered = view.order
          .map((r, i) => ({ r, i }))
          .filter(({ r, i }) => i <= cut && isOn(r) && bandOf(r) === b)
          .map(({ i }) => i + 1)
          .concat(moves.flatMap((m) => (m.costRule ? [number(m.costRule)] : [])));
        const rules = covered.length === 0 ? '' : `${new Set(covered).size > 1 ? 'règles' : 'règle'} ${ranges(covered)} · `;
        return (
          <Box key={b} data-testid="plan-band" data-band={b} style={{ border: '1px solid var(--sk-card-line)', borderRadius: 8, overflow: 'hidden' }}>
            <Box style={{ background: BAND_COLOR[b], color: ON_COLOR, padding: '4px 8px', display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{COST_BAND_LABELS[b]}</span>
              <span style={{ fontSize: 12 }}>{rules}{plural(moves.length, 'déplacement', 'déplacements')}</span>
            </Box>
            {moves.map(moveRow)}
          </Box>
        );
      })}

      <Box data-testid="plan-alone">
        <Text style={groupTitle}>Restent seuls ({plan.alone.length})</Text>
        {plan.alone.length > 0 && <Text size="sm">{plan.alone.map(name).join(' · ')}</Text>}
      </Box>
      {plan.onCards.length > 0 && (
        <Box data-testid="plan-on-cards">
          <Text style={groupTitle}>À traiter sur sa carte ({plan.onCards.length})</Text>
          <Text size="sm">{plan.onCards.map(name).join(' · ')}</Text>
        </Box>
      )}
      {dropped.length > 0 && (
        <Alert data-testid="plan-dropped" p="xs" styles={WARN_ALERT}>Certains choix ne sont plus possibles et ont été retirés : {dropped.join(', ')}.</Alert>
      )}
      {/* Plus personne de seul : rien à prouver. */}
      {(plan.alone.length > 0 || !plan.proven) && (
        <Text size="sm" c="dimmed" data-testid="plan-proven">
          {plan.proven ? `Aucune combinaison dans ces règles ne laisse moins de ${plural(plan.alone.length, 'seul', 'seuls')}.` : 'Meilleur plan trouvé.'}
        </Text>
      )}

      <Modal opened={confirming} onClose={closeApply} size="xl" title="Appliquer le plan">
        <Stack>
          {forApply.isPending && <Text size="sm">Calcul du plan à appliquer…</Text>}
          <ApiErrorAlert error={forApply.error ?? apply.error} />
          {toApply && !forApply.isPending && (
            <>
              <Text size="sm">
                {toApply.plan.moves.length === 0
                  ? 'Aucun déplacement à appliquer : les déplacements à valider doivent d’abord être validés.'
                  : `${plural(toApply.plan.moves.length, 'déplacement sera appliqué', 'déplacements seront appliqués')} :`}
              </Text>
              {toApply.plan.moves.length > 0 && (
                <Stack gap={4} data-testid="plan-apply-moves">
                  {toApply.plan.moves.map((m) => {
                    const onScreen = plan.moves.find((x) => x.registrationId === m.registrationId);
                    return (
                      <Text key={m.id} size="sm" data-testid="plan-apply-move" style={{ overflowWrap: 'anywhere' }}>
                        <b>{name(m.registrationId)}</b> → {m.toLabel}
                        {m.validated ? ' · validé à la main' : ' · sans validation'}
                        {!onScreen && <Text span size="sm" c="var(--sk-warn-text)"> (pas à l’écran)</Text>}
                        {onScreen && onScreen.toLabel !== m.toLabel && <Text span size="sm" c="var(--sk-warn-text)"> (à l’écran : {onScreen.toLabel})</Text>}
                      </Text>
                    );
                  })}
                </Stack>
              )}
              {skipped.length > 0 && (
                <Stack gap={4} data-testid="plan-apply-skipped">
                  <Text size="sm">Ne {skipped.length > 1 ? 'seront' : 'sera'} pas {skipped.length > 1 ? 'appliqués' : 'appliqué'}, sans les déplacements à valider non validés :</Text>
                  {skipped.map((m) => (
                    <Text key={m.id} size="sm" c="var(--sk-warn-text)" style={{ overflowWrap: 'anywhere' }}>
                      <b>{name(m.registrationId)}</b> → {m.toLabel}
                      {m.validated ? ' · validé à la main, attend un déplacement à valider' : ' · sans validation'}
                    </Text>
                  ))}
                </Stack>
              )}
              {plan.moves.some((m) => m.manual && !m.validated) && (
                <Text size="sm" c="dimmed">
                  {plural(plan.moves.filter((m) => m.manual && !m.validated).length, 'déplacement à valider non validé reste', 'déplacements à valider non validés restent')} en attente dans le plan.
                </Text>
              )}
              {toApply.categories && toApply.categories.length > 0 && <ProposalPreview data={{ steps: [], categories: toApply.categories }} />}
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => closeApply()}>Annuler</Button>
            <Button data-testid="plan-apply-confirm" loading={apply.isPending} disabled={!toApply || forApply.isPending || toApply.plan.moves.length === 0} onClick={confirm}>
              Confirmer ({forApply.isPending ? 0 : (toApply?.plan.moves.length ?? 0)})
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
