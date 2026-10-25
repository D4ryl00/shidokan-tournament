import {
  Alert, Button, Card, Checkbox, FileButton, Group, List, Modal, Radio, Select, SimpleGrid, Stack, Table, Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { FFK_FIELDS, FFK_FIELD_LABELS, type FfkChoices, type FfkRow, type PlanItem } from '../../domain/ffk-import.js';
import { type FfkSheetSetup, useClubs, useCommitFfk, useGrid, usePreviewFfk, useUploadFfk } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionHeader } from '../components/Help.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { ageBandLabel, disciplineLabel } from '../labels.js';
import { plural } from '../../domain/plural.js';

const rowLabel = (r: FfkRow) => `${r.lastName} ${r.firstName}`;

export function FfkImportPage() {
  const { id = '' } = useParams();
  const { data: grid } = useGrid(id);
  const { data: clubs = [] } = useClubs(id);
  const upload = useUploadFfk(id);
  const preview = usePreviewFfk(id);
  const commit = useCommitFfk(id);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [sheets, setSheets] = useState<FfkSheetSetup[]>([]);
  const [choices, setChoices] = useState<FfkChoices>({});
  const [confirming, setConfirming] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const resetFile = useRef<() => void>(null);
  /** Cas douteux déjà rencontrés : ils restent affichés (et modifiables) une fois tranchés. */
  const [seenDoubtful, setSeenDoubtful] = useState<Map<string, Extract<PlanItem, { kind: 'doubtful' }>>>(new Map());
  const plan = preview.data;
  useEffect(() => {
    const fresh = (plan?.items ?? []).filter((i): i is Extract<PlanItem, { kind: 'doubtful' }> => i.kind === 'doubtful');
    if (fresh.some((d) => !seenDoubtful.has(d.row.key))) {
      setSeenDoubtful(new Map([...seenDoubtful, ...fresh.map((d) => [d.row.key, d] as const)]));
    }
  }, [plan, seenDoubtful]);

  const refresh = (s = sheets, c = choices) => uploadId && preview.mutate({ uploadId, sheets: s, choices: c });
  useEffect(() => {
    if (uploadId) refresh();
    // Recalcul à chaque changement de lien de club ou de décision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices]);

  const onFile = (file: File | null) => {
    setFileName(file?.name ?? null);
    preview.reset();
    commit.reset();
    setChoices({});
    setSeenDoubtful(new Map());
    if (!file) return;
    // Fichier envoyé : le champ est vidé pour qu'un nouveau choix du même fichier soit relu.
    resetFile.current?.();
    upload.mutate(file, {
      onSuccess: (r) => {
        setUploadId(r.uploadId);
        setSheets(r.sheets);
        preview.mutate({ uploadId: r.uploadId, sheets: r.sheets, choices: {} });
      },
    });
  };
  const setSheet = (i: number, patch: Partial<FfkSheetSetup>) => setSheets(sheets.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setClubLink = (entity: string, value: string) => setChoices({ ...choices, clubLinks: { ...choices.clubLinks, [entity]: value } });
  const setDecision = (key: string, value: string) => setChoices({ ...choices, decisions: { ...choices.decisions, [key]: value } });

  const doCommit = () =>
    uploadId &&
    commit.mutate(
      { uploadId, sheets, choices, fingerprint: plan?.fingerprint },
      {
        onError: () => {
          setConfirming(false);
          refresh();
        },
        onSuccess: (r) => {
          setConfirming(false);
          setFileName(null);
          resetFile.current?.();
          notifications.show({
            color: 'green',
            message: `Import FFK : ${plural(r.created, 'créée', 'créées')}, ${plural(r.updated, 'mise à jour', 'mises à jour')}, ${plural(r.removed, 'retirée', 'retirées')}, ${plural(r.weightClassesCreated, 'catégorie créée', 'catégories créées')}.`,
          });
          setUploadId(null);
          setSheets([]);
          preview.reset();
        },
      },
    );

  const items = plan?.items ?? [];
  const doubtful = [...seenDoubtful.values()];
  const pending = items.filter((i) => i.kind === 'doubtful').length;
  const updates = items.filter((i) => i.kind === 'update');
  const creates = items.filter((i) => i.kind === 'create');
  const errors = items.filter((i) => i.kind === 'error');
  const clubOptions = [{ value: 'new', label: '➕ Nouveau club' }, ...clubs.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <Stack gap="lg">
      <SectionCard title="Déposer l’export FFK"
        description="Fichier .xlsx, .ods ou .csv. Rien n’est enregistré avant « Importer ». L’export FFK fait foi pour l’âge, le poids et le club ; un règlement vide ne remplace pas celui de la fiche club.">
        <Group gap="sm">
          <FileButton onChange={onFile} accept=".xlsx,.xls,.ods,.csv" resetRef={resetFile} inputProps={{ 'data-testid': 'ffk-file' } as object}>
            {(props) => <Button variant={uploadId ? 'default' : 'filled'} loading={upload.isPending} {...props}>Choisir l’export FFK</Button>}
          </FileButton>
          {fileName && <Text size="sm" c="dimmed" className="sk-ellipsis" title={fileName}>{fileName}</Text>}
        </Group>
        <ApiErrorAlert error={upload.error ?? preview.error ?? commit.error} />
      </SectionCard>

      {sheets.length > 0 && (
        <SectionCard title="Onglets et colonnes" description="Les onglets à importer, et la colonne de l’export qui correspond à chaque information."
          actions={<Button variant="default" onClick={() => refresh()} loading={preview.isPending}>Recalculer l’aperçu</Button>}>
          <SimpleGrid cols={{ base: 1, md: Math.min(sheets.length, 3) }}>
            {sheets.map((s, i) => (
              <Card key={s.name} withBorder data-testid="ffk-sheet" style={{ backgroundColor: 'var(--sk-bg)' }}>
                <Checkbox data-testid="ffk-sheet-include" label={<b>{s.name}</b>} checked={s.include} onChange={(e) => setSheet(i, { include: e.currentTarget.checked })} />
                {s.include && (
                  <SimpleGrid cols={2} spacing="xs" verticalSpacing={4} mt="xs">
                    {FFK_FIELDS.map((f) => (
                      <Select key={f} data-testid={`ffk-map-${f}`} size="xs" label={FFK_FIELD_LABELS[f]} allowDeselect={false}
                        data={[{ value: '-1', label: '(aucune)' }, ...s.headers.map((h, j) => ({ value: String(j), label: h || `Colonne ${j + 1}` }))]}
                        value={String(s.mapping[f] ?? -1)}
                        onChange={(v) => setSheet(i, { mapping: { ...s.mapping, [f]: v === null || v === '-1' ? null : Number(v) } })} />
                    ))}
                  </SimpleGrid>
                )}
              </Card>
            ))}
          </SimpleGrid>
        </SectionCard>
      )}

      {plan && (
        <SectionCard title="Aperçu de l’import" data-testid="ffk-preview">
          <Alert data-testid="ffk-summary" color={plan.summary.doubtful ? 'orange' : 'blue'} title="Résumé">
            {plural(plan.summary.create, 'création')} · {plural(plan.summary.update, 'mise à jour', 'mises à jour')} · {plan.summary.doubtful} à trancher ·{' '}
            {plural(plan.summary.errors, 'erreur')} · {plural(plan.summary.removals, 'retrait')} · {plural(plan.summary.newWeightClasses, 'catégorie créée', 'catégories créées')}
          </Alert>

          {plan.clubs.length > 0 && (
            <>
              <SectionHeader topic="import-ffk.clubs" order={5} />
              <Table>
                <Table.Tbody>
                  {plan.clubs.map((c) => (
                    <Table.Tr key={c.clubEntity}>
                      <Table.Td>
                        {c.clubEntity}
                        {c.warning && <Text size="xs" c="orange">{c.warning}</Text>}
                      </Table.Td>
                      <Table.Td>
                        <StatusBadge tone={c.certainty === 'sure' ? 'ok' : c.certainty === 'doubtful' ? 'warn' : 'neutral'}>
                          {c.certainty === 'sure' ? 'Sûr' : c.certainty === 'doubtful' ? 'À vérifier' : 'Nouveau'}
                        </StatusBadge>
                      </Table.Td>
                      <Table.Td w={320}>
                        <Select data-testid="ffk-club-link" allowDeselect={false} data={clubOptions}
                          value={c.target.kind === 'existing' ? c.target.clubId : 'new'} onChange={(v) => v && setClubLink(c.clubEntity, v)} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}

          {doubtful.length > 0 && (
            <>
              <SectionHeader topic="import-ffk.rapprochements" order={5} suffix={`(${pending} sur ${doubtful.length})`} />
              {doubtful.map((d) =>
                d.kind === 'doubtful' ? (
                  <Card key={d.row.key} withBorder data-testid="ffk-doubtful">
                    <Text fw={500}>
                      FFK : {rowLabel(d.row)} — {d.row.clubName ?? 'sans club'} — {d.row.discipline ? disciplineLabel(d.row.discipline) : ''} (onglet {d.row.sheet}, ligne {d.row.line})
                    </Text>
                    <Radio.Group data-testid="ffk-doubtful-choice" value={choices.decisions?.[d.row.key] ?? ''} onChange={(v) => setDecision(d.row.key, v)}>
                      <Stack gap={4} mt="xs">
                        {d.candidates.map((c) => (
                          <Radio key={c.fighterId} value={c.fighterId} label={`C'est ${c.label} (${c.reason})`} />
                        ))}
                        <Radio value="new" label="Nouveau combattant" />
                      </Stack>
                    </Radio.Group>
                  </Card>
                ) : null,
              )}
            </>
          )}

          {updates.length > 0 && (
            <>
              <SectionHeader topic="import-ffk.mises-a-jour" order={5} suffix={`(${updates.length})`} />
              <List size="sm">
                {updates.map((u) =>
                  u.kind === 'update' ? (
                    <List.Item key={u.row.key}>
                      {rowLabel(u.row)} — {u.row.discipline && disciplineLabel(u.row.discipline)}
                      {u.changes.length ? ` : ${u.changes.join(' ; ')}` : ' : confirmée'}
                    </List.Item>
                  ) : null,
                )}
              </List>
            </>
          )}

          {creates.length > 0 && (
            <>
              <SectionHeader topic="import-ffk.creations" order={5} suffix={`(${creates.length})`} />
              <Text size="sm">
                {creates.map((c) => `${rowLabel(c.row)} (${c.row.ageBandCode ? ageBandLabel(grid, c.row.ageBandCode) : '?'}, ${c.row.discipline ? disciplineLabel(c.row.discipline) : '?'})`).join(' · ')}
              </Text>
            </>
          )}

          {errors.length > 0 && (
            <Alert color="red" title={`Lignes en erreur (${errors.length}) — elles ne seront pas importées`} data-testid="ffk-errors">
              <List size="sm">
                {errors.map((e) => (
                  <List.Item key={e.row.key}>
                    {e.row.sheet}, ligne {e.row.line} — {rowLabel(e.row)} : {e.row.errors.join(' ')}
                  </List.Item>
                ))}
              </List>
            </Alert>
          )}

          {plan.removals.length > 0 && (
            <Alert color="orange" title={`Retraits (${plan.removals.length}) : inscriptions FFK absentes du nouvel export`} data-testid="ffk-removals">
              {plan.removals.map((r) => r.label).join(' · ')}
            </Alert>
          )}
          {plan.unconfirmed.length > 0 && (
            <Alert color="gray" title={`Fiches club sans inscription FFK (${plan.unconfirmed.length}) — à inscrire sur place si besoin`} data-testid="ffk-unconfirmed">
              {plan.unconfirmed.map((r) => r.label).join(' · ')}
            </Alert>
          )}
          {plan.newWeightClasses.length > 0 && (
            <Alert color="blue" title="Catégories de poids créées dans la grille">
              {plan.newWeightClasses.map((w) => `${ageBandLabel(grid, w.ageBandCode)} ${w.sex === 'F' ? 'F' : 'M'} ${w.label}`).join(' · ')}
            </Alert>
          )}

          <Group>
            <Button data-testid="ffk-commit" disabled={plan.summary.doubtful > 0} onClick={() => setConfirming(true)}>
              Importer
            </Button>
            {plan.summary.doubtful > 0 && <Text size="sm" c="orange">Tranchez d’abord les rapprochements douteux.</Text>}
          </Group>
        </SectionCard>
      )}

      <Modal opened={confirming} onClose={() => setConfirming(false)} title="Confirmer l’import FFK">
        <Stack>
          <Text>
            {plural(plan?.summary.create ?? 0, 'création')}, {plural(plan?.summary.update ?? 0, 'mise à jour', 'mises à jour')}, {plural(plan?.summary.removals ?? 0, 'retrait')},{' '}
            {plural(plan?.summary.newWeightClasses ?? 0, 'catégorie créée', 'catégories créées')}.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>Annuler</Button>
            <Button data-testid="ffk-commit-confirm" onClick={doCommit} loading={commit.isPending}>Importer</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
