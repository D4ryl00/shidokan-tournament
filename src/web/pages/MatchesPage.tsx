import { Alert, Badge, Button, Card, Grid, Group, NumberInput, Progress, ScrollArea, Select, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { resolveBracket, type ResolvedMatch } from '../../domain/brackets/index.js';
import { activeEntrantCount } from '../../domain/categories.js';
import { validResults } from '../../domain/results.js';
import { useCategories, useCategoryResults, useCompetition, useDeleteResult, useSchedule, useUpdateCategory } from '../api.js';
import { BracketView } from '../components/BracketView.js';
import { KataScoring } from '../components/KataScoring.js';
import { ResultDialog } from '../components/ResultDialog.js';
import { TieBreakDialog } from '../components/TieBreakDialog.js';
import { STATUS_LABELS, useEntrantInfo } from './BracketsPage.js';

export function MatchesPage() {
  const { id = '' } = useParams();
  const { data: competition } = useCompetition(id);
  const { data: categories = [] } = useCategories(id);
  const { data: schedule } = useSchedule(id);
  const update = useUpdateCategory(id);
  const clearIgnored = useDeleteResult(id);
  const entrants = useEntrantInfo(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogMatchId, setDialogMatchId] = useState<string | null>(null);
  const [tieOpen, setTieOpen] = useState(false);
  const playable = categories.filter((c) => c.bracket && activeEntrantCount(c) >= 2);
  const selected = playable.find((c) => c.id === selectedId) ?? null;
  const { data: res } = useCategoryResults(id, selected?.id ?? null);
  const tatamiOptions = [{ value: '', label: '—' }, ...Array.from({ length: competition?.tatamiCount ?? 2 }, (_, i) => ({ value: String(i + 1), label: `Tatami ${i + 1}` }))];

  const view = useMemo(() => {
    if (!selected?.bracket || selected.bracket.kind !== 'combat' || !res) return null;
    const { results, ignored } = validResults(selected.bracket, res.records, res.tieBreaks.pools);
    const { matches } = resolveBracket(selected.bracket, results, res.tieBreaks.pools);
    const numbers = new Map([...matches].filter((m) => !m.bye).sort((a, b) => a.order - b.order).map((m, i) => [m.id, i + 1]));
    return { results, stale: new Set(ignored.map((r) => r.matchId)), matches, numbers };
  }, [selected, res]);
  const dialogMatch: ResolvedMatch | null = (dialogMatchId && view?.matches.find((m) => m.id === dialogMatchId)) || null;
  const ties = res?.progress.podium.ties ?? [];
  const tieScope = res?.progress.podium.tieScopes?.[0] ?? null;

  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <Title order={5} mb="xs">Catégories et tatamis</Title>
        <ScrollArea.Autosize mah="75vh">
          <Stack gap={4}>
            {playable.map((c) => (
              <Card key={c.id} withBorder padding="xs" data-testid="schedule-category" style={{ borderColor: c.id === selectedId ? 'var(--mantine-color-shidokan-5)' : undefined }}>
                <UnstyledButton onClick={() => setSelectedId(c.id)}>
                  <Text size="sm" fw={500}>{c.label}</Text>
                </UnstyledButton>
                <Group gap={4} mt={4}>
                  <Badge size="xs" variant="light">{STATUS_LABELS[c.status]}</Badge>
                  <Select size="xs" w={110} data={tatamiOptions} value={c.tatami ? String(c.tatami) : ''} allowDeselect={false} data-testid="schedule-tatami"
                    onChange={(v) => update.mutate({ cid: c.id, tatami: v ? Number(v) : null })} />
                  <NumberInput size="xs" w={70} min={0} max={99} value={c.order} aria-label="Ordre" data-testid="schedule-order"
                    onChange={(v) => typeof v === 'number' && update.mutate({ cid: c.id, order: v })} />
                </Group>
              </Card>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 8 }}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {(schedule?.tatamis ?? []).map((t) => {
              const next = t.categories.flatMap((c) => c.nextMatches.map((m) => ({ ...m, category: c }))).slice(0, 4);
              const kataNext = t.categories.find((c) => c.kata && c.status !== 'finished');
              return (
                <Card key={t.tatami} withBorder data-testid="tatami-card">
                  <Title order={5}>Tatami {t.tatami}</Title>
                  {next.length === 0 && !kataNext && <Text size="sm" c="dimmed">Aucun combat en attente.</Text>}
                  {kataNext && next.length === 0 && (
                    <Button size="xs" variant="light" mt={4} onClick={() => setSelectedId(kataNext.id)}>Kata : {kataNext.label}</Button>
                  )}
                  {next.map((m) => (
                    <Group key={`${m.category.id}-${m.matchId}`} justify="space-between" wrap="nowrap" mt={6} data-testid="next-match">
                      <div>
                        <Text size="xs" c="dimmed">{m.category.label} · combat {m.number}</Text>
                        <Text size="sm">{m.a} <Text span c="dimmed">contre</Text> {m.b}</Text>
                      </div>
                      <Button size="xs" style={{ flexShrink: 0 }} onClick={() => { setSelectedId(m.category.id); setDialogMatchId(m.matchId); }}>Saisir</Button>
                    </Group>
                  ))}
                </Card>
              );
            })}
            {(schedule?.unassigned.length ?? 0) > 0 && (
              <Card withBorder>
                <Title order={6}>Sans tatami</Title>
                <Text size="sm" c="dimmed">{schedule!.unassigned.length} catégorie(s) à affecter.</Text>
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
      {tieOpen && selected && tieScope && (
        <TieBreakDialog competitionId={id} categoryId={selected.id} scope={tieScope} group={ties[0] ?? null} entrants={entrants} onClose={() => setTieOpen(false)} />
      )}
    </Grid>
  );
}
