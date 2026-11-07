import {
  Badge, Button, Card, Checkbox, Grid, Group, Modal, ScrollArea, SegmentedControl, Select, Stack, Text, TextInput, Title, UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { compatibleFormats, type BracketFormat } from '../../domain/brackets/index.js';
import { activeEntrantCount, type Category, type CategoryStatus } from '../../domain/categories.js';
import { newSameClubPairs, sameClubSentence } from '../../domain/brackets/same-club.js';
import { normalizeName } from '../../domain/names.js';
import { plural } from '../../domain/plural.js';
import { useCategories, useHistory, usePassages, useRedraw, useRegenerate, useRegistrations, useReplacement, useSwap, useUpdateCategory, useZones } from '../api.js';
import { categoryPassages, kataPassageText, movedMatchZones } from '../passages.js';
import { useSelectedWave } from '../useSelectedWave.js';
import { usePoste } from '../poste.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { useUndoToast } from '../components/history/undoToast.js';
import { HistoryPanel, HISTORY_DRAWER_WIDTH } from '../components/history/HistoryPanel.js';
import { Planche, type SeeRequest } from '../components/planche/Planche.js';
import type { Scope } from '../components/planche/PlancheToolbar.js';
import { MoveEntrantPanel } from '../components/MoveEntrantPanel.js';
import { BracketView, type EntrantInfo } from '../components/BracketView.js';
import { useRecasementDetails } from '../components/ReplacementBadge.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { IconSearch } from '../components/ui/icons.js';
import { StatusBadge, type Tone } from '../components/ui/StatusBadge.js';
import { ALL_FORMAT_LABELS } from '../../domain/brackets/format-labels.js';

export const STATUS_LABELS: Record<CategoryStatus, string> = { provisional: 'Provisoire', ready: 'Prête', started: 'Lancée', finished: 'Terminée' };
/** Sens de l'état d'une catégorie : provisoire (neutre), prête (action), lancée (en cours), terminée (succès). */
export const STATUS_TONES: Record<CategoryStatus, Tone> = { provisional: 'neutral', ready: 'accent', started: 'warn', finished: 'ok' };

type View = 'planche' | 'liste';
const VIEW_KEY = 'tableaux-vue';
function storedView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'liste' ? 'liste' : 'planche'; } catch { return 'planche'; }
}

export function useEntrantInfo(competitionId: string): Map<string, EntrantInfo> {
  const { data: rows = [] } = useRegistrations(competitionId);
  return useMemo(
    () => new Map(rows.map((r) => [r.id, { name: `${r.fighter.lastName} ${r.fighter.firstName}`.trim(), club: r.club?.name ?? 'Sans club', grade: r.fighter.grade }])),
    [rows],
  );
}

function OptionToggle({ label, value, inherited, onChange, disabled }: { label: string; value: boolean | null; inherited: boolean; onChange: (v: boolean | null) => void; disabled: boolean }) {
  return (
    <Select size="sm" w={260} label={label} disabled={disabled} allowDeselect={false}
      data={[{ value: 'inherit', label: `Comme la compétition (${inherited ? 'oui' : 'non'})` }, { value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }]}
      value={value === null ? 'inherit' : value ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'inherit' ? null : v === 'yes')} />
  );
}

export function BracketsPage({ settingsRepechage = false, settingsThird = false }: { settingsRepechage?: boolean; settingsThird?: boolean }) {
  const { id = '' } = useParams();
  // Poste « Zone » : tableaux en lecture (pas de format, de tirage ni d'échange depuis l'écran d'une zone).
  const [poste] = usePoste(id);
  const readOnlyPoste = poste.kind === 'zone';
  const { data: categories = [], isLoading: loadingCategories } = useCategories(id);
  const { data: zones = [] } = useZones(id);
  const { data: plan } = usePassages(id);
  const entrants = useEntrantInfo(id);
  const update = useUpdateCategory(id);
  const regenerate = useRegenerate(id);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const redraw = useRedraw(id);
  const swap = useSwap(id);
  const undoToast = useUndoToast(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyAlone, setOnlyAlone] = useState(false);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  // Avec des vagues : les catégories de la vague choisie (la même que dans les autres onglets), celles en attente, ou toutes.
  const { waves, waveId, select } = useSelectedWave(id);
  // `?vue=planche|liste` et `?voir=id1,id2` (lien « Voir » de la Réaffectation) ne sont lus qu'au chargement.
  const [, setParams] = useSearchParams();
  const first = useRef<{ vue: string | null; voir: string[] } | null>(null);
  if (first.current === null) {
    const q = new URLSearchParams(window.location.search);
    first.current = { vue: q.get('vue'), voir: (q.get('voir') ?? '').split(',').filter(Boolean) };
  }
  const [view, setView] = useState<View>(() => (first.current!.vue === 'planche' || first.current!.vue === 'liste' ? first.current!.vue : first.current!.voir.length ? 'planche' : storedView()));
  const [scope, setScope] = useState<Scope>(first.current.voir.length ? 'all' : 'wave');
  const [seeRequest, setSeeRequest] = useState<SeeRequest | null>(first.current.voir.length ? { ids: first.current.voir, n: 1 } : null);
  useEffect(() => {
    setParams((p) => { p.delete('vue'); p.delete('voir'); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chooseView = (v: string) => {
    setView(v as View);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* stockage indisponible : le choix vaut pour cette visite */ }
  };
  // Historique : tiroir à droite ; au-dessus de `lg`, la page se resserre pour lui laisser la place.
  const [historyOpen, setHistoryOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 75em)');
  const { data: history } = useHistory(id, scope === 'wave' ? waveId : null);
  const historyCount = (history?.entries ?? []).filter((e) => e.status === 'active').length;

  const { data: registrations = [] } = useRegistrations(id);
  const badges = useMemo(() => new Map(registrations.filter((r) => r.recasementType).map((r) => [r.id, r.recasementType!])), [registrations]);
  const badgeDetails = useRecasementDetails(id);
  const { data: replacement } = useReplacement(id);
  const casesByCategory = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of replacement?.cases ?? []) if (c.categoryId) out.set(c.categoryId, (out.get(c.categoryId) ?? 0) + 1);
    return out;
  }, [replacement]);
  // Dont mises de côté.
  const asideByCategory = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of replacement?.cases ?? []) if (c.categoryId && replacement?.setAside[c.id]) out.set(c.categoryId, (out.get(c.categoryId) ?? 0) + 1);
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
        : `/competitions/${id}/impression?session=${encodeURIComponent(waveId ?? '')}`;
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
      const before = selected.bracket;
      const nameOf = (x: string) => entrants.get(x)?.name ?? '?';
      swap.mutate({ cid: selected.id, a: swapFrom, b: rid }, {
        onSuccess: (c) => undoToast(
          `Places échangées : ${nameOf(swapFrom)} ↔ ${nameOf(rid)}`, c.historyId ?? null,
          newSameClubPairs(before, c.bracket).map((p) => sameClubSentence(p, (x) => entrants.get(x) ?? { name: '?', club: '?' })),
        ),
      });
      setSwapFrom(null);
    }
  };

  // « Voir » (historique) : la planche, les cartes entourées ; « Toutes » si une carte n'est pas dans la session affichée.
  const onSee = (ids: string[]) => {
    if (waves.length > 0 && scope !== 'all' && ids.some((x) => !inScope(categories.find((c) => c.id === x) ?? ({ waveId: undefined } as unknown as Category)))) setScope('all');
    setView('planche');
    setSeeRequest((r) => ({ ids, n: (r?.n ?? 0) + 1 }));
  };
  const onSelectScope = (v: string) => {
    if (v === 'waiting' || v === 'all') setScope(v);
    else { setScope('wave'); select(v); }
    setSelectedId(null);
  };
  const openInList = (cid: string) => {
    const c = categories.find((x) => x.id === cid);
    if (c && !inScope(c)) setScope('all');
    setSelectedId(cid); setSwapFrom(null); setView('liste');
  };

  return (
    <>
    <Stack gap="sm" style={historyOpen && wide ? { marginRight: HISTORY_DRAWER_WIDTH } : undefined}>
    <Group justify="flex-end">
      <SegmentedControl size="xs" data-testid="brackets-view" value={view} onChange={chooseView} data={[{ value: 'planche', label: 'Planche' }, { value: 'liste', label: 'Liste' }]} />
    </Group>
    {view === 'planche' && (
      <Planche competitionId={id} categories={categories} waves={waves} waveId={waveId} scope={scope} onScope={onSelectScope} readOnly={readOnlyPoste}
        entrants={entrants} badges={badges} badgeDetails={badgeDetails} cases={casesByCategory} aside={asideByCategory} historyCount={historyCount}
        onHistory={() => setHistoryOpen((o) => !o)} seeRequest={seeRequest} onConsumed={() => setSeeRequest(null)} onOpenList={openInList} />
    )}
    {view === 'liste' && (
    <Grid>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <Stack gap="xs">
          {!readOnlyPoste && (
            <Group justify="flex-end">
              <Button size="compact-sm" variant="default" data-testid="history-open" onClick={() => setHistoryOpen((o) => !o)}>Historique ({historyCount})</Button>
            </Group>
          )}
          {waves.length > 0 && (
            <SegmentedControl size="xs" data-testid="brackets-wave" value={scope === 'wave' ? (waveId ?? '') : scope}
              onChange={(v) => {
                if (v === 'waiting' || v === 'all') setScope(v);
                else { setScope('wave'); select(v); }
                setSelectedId(null);
              }}
              data={[...waves.map((w) => ({ value: w.id, label: w.name })), ...(waiting ? [{ value: 'waiting', label: `En attente (${waiting})` }] : []), { value: 'all', label: 'Toutes' }]} />
          )}
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text size="sm" c="dimmed" className="num">
              {plural(shown.length, 'catégorie')} · {alone} sans adversaire{absentOnly ? ` · ${absentOnly} sans présent (non imprimée${absentOnly > 1 ? 's' : ''})` : ''}
            </Text>
            <Button size="compact-sm" variant="default" component={Link} to={printUrl} target="_blank" data-testid="print-all" style={{ flexShrink: 0 }}>
              {waves.length === 0 || scope === 'all' ? 'Imprimer tout' : scope === 'waiting' ? 'Imprimer celles en attente' : 'Imprimer la session'}
            </Button>
          </Group>
          <TextInput placeholder="Filtrer (ex. cadets, -54, kata)" leftSection={<IconSearch />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Checkbox size="sm" label="Seulement les catégories sans adversaire" checked={onlyAlone} onChange={(e) => setOnlyAlone(e.currentTarget.checked)} />
          <ScrollArea.Autosize mah="calc(100vh - 300px)" type="auto" offsetScrollbars>
            <Stack gap={6}>
              {filtered.length === 0 && <Text size="sm" c="dimmed" ta="center" py="md">{shown.length === 0 ? 'Aucune catégorie.' : 'Aucune catégorie ne correspond.'}</Text>}
              {filtered.map((c) => {
                const active = selected?.id === c.id;
                return (
                  <UnstyledButton key={c.id} data-testid="category-row" aria-current={active || undefined} onClick={() => { setSelectedId(c.id); setSwapFrom(null); }}>
                    <Card withBorder padding="xs" px="sm"
                      style={active ? { borderColor: 'var(--sk-accent)', backgroundColor: 'var(--sk-chip)', boxShadow: 'inset 3px 0 0 var(--sk-accent)' } : undefined}>
                      <Text size="sm" fw={600}>{c.label}</Text>
                      <Group gap={4} mt={4}>
                        <StatusBadge tone="neutral" size="sm" className="num">{plural(activeCount(c), 'inscrit')}{c.absentIds.length ? ` + ${plural(c.absentIds.length, 'absent')}` : ''}</StatusBadge>
                        <StatusBadge tone={STATUS_TONES[c.status]} size="sm" data-testid="category-status">{STATUS_LABELS[c.status]}</StatusBadge>
                        {activeCount(c) === 1 && <StatusBadge tone="danger" size="sm" data-testid="category-alone">Sans adversaire</StatusBadge>}
                        {allAbsent(c) && <StatusBadge tone="neutral" size="sm" data-testid="category-all-absent" title="Non imprimée">Tous absents</StatusBadge>}
                        {casesByCategory.get(c.id) && (
                          <Badge size="sm" variant="outline" color="orange" data-testid="category-cases" component={Link} to={`/competitions/${id}/reaffectation`}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ cursor: 'pointer' }} title="Ouvrir la réaffectation">
                            {casesByCategory.get(c.id)} cas à traiter{asideByCategory.get(c.id) ? ` (dont ${asideByCategory.get(c.id)} de côté)` : ''}
                          </Badge>
                        )}
                        {c.stale && <StatusBadge tone="warn" size="sm">Inscrits modifiés</StatusBadge>}
                      </Group>
                    </Card>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 8 }}>
        {!selected && !loadingCategories && (
          <EmptyState title="Aucun tableau à afficher"
            text={categories.length === 0 ? 'Les catégories se forment avec les inscriptions (étape Préparer).' : 'Choisissez une catégorie dans la liste.'} />
        )}
        {selected && (
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={6} style={{ minWidth: 0 }}>
                <Title order={3} fz="h3">{selected.label}</Title>
                <Group gap={6}>
                  <StatusBadge tone={STATUS_TONES[selected.status]} size="lg">{STATUS_LABELS[selected.status]}</StatusBadge>
                  {zones.find((z) => z.id === passages?.zoneId) && (
                    <StatusBadge tone="accent" size="lg" data-testid="category-zone">{zones.find((z) => z.id === passages?.zoneId)!.name}{passages?.auto ? ' (auto)' : ''}</StatusBadge>
                  )}
                  {passages && kataPassageText(passages, zones) && (
                    <StatusBadge tone="neutral" size="lg" data-testid="category-kata-passage">{kataPassageText(passages, zones)}</StatusBadge>
                  )}
                  {selected.stale && <StatusBadge tone="warn" size="lg">Les inscrits ont changé depuis le lancement</StatusBadge>}
                  {selected.stale && selected.launchLocked && !locked && (
                    <Button size="xs" color="orange" data-testid="category-regenerate" onClick={() => setConfirmRegenerate(true)}>Régénérer (renuméroté à la suite)</Button>
                  )}
                </Group>
              </Stack>
              <Button variant="default" component={Link} to={`/competitions/${id}/impression?categories=${selected.id}`} target="_blank" data-testid="print-category" style={{ flexShrink: 0 }}>
                Imprimer
              </Button>
            </Group>
            {!readOnlyPoste && (
            <Card withBorder padding="sm" data-testid="category-actions">
            <Stack gap="sm">
            <Group align="flex-end" gap="sm">
              <Select data-testid="category-format" size="sm" w={260} label="Format" disabled={locked} allowDeselect={false}
                data={[{ value: 'auto', label: `Automatique (${selected.effectiveFormat ? ALL_FORMAT_LABELS[selected.effectiveFormat] : '—'})` },
                  ...compatibleFormats(selected.key.discipline, activeCount(selected)).map((f) => ({ value: f, label: ALL_FORMAT_LABELS[f] }))]}
                value={selected.format && compatibleFormats(selected.key.discipline, activeCount(selected)).includes(selected.format) ? selected.format : 'auto'}
                onChange={(v) => update.mutate({ cid: selected.id, format: v === 'auto' ? null : (v as BracketFormat) }, {
                  onSuccess: (c) => undoToast(`Format changé : ${v === 'auto' ? 'automatique' : ALL_FORMAT_LABELS[v as BracketFormat]}`, c.historyId ?? null,
                    newSameClubPairs(selected.bracket, c.bracket).map((p) => sameClubSentence(p, (x) => entrants.get(x) ?? { name: '?', club: '?' }))),
                })} />
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
              <Text size="xs" c="orange">Le format imposé ({ALL_FORMAT_LABELS[selected.format]}) ne convient plus au nombre d’inscrits : format automatique utilisé.</Text>
            )}
            <Group gap="sm">
              <Button variant="default" data-testid="category-redraw" disabled={locked} onClick={() => redraw.mutate(selected.id, {
                onSuccess: (c) => undoToast(`Nouveau tirage : ${selected.label}`, c.historyId ?? null,
                  newSameClubPairs(selected.bracket, c.bracket).map((p) => sameClubSentence(p, (x) => entrants.get(x) ?? { name: '?', club: '?' }))),
              })}>
                Nouveau tirage
              </Button>
              {selected.status === 'provisional' && (
                <Button data-testid="category-ready" onClick={() => update.mutate({ cid: selected.id, status: 'ready' })}>Marquer prête</Button>
              )}
              {selected.status === 'ready' && (
                <Button variant="default" onClick={() => update.mutate({ cid: selected.id, status: 'provisional' })}>Repasser en provisoire</Button>
              )}
              {locked && (
                <Button color="orange" variant="light" data-testid="category-unlock" onClick={() => setConfirmUnlock(true)}>Déverrouiller</Button>
              )}
              {!locked && selected.bracket && (
                <Text size="sm" c={swapFrom ? undefined : 'dimmed'} fw={swapFrom ? 600 : undefined} data-testid="swap-select">
                  {selected.registrationIds.length === 1
                    ? 'Cliquez sur l’inscrit pour le déplacer.'
                    : swapFrom ? `Cliquez sur l’inscrit à échanger avec ${entrants.get(swapFrom)?.name}` : 'Échange manuel : cliquez sur deux inscrits.'}
                </Text>
              )}
            </Group>
            </Stack>
            </Card>
            )}
            <ApiErrorAlert error={update.error ?? redraw.error ?? swap.error ?? regenerate.error} />
            <BracketView category={selected} entrants={entrants} numbers={passages?.numbers} noRest={passages?.noRest} matchZones={movedMatchZones(passages, zones, selected.bracket)} selected={swapFrom} onSelect={locked || readOnlyPoste ? undefined : onSelectEntrant} badges={badges} badgeDetails={badgeDetails} />
            {swapFrom && !locked && !readOnlyPoste && selected.bracket && selected.registrationIds.includes(swapFrom) && (
              <MoveEntrantPanel key={swapFrom} competitionId={id} registrationId={swapFrom} name={entrants.get(swapFrom)?.name ?? ''} manual={badges.get(swapFrom) === 'M'} onDone={() => setSwapFrom(null)} />
            )}
          </Stack>
        )}
        <Modal opened={confirmRegenerate} onClose={() => setConfirmRegenerate(false)} title="Régénérer le tableau ?">
          <Stack>
            <Text>La session est lancée. Le tableau sera refait avec les inscrits actuels et ses combats recevront de nouveaux numéros, à la suite du dernier numéro de sa zone : réimprimez-le. Les autres catégories ne changent pas.</Text>
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
    )}
    </Stack>
    <HistoryPanel competitionId={id} waveId={scope === 'wave' ? waveId : null} mode="drawer" opened={historyOpen} onClose={() => setHistoryOpen(false)} onSee={onSee} />
    </>
  );
}
