import { Box, Grid, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useMemo, useRef, useState } from 'react';
import { newSameClubSentences } from '../../../domain/brackets/same-club.js';
import { type Category } from '../../../domain/categories.js';
import { DISCIPLINES, RULESETS } from '../../../domain/disciplines.js';
import { normalizeName } from '../../../domain/names.js';
import type { ProposalType } from '../../../domain/replacement/index.js';
import type { Wave } from '../../../domain/waves.js';
import { useGrid, useZones, usePassages, useSwap, type RecasementEntry } from '../../api.js';
import { categoryPassages } from '../../passages.js';
import type { EntrantInfo } from '../BracketView.js';
import { useUndoHighlight } from '../history/highlight.js';
import { useUndoToast } from '../history/undoToast.js';
import { EmptyState } from '../ui/EmptyState.js';
import { CategoryCard } from './CategoryCard.js';
import { DropConfirmDialog, type PendingDrop } from './DropConfirmDialog.js';
import { LoneTray } from './LoneTray.js';
import { cardTitle, isLockedCategory, LOCKED_DROP, loneFighters, plancheFilter, plancheGroups, shownOnPlanche, type PlancheSort } from './model.js';
import { PlancheToolbar, type Scope } from './PlancheToolbar.js';
import { useDragMove, type DragAttrs, type PlancheAction } from './useDragMove.js';
import { JumpLinks } from '../ui/JumpLinks.js';

export interface SeeRequest { ids: string[]; n: number }

/** Une pastille est à la fois source (glisser, clic) et cible (dépôt). */
const both = (a: DragAttrs, b: DragAttrs): DragAttrs => ({ ...a, ...b, onClick: a.onClick ?? b.onClick, style: { ...a.style, ...b.style } });

/** La planche : toutes les catégories de la session en cartes, groupées, avec le bac « Sans adversaire ». */
export function Planche({ competitionId, categories, waves, waveId, scope, onScope, readOnly, entrants, badges, badgeDetails, cases, aside, historyCount, onHistory, seeRequest, onConsumed, onOpenList }: {
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
  /** La demande a été appliquée : l'appelant l'oublie (elle ne doit jouer qu'une fois). */
  onConsumed: () => void;
  onOpenList: (categoryId: string) => void;
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

  // Glisser-déposer et clic-clic : échange de places tout de suite, échange et déplacement après confirmation.
  const swap = useSwap(competitionId);
  const undoToast = useUndoToast(competitionId);
  const [drop, setDrop] = useState<PendingDrop | null>(null);
  const nameOf = (rid?: string) => (rid ? entrants.get(rid)?.name : undefined) ?? '?';
  const onAction = (a: PlancheAction) => {
    if (a.kind === 'none') return;
    if (a.kind === 'locked') {
      notifications.show({ id: 'planche-locked', color: 'orange', message: LOCKED_DROP });
      return;
    }
    if (a.kind === 'swap' && a.target) {
      const before = categories.find((c) => c.id === a.from)?.bracket ?? null;
      const [x, y] = [a.source, a.target];
      swap.mutate({ cid: a.from, a: x, b: y }, {
        onSuccess: (c) => undoToast(`Places échangées : ${nameOf(x)} ↔ ${nameOf(y)}`, c.historyId ?? null, newSameClubSentences(before, c.bracket, (r) => entrants.get(r))),
        onError: (e) => notifications.show({ color: 'red', message: e.message }),
      });
      return;
    }
    if (a.kind === 'exchange' || a.kind === 'move') setDrop({ kind: a.kind, source: a.source, target: a.target, from: a.from, to: a.to });
  };
  const drag = useDragMove({ readOnly, onAction });
  const chipProps = (registrationId: string, c: Category) => {
    const t = { registrationId, categoryId: c.id, locked: isLockedCategory(c) };
    return both(drag.dragProps(t), drag.dropProps(t));
  };
  const cardProps = (c: Category) => drag.dropProps({ categoryId: c.id, locked: isLockedCategory(c) });

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
    if (!seeRequest || categories.length === 0) return;
    setQuery(''); setOnlyTodo(false);
    setSeen(new Set(seeRequest.ids));
    onConsumed();
  }, [seeRequest, categories.length, onConsumed]);
  useEffect(() => {
    if (seen.size === 0) return;
    const t = setTimeout(() => setSeen(new Set()), 2200);
    return () => clearTimeout(t);
  }, [seen]);
  // Défile une fois, dès que la carte est affichée (la grille peut arriver après la demande).
  const scrolled = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (seen.size === 0 || scrolled.current === seen) return;
    const first = [...seen].map((id) => document.querySelector(`[data-testid="planche-card"][data-category="${id}"]`)).find(Boolean);
    if (!first) return;
    scrolled.current = seen;
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [seen, groups.length]);

  const jump = (i: number) => document.getElementById(`planche-group-${i}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Stack gap="sm" data-testid="planche">
      <PlancheToolbar waves={waves} waveId={waveId} scope={scope} waiting={waiting} onScope={onScope} query={query} onQuery={setQuery}
        sort={sort} onSort={setSort} onlyTodo={onlyTodo} onOnlyTodo={setOnlyTodo} historyCount={historyCount} onHistory={readOnly ? undefined : onHistory} />
      {drag.selected && (
        <Paper data-testid="planche-banner" role="status" px="sm" py={6} radius="sm"
          style={{ position: 'fixed', top: 'calc(var(--sk-bar-h, 56px) + 8px)', left: '50%', transform: 'translateX(-50%)', width: 'min(900px, calc(100vw - 32px))', zIndex: 90, pointerEvents: 'none', boxShadow: 'var(--mantine-shadow-md)', backgroundColor: 'var(--sk-chip)', color: 'var(--sk-chip-text)', border: '1px solid var(--sk-accent)' }}>
          <Text size="sm" fw={500}>Sélection : {nameOf(drag.selected)}. Cliquez sur un autre combattant pour échanger, ou sur une catégorie pour l’y déplacer. (Échap pour annuler)</Text>
        </Paper>
      )}
      {groups.length > 0 && (
        <JumpLinks data-testid="planche-jumps" itemTestId="planche-jump" label="Aller au groupe"
          items={groups.map((g, i) => ({ key: g.key, label: g.title, count: g.categories.length, onClick: () => jump(i) }))} />
      )}
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Box style={{ position: 'sticky', top: 8 }}>
            <LoneTray items={loneItems} entrants={entrants} badges={badges} badgeDetails={badgeDetails} chipProps={readOnly ? undefined : chipProps} selectedChip={drag.selected} />
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
                        cardProps={readOnly ? undefined : cardProps(c)} chipProps={readOnly ? undefined : chipProps} selectedChip={drag.selected} />
                    );
                  })}
                </SimpleGrid>
              </Stack>
            ))}
          </Stack>
        </Grid.Col>
      </Grid>
      <DropConfirmDialog competitionId={competitionId} drop={drop} categories={categories} entrants={entrants} waves={waves} onClose={() => setDrop(null)} />
    </Stack>
  );
}
