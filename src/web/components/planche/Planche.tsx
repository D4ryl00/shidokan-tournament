import { Anchor, Box, Grid, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react';
import { type Category } from '../../../domain/categories.js';
import { DISCIPLINES, RULESETS } from '../../../domain/disciplines.js';
import { normalizeName } from '../../../domain/names.js';
import type { ProposalType } from '../../../domain/replacement/index.js';
import type { Wave } from '../../../domain/waves.js';
import { useGrid, useZones, usePassages, type RecasementEntry } from '../../api.js';
import { categoryPassages } from '../../passages.js';
import type { EntrantInfo } from '../BracketView.js';
import { useUndoHighlight } from '../history/highlight.js';
import { EmptyState } from '../ui/EmptyState.js';
import { CategoryCard } from './CategoryCard.js';
import { LoneTray } from './LoneTray.js';
import { cardTitle, loneFighters, plancheFilter, plancheGroups, shownOnPlanche, type PlancheSort } from './model.js';
import { PlancheToolbar, type Scope } from './PlancheToolbar.js';

export interface SeeRequest { ids: string[]; n: number }

/** La planche : toutes les catégories de la session en cartes, groupées, avec le bac « Sans adversaire ». */
export function Planche({ competitionId, categories, waves, waveId, scope, onScope, readOnly, entrants, badges, badgeDetails, cases, aside, historyCount, onHistory, seeRequest, onOpenList, chipProps, cardProps }: {
  competitionId: string;
  categories: Category[];
  waves: Wave[];
  waveId: string | null;
  scope: Scope;
  onScope: (v: string) => void;
  readOnly: boolean;
  entrants: Map<string, EntrantInfo>;
  badges: Map<string, ProposalType>;
  badgeDetails: Map<string, RecasementEntry>;
  cases: Map<string, number>;
  aside: Map<string, number>;
  historyCount: number;
  onHistory?: () => void;
  /** « Voir » : défile jusqu'aux cartes et les entoure un instant. */
  seeRequest: SeeRequest | null;
  onOpenList: (categoryId: string) => void;
  /** Attributs ajoutés aux pastilles et aux cartes (glisser-déposer). */
  chipProps?: (registrationId: string, category: Category) => HTMLAttributes<HTMLDivElement>;
  cardProps?: (category: Category) => HTMLAttributes<HTMLDivElement>;
}) {
  const { data: grid } = useGrid(competitionId);
  const { data: zones = [] } = useZones(competitionId);
  const { data: plan } = usePassages(competitionId);
  const undo = useUndoHighlight();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PlancheSort>('categorie');
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const consumed = useRef(0);

  const inScope = (c: Category) => waves.length === 0 || scope === 'all' || (scope === 'waiting' ? c.waveId === null : c.waveId === waveId);
  const waiting = categories.filter((c) => c.waveId === null).length;
  const names = useMemo(() => new Map([...entrants].map(([id, e]) => [id, e.name])), [entrants]);
  const inSession = categories.filter((c) => inScope(c) && shownOnPlanche(c));
  const filtered = plancheFilter(inSession, { query, names, onlyTodo, cases });
  const zoneOf = (c: Category) => {
    const z = zones.find((x) => x.id === categoryPassages(plan, c.id).zoneId);
    return z ? { id: z.id, name: z.name } : null;
  };
  const groups = grid ? plancheGroups(filtered, { sort, grid, zoneOf, zoneOrder: zones.map((z) => z.id) }) : [];
  const words = normalizeName(query).split(' ').filter(Boolean);

  const lone = loneFighters(scope === 'waiting' ? categories.filter((c) => c.waveId === null) : categories, { waveId: scope === 'wave' ? waveId : null, scopeAll: scope === 'all' });
  const loneItems = lone.flatMap((l) => {
    const category = categories.find((c) => c.id === l.categoryId);
    if (!category) return [];
    const sessionName = category.waveId === null ? (waves.length ? 'En attente' : null) : category.waveId === waveId ? null : (waves.find((w) => w.id === category.waveId)?.name ?? null);
    return [{ category, registrationId: l.registrationId, sessionName }];
  });

  // « Voir » : lève les filtres, entoure les cartes ~2 s et défile jusqu'à la première (une fois les catégories chargées).
  useEffect(() => {
    if (!seeRequest || seeRequest.n === consumed.current || categories.length === 0) return;
    consumed.current = seeRequest.n;
    setQuery(''); setOnlyTodo(false);
    setSeen(new Set(seeRequest.ids));
    const t = setTimeout(() => setSeen(new Set()), 2200);
    return () => clearTimeout(t);
  }, [seeRequest, categories.length]);
  useEffect(() => {
    if (seen.size === 0) return;
    const first = [...seen].find((id) => document.querySelector(`[data-testid="planche-card"][data-category="${id}"]`));
    if (first) document.querySelector(`[data-testid="planche-card"][data-category="${first}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [seen]);

  const jump = (i: number) => document.getElementById(`planche-group-${i}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Stack gap="sm" data-testid="planche">
      <PlancheToolbar waves={waves} waveId={waveId} scope={scope} waiting={waiting} onScope={onScope} query={query} onQuery={setQuery}
        sort={sort} onSort={setSort} onlyTodo={onlyTodo} onOnlyTodo={setOnlyTodo} historyCount={historyCount} onHistory={readOnly ? undefined : onHistory} />
      {groups.length > 0 && (
        <Group gap="md" data-testid="planche-jumps">
          {groups.map((g, i) => (
            <Anchor key={g.key} component="button" type="button" size="sm" data-testid="planche-jump" onClick={() => jump(i)}>{g.title} ({g.categories.length})</Anchor>
          ))}
        </Group>
      )}
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Box style={{ position: 'sticky', top: 8 }}>
            <LoneTray items={loneItems} entrants={entrants} badges={badges} badgeDetails={badgeDetails} chipProps={readOnly ? undefined : chipProps} />
          </Box>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9 }}>
          <Stack gap="lg">
            {filtered.length === 0 && (
              <EmptyState title={inSession.length === 0 ? 'Aucune catégorie.' : 'Aucune catégorie ne correspond.'} />
            )}
            {groups.map((g, i) => (
              <Stack key={g.key} gap="xs" id={`planche-group-${i}`} data-testid="planche-group" data-group={g.key} style={{ scrollMarginTop: 8 }}>
                <Text fw={700} size="sm" tt="uppercase" c="dimmed" style={{ letterSpacing: 0.4 }}>{g.title}</Text>
                <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="sm">
                  {g.categories.map((c) => {
                    const passages = categoryPassages(plan, c.id);
                    const zone = zones.find((z) => z.id === passages.zoneId);
                    const ring = seen.has(c.id) ? 'see' : undo.categories.has(c.id) ? 'undo' : null;
                    const free = c.key.free !== undefined;
                    return (
                      <CategoryCard key={c.id} competitionId={competitionId} category={c} title={grid ? cardTitle(c, grid) : c.label}
                        subtitle={sort === 'zone' && !free ? [DISCIPLINES[c.key.discipline].label, c.key.ruleset ? RULESETS[c.key.ruleset].label.split(' ')[0] : null].filter(Boolean).join(' · ') : undefined}
                        zoneName={sort === 'categorie' ? zone?.name ?? null : null} passages={passages} zones={zones} entrants={entrants}
                        badges={badges} badgeDetails={badgeDetails} cases={cases.get(c.id) ?? 0} aside={aside.get(c.id) ?? 0} readOnly={readOnly}
                        expanded={open.has(c.id)} onToggle={() => toggle(c.id)} onOpenList={() => onOpenList(c.id)} words={words} ring={ring}
                        cardProps={cardProps?.(c)} chipProps={readOnly ? undefined : chipProps} />
                    );
                  })}
                </SimpleGrid>
              </Stack>
            ))}
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
