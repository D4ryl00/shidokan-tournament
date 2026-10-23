import { Alert, Badge, Button, Card, Grid, Group, NumberInput, Progress, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { resolveBracket, type ResolvedMatch } from '../../domain/brackets/index.js';
import { activeEntrantCount } from '../../domain/categories.js';
import { validResults } from '../../domain/results.js';
import { useCategories, useCategoryResults, useDeleteResult, usePassages, useSchedule, useUpdateCategory, useZones } from '../api.js';
import { ZonesImpossibleAlert } from '../components/ZonesImpossibleAlert.js';
import { WaveLaunchPanel } from '../components/WaveLaunchPanel.js';
import { MoveDialog } from '../components/MoveDialog.js';
import { categoryPassages, movedMatchZones } from '../passages.js';
import { useSelectedWave } from '../useSelectedWave.js';
import { usePoste } from '../poste.js';
import { BracketView, combatLabel } from '../components/BracketView.js';
import { KataScoring } from '../components/KataScoring.js';
import { HelpButton, HelpText, SectionHeader } from '../components/Help.js';
import { ResultDialog } from '../components/ResultDialog.js';
import { TieBreakDialog } from '../components/TieBreakDialog.js';
import { STATUS_LABELS, useEntrantInfo } from './BracketsPage.js';

export function MatchesPage() {
  const { id = '' } = useParams();
  const { data: categories = [], isSuccess: categoriesLoaded } = useCategories(id);
  const { data: plan } = usePassages(id);
  // Avec des vagues : par défaut, la première qui a encore des combats (inconnue tant que les catégories ne sont pas chargées).
  const { waves, waveId, select, ready } = useSelectedWave(id, (ws) => {
    if (!categoriesLoaded) return undefined;
    const ordered = [...ws].sort((a, b) => a.order - b.order);
    const busy = ordered.find((w) => categories.some((c) => c.waveId === w.id && c.bracket && activeEntrantCount(c) >= 2 && c.status !== 'finished'));
    return busy?.id ?? null;
  });
  const { data: schedule } = useSchedule(id, waveId, ready);
  const { data: zones = [] } = useZones(id);
  const zoneName = (zid: string | null) => zones.find((z) => z.id === zid)?.name ?? null;
  const update = useUpdateCategory(id);
  const clearIgnored = useDeleteResult(id);
  const entrants = useEntrantInfo(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogMatchId, setDialogMatchId] = useState<string | null>(null);
  const [tieOpen, setTieOpen] = useState(false);
  // Vague lancée : changer la zone d'une catégorie numérotée = « Déplacer vers… » (aperçu, renumérotation).
  const [moving, setMoving] = useState<{ category: { id: string; label: string }; zoneId: string } | null>(null);
  // Avec une vague : ses catégories seulement.
  // Poste « Zone » : seulement sa zone (catégories qui s'y jouent, sa file), sans les réglages de zone et d'ordre.
  const [poste] = usePoste(id);
  const zoneOnly = poste.kind === 'zone' ? poste.zoneId : null;
  // Une catégorie dont un passage est dans la file de la zone (finales sur la zone des finales) en fait partie aussi.
  const inZoneQueue = new Set((schedule?.zones ?? []).filter((t) => t.zone.id === zoneOnly).flatMap((t) => t.queue.map((q) => q.categoryId)));
  const playable = categories.filter(
    (c) =>
      c.bracket && activeEntrantCount(c) >= 2 && (!waveId || c.waveId === waveId) &&
      (!zoneOnly || (plan?.categories[c.id]?.zoneId ?? c.zoneId) === zoneOnly || inZoneQueue.has(c.id)),
  );
  // Choisie depuis la file d'une zone : trouvée parmi toutes les catégories (pas seulement la liste filtrée).
  const selected = playable.find((c) => c.id === selectedId) ?? categories.find((c) => c.id === selectedId && c.bracket) ?? null;
  const { data: res } = useCategoryResults(id, selected?.id ?? null);
  // Zone : automatique (répartie par l'app) ou épinglée à la main.
  const zoneOptions = (cid: string, launched: boolean) => {
    const auto = plan?.categories[cid]?.auto !== false ? zoneName(plan?.categories[cid]?.zoneId ?? null) : null;
    return [{ value: '', label: auto ? `Automatique (${auto})` : 'Automatique', disabled: launched }, ...zones.map((z) => ({ value: z.id, label: z.name }))];
  };
  const passages = useMemo(() => (selected ? categoryPassages(plan, selected.id) : null), [plan, selected]);

  const view = useMemo(() => {
    if (!selected?.bracket || selected.bracket.kind !== 'combat' || !res) return null;
    const { results, ignored } = validResults(selected.bracket, res.records, res.tieBreaks.pools);
    const { matches } = resolveBracket(selected.bracket, results, res.tieBreaks.pools);
    // Numéros de passage ; sans zone, numérotation propre à la catégorie (« c1 »).
    const local = new Map([...matches].filter((m) => !m.bye).sort((a, b) => a.order - b.order).map((m, i) => [m.id, i + 1]));
    const numbers = new Map([...local.keys()].map((mid) => [mid, combatLabel(mid, passages?.numbers, local)]));
    return { results, stale: new Set(ignored.map((r) => r.matchId)), matches, numbers };
  }, [selected, res, passages]);
  const dialogMatch: ResolvedMatch | null = (dialogMatchId && view?.matches.find((m) => m.id === dialogMatchId)) || null;
  const ties = res?.progress.podium.ties ?? [];
  const tieScope = res?.progress.podium.tieScopes?.[0] ?? null;

  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <SectionHeader topic="combats.categories" order={5} />
        <ScrollArea.Autosize mah="75vh">
          <Stack gap={4}>
            {playable.map((c) => (
              <Card key={c.id} withBorder padding="xs" data-testid="schedule-category" style={{ borderColor: c.id === selectedId ? 'var(--mantine-color-shidokan-5)' : undefined }}>
                <UnstyledButton onClick={() => setSelectedId(c.id)}>
                  <Text size="sm" fw={500}>{c.label}</Text>
                </UnstyledButton>
                <Group gap={4} mt={4}>
                  <Badge size="xs" variant="light">{STATUS_LABELS[c.status]}</Badge>
                  {!zoneOnly && (<>
                  <Select size="xs" w={190} data={zoneOptions(c.id, c.launchLocked)} value={c.zoneId ?? ''} allowDeselect={false} data-testid="schedule-zone" aria-label="Zone de combat"
                    onChange={(v) => (c.launchLocked ? v && v !== c.zoneId && setMoving({ category: c, zoneId: v }) : update.mutate({ cid: c.id, zoneId: v || null }))} />
                  <NumberInput key={`${c.id}-${c.order}`} size="xs" w={70} min={0} max={99} defaultValue={c.order} aria-label="Ordre" data-testid="schedule-order"
                    onBlur={(e) => { const v = Number(e.currentTarget.value); if (Number.isInteger(v) && v !== c.order) update.mutate({ cid: c.id, order: v }); }} />
                  </>)}
                </Group>
              </Card>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 8 }}>
        <Stack>
          <HelpText topic="combats.zone" />
          {waves.length > 0 && (
            <Group gap="xs">
              <Text size="sm" fw={600}>Session :</Text>
              <SegmentedControl data-testid="matches-wave" value={waveId ?? ''} onChange={select} data={waves.map((w) => ({ value: w.id, label: w.name }))} />
            </Group>
          )}
          {zoneOnly && zones.length > 0 && !zones.some((z) => z.id === zoneOnly) && (
            <Alert color="orange">La zone de ce poste n’existe plus : choisissez un autre poste en haut de l’écran.</Alert>
          )}
          {!zoneOnly && ready && (waves.length === 0 || waveId) && <WaveLaunchPanel competitionId={id} waveId={waveId} />}
          <ZonesImpossibleAlert impossible={schedule?.impossible} />
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {(schedule?.zones ?? []).filter((t) => !zoneOnly || t.zone.id === zoneOnly).map((t) => (
              <Card key={t.zone.id} withBorder data-testid="zone-card">
                <Group gap={4}><Title order={5}>{t.zone.name}</Title><HelpButton topic="combats.zone" /></Group>
                {t.queue.length === 0 && <Text size="sm" c="dimmed">Aucun combat en attente.</Text>}
                {t.queue.map((q) =>
                  q.matchId === null ? (
                    <Group key={`${q.categoryId}-kata`} justify="space-between" wrap="nowrap" mt={6} data-testid="next-kata">
                      <Text size="sm">n° {q.number} — {q.categoryLabel}{q.kataPart === 'tour1' ? ' (tour 1)' : q.kataPart === 'finale' ? ' (finale)' : ''}, {q.katakas} katakas</Text>
                      <Button size="xs" variant="light" style={{ flexShrink: 0 }} onClick={() => setSelectedId(q.categoryId)}>Noter</Button>
                    </Group>
                  ) : (
                    <Group key={`${q.categoryId}-${q.matchId}`} justify="space-between" wrap="nowrap" mt={6} data-testid="next-match">
                      <div>
                        <Text size="xs" c="dimmed">combat {q.number} · {q.categoryLabel}</Text>
                        <Text size="sm">{q.a} <Text span c="dimmed">contre</Text> {q.b}</Text>
                        {q.noRest && <Badge size="xs" color="orange" variant="light" data-testid="no-rest">pas de repos : prévoir une pause</Badge>}
                      </div>
                      <Button size="xs" style={{ flexShrink: 0 }} onClick={() => { setSelectedId(q.categoryId); setDialogMatchId(q.matchId); }}>Saisir</Button>
                    </Group>
                  ),
                )}
              </Card>
            ))}
            {!zoneOnly && (schedule?.unassigned.length ?? 0) > 0 && (
              <Card withBorder>
                <Title order={6}>Sans zone</Title>
                <Text size="sm" c="dimmed">{schedule!.unassigned.length} catégorie(s) sans zone possible ou sans session.</Text>
              </Card>
            )}
          </SimpleGrid>

          {selected && res && (
            <Stack>
              <Group justify="space-between">
                <Title order={4}>{selected.label}</Title>
                <Badge>{STATUS_LABELS[selected.status]}</Badge>
              </Group>
              <Progress value={res.progress.total ? (100 * res.progress.played) / res.progress.total : 0} />
              <Text size="xs" c="dimmed">{res.progress.played} / {res.progress.total} {selected.bracket?.kind === 'kata' ? 'passage(s) noté(s)' : 'combat(s) joué(s)'}</Text>
              {res.ignored.length > 0 && (
                <Alert color="orange" data-testid="results-stale" title={`${res.ignored.length} résultat(s) à revoir`}>
                  <Text size="sm" mb={6}>Les combattants de ces combats ont changé : cliquez le combat pour ressaisir, ou effacez l'ancien résultat.</Text>
                  <Stack gap={4}>
                    {res.ignored.map((r) => (
                      <Group key={r.matchId} justify="space-between" wrap="nowrap" data-testid="ignored-result">
                        <Text size="sm">
                          {view?.numbers.get(r.matchId) ? `Combat ${view.numbers.get(r.matchId)} · ` : ''}
                          ancien résultat : {entrants.get(r.entrantA)?.name ?? '?'} contre {entrants.get(r.entrantB)?.name ?? '?'}
                        </Text>
                        <Button size="xs" variant="subtle" color="red" data-testid="ignored-result-clear" loading={clearIgnored.isPending}
                          onClick={() => clearIgnored.mutate({ cid: selected.id, matchId: r.matchId })}>
                          Effacer
                        </Button>
                      </Group>
                    ))}
                  </Stack>
                </Alert>
              )}
              {ties.length > 0 && tieScope && (
                <Alert color="orange" title="Égalité à départager">
                  <Button size="xs" data-testid="tiebreak-open" onClick={() => setTieOpen(true)}>Départager</Button>
                </Alert>
              )}
              {selected.bracket?.kind === 'kata' ? (
                <KataScoring competitionId={id} categoryId={selected.id} bracket={selected.bracket} scores={res.kataScores} tieBreak={res.tieBreaks.kata} finalTieBreak={res.tieBreaks.kataFinal} entrants={entrants} />
              ) : (
                view && (
                  <BracketView category={selected} entrants={entrants} results={view.results} stale={view.stale} tieBreaks={res.tieBreaks.pools}
                    numbers={passages?.numbers} noRest={passages?.noRest} matchZones={movedMatchZones(passages, zones, selected.bracket)}
                    onMatchClick={(m) => setDialogMatchId(m.id)} />
                )
              )}
              {selected.bracket?.kind === 'kata' && res.progress.podium.complete && (
                <BracketView category={selected} entrants={entrants} kataScores={res.kataScores} kataTieBreak={res.tieBreaks.kata} />
              )}
            </Stack>
          )}
        </Stack>
      </Grid.Col>
      {selected?.bracket?.kind === 'combat' && res && dialogMatch && (
        <ResultDialog competitionId={id} categoryId={selected.id} bracket={selected.bracket} ruleset={selected.key.ruleset} match={dialogMatch}
          number={view?.numbers.get(dialogMatch.id)} records={res.records} tieBreaks={res.tieBreaks.pools} entrants={entrants} onClose={() => setDialogMatchId(null)} />
      )}
      {moving && <MoveDialog competitionId={id} category={moving.category} zoneId={moving.zoneId} zones={zones} onClose={() => setMoving(null)} />}
      {tieOpen && selected && tieScope && (
        <TieBreakDialog competitionId={id} categoryId={selected.id} scope={tieScope} group={ties[0] ?? null} entrants={entrants} onClose={() => setTieOpen(false)} />
      )}
    </Grid>
  );
}
