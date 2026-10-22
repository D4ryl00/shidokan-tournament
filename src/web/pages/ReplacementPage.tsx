import { Alert, Badge, Button, Card, Chip, Group, Modal, SegmentedControl, Select, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type { CaseKind, Proposal, ProposalType } from '../../domain/replacement/index.js';
import {
  useApplyProposal,
  useBulkReplacement,
  useCategories,
  useManualMove,
  usePreviewReplacement,
  useRefuseProposal,
  useUnrefuseProposal,
  useRegistrations,
  useReplacement,
  useUndoRecasement,
} from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionHeader } from '../components/Help.js';
import { ProposalPreview } from '../components/ProposalPreview.js';
import { PROPOSAL_TYPES, ReplacementBadge } from '../components/ReplacementBadge.js';

type Dialog =
  | { kind: 'proposal'; proposal: Proposal; confirm: boolean }
  | { kind: 'bulk'; mode: 'simple' | 'all' }
  | { kind: 'undo'; recasementId: string; label: string }
  | { kind: 'move'; registrationId: string; categoryId: string }
  | null;

const CASE_KINDS: Record<CaseKind, string> = { alone: 'Sans adversaire', weight_out: 'Poids hors catégorie', weight_gap: 'Écart de poids', return: 'Retour possible' };
const kg = (x: number) => Number(x.toFixed(1)).toString().replace('.', ',');

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Card withBorder padding="xs">
      <Text size="xl" fw={700} c={color}>{value}</Text>
      <Text size="xs" c="dimmed">{label}</Text>
    </Card>
  );
}

export function ReplacementPage() {
  const { id = '' } = useParams();
  const { data } = useReplacement(id);
  const { data: rows = [] } = useRegistrations(id);
  const { data: categories = [] } = useCategories(id);
  const preview = usePreviewReplacement(id);
  const apply = useApplyProposal(id);
  const refuse = useRefuseProposal(id);
  const unrefuse = useUnrefuseProposal(id);
  const bulk = useBulkReplacement(id);
  const undo = useUndoRecasement(id);
  const move = useManualMove(id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [moveTarget, setMoveTarget] = useState<Record<string, string | null>>({});
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
  const openBulk = (mode: 'simple' | 'all') => {
    setDialog({ kind: 'bulk', mode });
    preview.mutate({ bulk: mode });
  };
  const done = (message: string) => {
    setDialog(null);
    notifications.show({ color: 'green', message });
  };

  if (!data) return null;
  const s = data.summary;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 4, md: 7 }} data-testid="replacement-summary">
        <Stat label="Présents" value={s.present} />
        <Stat label="Absents" value={s.absent} />
        <Stat label="Non pesés" value={s.unknown} />
        <Stat label="Cas à traiter" value={s.cases} color={s.cases ? 'orange' : 'green'} />
        <Stat label="Sans adversaire" value={s.alone} />
        <Stat label="Sans solution automatique" value={s.withoutProposal} color={s.withoutProposal ? 'red' : undefined} />
        <Stat label="Catégories lancées" value={s.startedCategories} />
      </SimpleGrid>
      <Group>
        <Button data-testid="bulk-simple" onClick={() => openBulk('simple')} disabled={s.cases === 0}>Classer automatiquement tous les cas simples</Button>
        <Button data-testid="bulk-all" color="orange" variant="light" onClick={() => openBulk('all')} disabled={s.cases === 0}>Tout classer automatiquement</Button>
      </Group>
      <ApiErrorAlert error={apply.error ?? refuse.error ?? unrefuse.error ?? bulk.error ?? undo.error ?? move.error} />

      {data.cases.length === 0 && <Alert color="green" title="Aucun cas à traiter">Toutes les catégories ont au moins deux combattants et aucun poids n'est hors catégorie.</Alert>}
      {data.cases.length > 0 && (
        <Chip.Group multiple value={kinds} onChange={setKinds}>
          <Group gap="xs" data-testid="case-filters">
            <Text size="sm" c="dimmed">Afficher :</Text>
            {(Object.keys(CASE_KINDS) as CaseKind[]).filter((k) => data.cases.some((c) => c.kind === k)).map((k) => (
              <Chip key={k} value={k} size="xs">{CASE_KINDS[k]} ({data.cases.filter((c) => c.kind === k).length})</Chip>
            ))}
          </Group>
        </Chip.Group>
      )}
      {data.cases.filter((c) => kinds.length === 0 || kinds.includes(c.kind)).map((c) => {
        const proposals = data.proposals[c.id] ?? [];
        const open = proposals.filter((p) => !p.refused);
        return (
          <Card key={c.id} withBorder data-testid="replacement-case">
            <Group justify="space-between" mb="xs">
              <div>
                <Text fw={600}>{name(c.registrationId)}</Text>
                <Text size="sm" c="dimmed">{c.detail}</Text>
              </div>
              <Badge variant="light" color={c.kind === 'return' ? 'gray' : 'orange'}>
                {CASE_KINDS[c.kind]}
              </Badge>
            </Group>
            <Stack gap="xs">
              {open.length === 0 && <Text size="sm" c="red">Aucune solution automatique : déplacer manuellement ou laisser sans adversaire.</Text>}
              {proposals.map((p) => {
                const simple = PROPOSAL_TYPES[p.type].simple;
                if (p.refused) {
                  return (
                    <Group key={p.id} justify="space-between" wrap="nowrap" data-testid="replacement-proposal-refused" style={{ opacity: 0.55 }}>
                      <Group gap="xs" wrap="nowrap">
                        <ReplacementBadge type={p.type} state="refused" gapKg={p.checks.weightGapKg} />
                        <Text size="sm" td="line-through">{p.reason}</Text>
                        <Text size="xs" c="dimmed">refusée</Text>
                      </Group>
                      <Button size="xs" variant="subtle" data-testid="proposal-unrefuse" onClick={() => unrefuse.mutate({ proposalId: p.id })}>Rétablir</Button>
                    </Group>
                  );
                }
                return (
                  <Group key={p.id} justify="space-between" wrap="nowrap" data-testid="replacement-proposal">
                    <Group gap="xs" wrap="nowrap">
                      <ReplacementBadge type={p.type} state="proposed" gapKg={p.checks.weightGapKg} />
                      <div>
                        <Text size="sm">{p.reason}</Text>
                        <Text size="xs" c="dimmed">
                          {PROPOSAL_TYPES[p.type].title}
                          {p.type === 'A' || p.type === 'B' ? ` · écart ${kg(p.checks.weightGapKg)} kg (max ${kg(p.checks.threshold)} kg)` : ''}
                          {p.checks.ageMove !== 'same' ? ' · âge : une tranche au-dessus' : ''}
                          {p.checks.mixedSex ? ' · mixte' : ''}
                          {p.manual ? ' · validation manuelle' : ' · cas simple'}
                        </Text>
                      </div>
                      {p.preApproved && <Badge color="green" variant="light" size="sm">pré-accord coach</Badge>}
                    </Group>
                    <Group gap={4} wrap="nowrap">
                      <Button size="xs" variant="default" data-testid="proposal-preview" onClick={() => openProposal(p, false)}>Aperçu</Button>
                      <Button size="xs" data-testid="proposal-apply" onClick={() => openProposal(p, true)}>{simple ? 'Classer automatiquement' : 'Valider'}</Button>
                      <Button size="xs" variant="subtle" color="red" data-testid="proposal-refuse" onClick={() => refuse.mutate({ proposalId: p.id })}>Refuser</Button>
                    </Group>
                  </Group>
                );
              })}
              <Group gap="xs">
                <Select size="xs" w={360} placeholder="Déplacer manuellement vers…" searchable clearable data-testid="manual-move-select"
                  data={categories.filter((x) => !x.registrationIds.includes(c.registrationId) && x.status !== 'started' && x.status !== 'finished').map((x) => ({ value: x.id, label: `${x.label} (${x.registrationIds.length - x.absentIds.length})` }))}
                  value={moveTarget[c.id] ?? null} onChange={(v) => setMoveTarget({ ...moveTarget, [c.id]: v })} />
                <Button size="xs" variant="default" disabled={!moveTarget[c.id]} data-testid="manual-move"
                  onClick={() => {
                    setDialog({ kind: 'move', registrationId: c.registrationId, categoryId: moveTarget[c.id]! });
                    preview.mutate({ move: { registrationId: c.registrationId, categoryId: moveTarget[c.id]! } });
                  }}>
                  Déplacer…
                </Button>
              </Group>
            </Stack>
          </Card>
        );
      })}

      <Group justify="space-between" mt="md">
        <SectionHeader topic="recasement.valides" />
        {data.recasements.length > 0 && (
          <Group gap="xs" data-testid="recasement-filters">
            <SegmentedControl size="xs" value={logState} onChange={(v) => setLogState(v as typeof logState)}
              data={[{ value: 'all', label: 'Tous' }, { value: 'validated', label: 'Validés' }, { value: 'undone', label: 'Annulés' }]} />
            <Select size="xs" w={200} placeholder="Tous les types" clearable value={logType} onChange={setLogType}
              data={[...new Set(data.recasements.map((r) => r.type))].map((t) => ({ value: t, label: `${PROPOSAL_TYPES[t as ProposalType].label} — ${PROPOSAL_TYPES[t as ProposalType].title}` }))} />
          </Group>
        )}
      </Group>
      {data.recasements.length === 0 ? (
        <Text size="sm" c="dimmed">Aucun pour l'instant.</Text>
      ) : (
        <Table>
          <Table.Tbody>
            {data.recasements.filter((r) => (logState === 'all' || r.status === logState) && (!logType || r.type === logType)).map((r) => (
              <Table.Tr key={r.id} data-testid="recasement-row">
                <Table.Td><ReplacementBadge type={r.type} state={r.status === 'undone' ? 'refused' : 'validated'} detail={r} /></Table.Td>
                <Table.Td>{name(r.registrationId)}</Table.Td>
                <Table.Td>{r.fromLabel} → {r.toLabel}{r.reason && <Text size="xs" c="dimmed">{r.reason}</Text>}</Table.Td>
                <Table.Td>
                  {r.bulk ? 'en masse' : 'unitaire'}{r.preApproved ? ' · pré-accord coach' : ''}{r.status === 'undone' ? ' · annulé' : ''}
                  <Text size="xs" c="dimmed">{new Date(r.createdAt).toLocaleTimeString('fr-FR')}</Text>
                </Table.Td>
                <Table.Td>
                  {r.status === 'validated' && (
                    <Button size="xs" variant="subtle" color="red" data-testid="recasement-undo" onClick={() => setDialog({ kind: 'undo', recasementId: r.id, label: name(r.registrationId) })}>
                      Annuler
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={dialog?.kind === 'proposal' || dialog?.kind === 'bulk' || dialog?.kind === 'move'} onClose={() => setDialog(null)} size="xl"
        title={dialog?.kind === 'bulk' ? (dialog.mode === 'simple' ? 'Classer automatiquement tous les cas simples' : 'Tout classer automatiquement') : dialog?.kind === 'move' ? 'Déplacement manuel' : 'Aperçu du recasement'}>
        <Stack>
          {preview.isPending && <Text size="sm">Calcul de l'aperçu…</Text>}
          <ApiErrorAlert error={preview.error} />
          {preview.data?.warnings && preview.data.warnings.length > 0 && (
            <Alert color="orange" title="Règles enfreintes" data-testid="move-warnings">{preview.data.warnings.join(' ')}</Alert>
          )}
          {preview.data && <ProposalPreview data={preview.data} />}
          {dialog?.kind === 'bulk' && dialog.mode === 'all' && (preview.data?.steps.some((x) => x.manual) ?? false) && (
            <Alert color="orange">Certains déplacements demandent normalement une validation manuelle (accord des coachs) : en confirmant, vous en prenez la responsabilité.</Alert>
          )}
          {dialog?.kind === 'move' && (
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDialog(null)}>Annuler</Button>
              <Button color="orange" data-testid="manual-move-confirm" loading={move.isPending} disabled={!preview.data}
                onClick={() => move.mutate({ registrationId: dialog.registrationId, categoryId: dialog.categoryId }, { onSuccess: () => done('Déplacement manuel effectué.') })}>
                Confirmer le déplacement
              </Button>
            </Group>
          )}
          {(dialog?.kind === 'bulk' || (dialog?.kind === 'proposal' && dialog.confirm)) && (
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDialog(null)}>Annuler</Button>
              {dialog.kind === 'proposal' ? (
                <Button data-testid="proposal-confirm" loading={apply.isPending}
                  onClick={() => apply.mutate({ proposalId: dialog.proposal.id, fingerprint: data.fingerprint }, { onSuccess: () => done('Recasement validé.') })}>
                  {PROPOSAL_TYPES[dialog.proposal.type].simple ? 'Êtes-vous sûr ? Classer' : 'Confirmer la validation'}
                </Button>
              ) : (
                <Button data-testid="bulk-confirm" loading={bulk.isPending} disabled={!preview.data || preview.data.steps.length === 0}
                  onClick={() => bulk.mutate({ mode: dialog.mode, fingerprint: data.fingerprint }, { onSuccess: (r) => done(`${r.applied ?? 0} recasement(s) appliqué(s).`) })}>
                  Confirmer ({preview.data?.steps.length ?? 0})
                </Button>
              )}
            </Group>
          )}
        </Stack>
      </Modal>
      <Modal opened={dialog?.kind === 'undo'} onClose={() => setDialog(null)} title="Annuler ce recasement ?">
        <Stack>
          <Text>{dialog?.kind === 'undo' && dialog.label} retrouvera sa place d'avant.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDialog(null)}>Non</Button>
            <Button color="red" data-testid="recasement-undo-confirm"
              onClick={() => dialog?.kind === 'undo' && undo.mutate({ recasementId: dialog.recasementId }, { onSuccess: () => done('Recasement annulé.') })}>
              Annuler le recasement
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
