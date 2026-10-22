import {
  Badge, Button, Card, Checkbox, Grid, Group, Modal, ScrollArea, SegmentedControl, Select, Stack, Text, TextInput, Title, UnstyledButton,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { compatibleFormats, type BracketFormat } from '../../domain/brackets/index.js';
import { activeEntrantCount, type Category, type CategoryStatus } from '../../domain/categories.js';
import { normalizeName } from '../../domain/names.js';
import { useCategories, usePassages, useRedraw, useRegenerate, useRegistrations, useReplacement, useSwap, useUpdateCategory, useZones } from '../api.js';
import { categoryPassages, kataPassageText, movedMatchZones } from '../passages.js';
import { useSelectedWave } from '../useSelectedWave.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { BracketView, type EntrantInfo } from '../components/BracketView.js';
import { useRecasementDetails } from '../components/ReplacementBadge.js';
import { FORMAT_LABELS } from './CompetitionSettingsPage.js';

export const ALL_FORMAT_LABELS: Record<BracketFormat, string> = { ...FORMAT_LABELS, kata_two_rounds: 'Kata : tour 1 puis finale à deux' };
export const STATUS_LABELS: Record<CategoryStatus, string> = { provisional: 'Provisoire', ready: 'Prête', started: 'Lancée', finished: 'Terminée' };
const STATUS_COLORS: Record<CategoryStatus, string> = { provisional: 'gray', ready: 'blue', started: 'orange', finished: 'green' };

export function useEntrantInfo(competitionId: string): Map<string, EntrantInfo> {
  const { data: rows = [] } = useRegistrations(competitionId);
  return useMemo(
    () => new Map(rows.map((r) => [r.id, { name: `${r.fighter.lastName} ${r.fighter.firstName}`.trim(), club: r.club?.name ?? 'Sans club', grade: r.fighter.grade }])),
    [rows],
  );
}

function OptionToggle({ label, value, inherited, onChange, disabled }: { label: string; value: boolean | null; inherited: boolean; onChange: (v: boolean | null) => void; disabled: boolean }) {
  return (
    <Select size="xs" w={260} label={label} disabled={disabled} allowDeselect={false}
      data={[{ value: 'inherit', label: `Comme la compétition (${inherited ? 'oui' : 'non'})` }, { value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }]}
      value={value === null ? 'inherit' : value ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'inherit' ? null : v === 'yes')} />
  );
}

export function BracketsPage({ settingsRepechage = false, settingsThird = false }: { settingsRepechage?: boolean; settingsThird?: boolean }) {
  const { id = '' } = useParams();
  const { data: categories = [] } = useCategories(id);
  const { data: zones = [] } = useZones(id);
  const { data: plan } = usePassages(id);
  const entrants = useEntrantInfo(id);
  const update = useUpdateCategory(id);
  const regenerate = useRegenerate(id);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const redraw = useRedraw(id);
  const swap = useSwap(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyAlone, setOnlyAlone] = useState(false);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  // Avec des vagues : les catégories de la vague choisie (la même que dans les autres onglets), celles en attente, ou toutes.
  const { waves, waveId, select } = useSelectedWave(id);
  const [scope, setScope] = useState<'wave' | 'waiting' | 'all'>('wave');

  const { data: registrations = [] } = useRegistrations(id);
  const badges = useMemo(() => new Map(registrations.filter((r) => r.recasementType).map((r) => [r.id, r.recasementType!])), [registrations]);
  const badgeDetails = useRecasementDetails(id);
  const { data: replacement } = useReplacement(id);
  const casesByCategory = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of replacement?.cases ?? []) if (c.categoryId) out.set(c.categoryId, (out.get(c.categoryId) ?? 0) + 1);
    return out;
  }, [replacement]);
  const activeCount = (c: Category) => activeEntrantCount(c);
  const allAbsent = (c: Category) => c.registrationIds.length > 0 && activeCount(c) === 0;
  const inScope = (c: Category) => waves.length === 0 || scope === 'all' || (scope === 'waiting' ? c.waveId === null : c.waveId === waveId);
  const shown = categories.filter(inScope);
  const filtered = shown.filter(
    (c) => (!search || normalizeName(c.label).includes(normalizeName(search))) && (!onlyAlone || activeCount(c) === 1),
  );
  const waiting = categories.filter((c) => c.waveId === null).length;
  const printUrl =
    waves.length === 0 || scope === 'all'
      ? `/competitions/${id}/impression`
      : scope === 'waiting'
        ? `/competitions/${id}/impression?categories=${shown.map((c) => c.id).join(',')}`
        : `/competitions/${id}/impression?vague=${encodeURIComponent(waveId ?? '')}`;
  const selected: Category | undefined = categories.find((c) => c.id === selectedId) ?? filtered[0];
  const locked = selected?.status === 'started' || selected?.status === 'finished';
  const passages = useMemo(() => (selected ? categoryPassages(plan, selected.id) : null), [plan, selected]);
  const alone = shown.filter((c) => activeCount(c) === 1).length;
  const absentOnly = shown.filter(allAbsent).length;

  const onSelectEntrant = (rid: string) => {
    if (!selected || locked) return;
    if (!swapFrom) setSwapFrom(rid);
    else if (swapFrom === rid) setSwapFrom(null);
    else {
      swap.mutate({ cid: selected.id, a: swapFrom, b: rid });
      setSwapFrom(null);
    }
  };

  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <Stack gap="xs">
          {waves.length > 0 && (
            <SegmentedControl size="xs" data-testid="brackets-wave" value={scope === 'wave' ? (waveId ?? '') : scope}
              onChange={(v) => {
                if (v === 'waiting' || v === 'all') setScope(v);
                else { setScope('wave'); select(v); }
                setSelectedId(null);
              }}
              data={[...waves.map((w) => ({ value: w.id, label: w.name })), ...(waiting ? [{ value: 'waiting', label: `En attente (${waiting})` }] : []), { value: 'all', label: 'Toutes' }]} />
          )}
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {shown.length} catégorie(s) · {alone} sans adversaire{absentOnly ? ` · ${absentOnly} sans présent (non imprimée${absentOnly > 1 ? 's' : ''})` : ''}
            </Text>
            <Button size="xs" variant="light" component={Link} to={printUrl} target="_blank" data-testid="print-all">
              {waves.length === 0 || scope === 'all' ? 'Imprimer tout' : scope === 'waiting' ? 'Imprimer celles en attente' : 'Imprimer la vague'}
            </Button>
          </Group>
          <TextInput size="xs" placeholder="Filtrer (ex. cadets, -54, kata)" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Checkbox size="xs" label="Seulement les catégories sans adversaire" checked={onlyAlone} onChange={(e) => setOnlyAlone(e.currentTarget.checked)} />
          <ScrollArea.Autosize mah="70vh">
            <Stack gap={4}>
              {filtered.map((c) => (
                <UnstyledButton key={c.id} data-testid="category-row" onClick={() => { setSelectedId(c.id); setSwapFrom(null); }}>
                  <Card withBorder padding="xs" style={{ borderColor: selected?.id === c.id ? 'var(--mantine-color-shidokan-5)' : undefined }}>
                    <Text size="sm" fw={500}>{c.label}</Text>
                    <Group gap={4} mt={2}>
                      <Badge size="xs" variant="light">{activeCount(c)} inscrit(s){c.absentIds.length ? ` + ${c.absentIds.length} absent(s)` : ''}</Badge>
                      <Badge size="xs" variant="light" color={STATUS_COLORS[c.status]} data-testid="category-status">{STATUS_LABELS[c.status]}</Badge>
                      {activeCount(c) === 1 && <Badge size="xs" color="red" data-testid="category-alone">Sans adversaire</Badge>}
                      {allAbsent(c) && <Badge size="xs" color="gray" variant="light" data-testid="category-all-absent" title="Non imprimée">Tous absents</Badge>}
                      {casesByCategory.get(c.id) && (
                        <Badge size="xs" color="orange" variant="outline" data-testid="category-cases" component={Link} to={`/competitions/${id}/recasement`}
                          onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ cursor: 'pointer' }}>
                          {casesByCategory.get(c.id)} cas à traiter
                        </Badge>
                      )}
                      {c.stale && <Badge size="xs" color="orange">Inscrits modifiés</Badge>}
                    </Group>
                  </Card>
                </UnstyledButton>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 8 }}>
        {selected && (
          <Stack>
            <Group justify="space-between" align="flex-start">
              <div>
                <Title order={4}>{selected.label}</Title>
                <Group gap={4}>
                  <Badge color={STATUS_COLORS[selected.status]}>{STATUS_LABELS[selected.status]}</Badge>
                  {zones.find((z) => z.id === passages?.zoneId) && (
                    <Badge variant="outline" data-testid="category-zone">{zones.find((z) => z.id === passages?.zoneId)!.name}{passages?.auto ? ' (auto)' : ''}</Badge>
                  )}
                  {passages && kataPassageText(passages, zones) && (
                    <Badge variant="outline" tt="none" data-testid="category-kata-passage">{kataPassageText(passages, zones)}</Badge>
                  )}
                  {selected.stale && <Badge color="orange">Les inscrits ont changé depuis le lancement</Badge>}
                  {selected.stale && selected.launchLocked && !locked && (
                    <Button size="xs" color="orange" data-testid="category-regenerate" onClick={() => setConfirmRegenerate(true)}>Régénérer (renuméroté à la suite)</Button>
                  )}
                </Group>
              </div>
              <Button size="xs" variant="light" component={Link} to={`/competitions/${id}/impression?categories=${selected.id}`} target="_blank" data-testid="print-category">
                Imprimer
              </Button>
            </Group>
            <Group align="flex-end">
              <Select data-testid="category-format" size="xs" w={260} label="Format" disabled={locked} allowDeselect={false}
                data={[{ value: 'auto', label: `Automatique (${selected.effectiveFormat ? ALL_FORMAT_LABELS[selected.effectiveFormat] : '—'})` },
                  ...compatibleFormats(selected.key.discipline, activeCount(selected)).map((f) => ({ value: f, label: ALL_FORMAT_LABELS[f] }))]}
                value={selected.format && compatibleFormats(selected.key.discipline, activeCount(selected)).includes(selected.format) ? selected.format : 'auto'}
                onChange={(v) => update.mutate({ cid: selected.id, format: v === 'auto' ? null : (v as BracketFormat) })} />
              {selected.key.discipline !== 'kata' && (
                <>
                  <OptionToggle label="Repêchage" value={selected.repechage} inherited={settingsRepechage} disabled={locked}
                    onChange={(v) => update.mutate({ cid: selected.id, repechage: v })} />
                  <OptionToggle label="Combat pour la 3e place" value={selected.thirdPlace} inherited={settingsThird} disabled={locked}
                    onChange={(v) => update.mutate({ cid: selected.id, thirdPlace: v })} />
                </>
              )}
            </Group>
            {selected.format && !compatibleFormats(selected.key.discipline, activeCount(selected)).includes(selected.format) && (
              <Text size="xs" c="orange">Le format imposé ({ALL_FORMAT_LABELS[selected.format]}) ne convient plus au nombre d'inscrits : format automatique utilisé.</Text>
            )}
            <Group>
              <Button size="xs" variant="default" data-testid="category-redraw" disabled={locked} onClick={() => redraw.mutate(selected.id)}>
                Nouveau tirage
              </Button>
              {selected.status === 'provisional' && (
                <Button size="xs" data-testid="category-ready" onClick={() => update.mutate({ cid: selected.id, status: 'ready' })}>Marquer prête</Button>
              )}
              {selected.status === 'ready' && (
                <Button size="xs" variant="default" onClick={() => update.mutate({ cid: selected.id, status: 'provisional' })}>Repasser en provisoire</Button>
              )}
              {locked && (
                <Button size="xs" color="orange" data-testid="category-unlock" onClick={() => setConfirmUnlock(true)}>Déverrouiller</Button>
              )}
              {!locked && selected.bracket && (
                <Text size="xs" c="dimmed" data-testid="swap-select">
                  {swapFrom ? `Cliquez sur l'inscrit à échanger avec ${entrants.get(swapFrom)?.name}` : 'Échange manuel : cliquez sur deux inscrits.'}
                </Text>
              )}
            </Group>
            <ApiErrorAlert error={update.error ?? redraw.error ?? swap.error ?? regenerate.error} />
            <BracketView category={selected} entrants={entrants} numbers={passages?.numbers} noRest={passages?.noRest} matchZones={movedMatchZones(passages, zones, selected.bracket)} selected={swapFrom} onSelect={locked ? undefined : onSelectEntrant} badges={badges} badgeDetails={badgeDetails} />
          </Stack>
        )}
        <Modal opened={confirmRegenerate} onClose={() => setConfirmRegenerate(false)} title="Régénérer le tableau ?">
          <Stack>
            <Text>La vague est lancée. Le tableau sera refait avec les inscrits actuels et ses combats recevront de nouveaux numéros, à la suite du dernier numéro de sa zone : réimprimez-le. Les autres catégories ne changent pas.</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmRegenerate(false)}>Annuler</Button>
              <Button color="orange" data-testid="regenerate-confirm" loading={regenerate.isPending}
                onClick={() => selected && regenerate.mutate(selected.id, { onSuccess: () => setConfirmRegenerate(false) })}>
                Régénérer
              </Button>
            </Group>
          </Stack>
        </Modal>
        <Modal opened={confirmUnlock} onClose={() => setConfirmUnlock(false)} title="Déverrouiller la catégorie ?">
          <Stack>
            <Text>La catégorie est lancée. La déverrouiller permet de la modifier, mais le tableau sera régénéré si ses inscrits ont changé.</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmUnlock(false)}>Annuler</Button>
              <Button color="orange" onClick={() => selected && update.mutate({ cid: selected.id, status: 'ready', unlock: true }, { onSuccess: () => setConfirmUnlock(false) })}>
                Déverrouiller
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Grid.Col>
    </Grid>
  );
}
