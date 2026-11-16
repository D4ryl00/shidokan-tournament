import { Box, Button, Center, Group, Loader } from '@mantine/core';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { activeEntrantCount, type Category } from '../../../domain/categories.js';
import { cachedGalaxyLayout, placeCategories } from '../../../domain/galaxy/layout.js';
import { forbiddenLinks, galaxyLinks, rulesFrom, type GalaxyLink } from '../../../domain/galaxy/links.js';
import { normalizeName } from '../../../domain/names.js';
import { RULE_LABELS } from '../../../domain/replacement/rules.js';
import type { ProposalType } from '../../../domain/replacement/index.js';
import type { CompetitionSettings } from '../../../domain/settings.js';
import type { CategoryGrid } from '../../../domain/types.js';
import type { Wave } from '../../../domain/waves.js';
import { useCompetition, useGrid, usePassages, useZones, type RecasementEntry } from '../../api.js';
import { categoryPassages } from '../../passages.js';
import type { EntrantInfo } from '../BracketView.js';
import { useUndoHighlight } from '../history/highlight.js';
import { CategoryCard } from '../planche/CategoryCard.js';
import { cardTitle, inScope, plancheFilter, sessionLabel, shownOnPlanche } from '../planche/model.js';
import { PlancheToolbar, type Scope } from '../planche/PlancheToolbar.js';
import { usePlancheDrop } from '../planche/usePlancheDrop.js';
import { ApiErrorAlert } from '../ApiErrorAlert.js';
import { EmptyState } from '../ui/EmptyState.js';
import { disciplineHue, type Star } from './drawGalaxy.js';
import { GalaxyLegend } from './GalaxyLegend.js';
import { GalaxyStage } from './GalaxyStage.js';
import { bestFrom, FORBIDDEN_COLOR, forbiddenLabel, legendRules, linkStyle, orderedNeighbors } from './scene.js';

// Vue « Galaxie » de Jour J → Tableaux (spec étape 48, §3 et §4) : chaque catégorie est une étoile près de ses voisines ;
// la sélection et ses voisines rapprochées sont de vraies cartes de la planche, où l'on glisse un combattant.

const NO_STYLE = { color: '#2fd27a', dashed: false };

/** Liens de chaque catégorie. */
function adjacencyOf(links: GalaxyLink[]): Map<string, GalaxyLink[]> {
  const out = new Map<string, GalaxyLink[]>();
  for (const l of links) for (const id of [l.a, l.b]) out.set(id, [...(out.get(id) ?? []), l]);
  return out;
}

/** Teinte, titre de carte, nom d'étoile et seconde ligne d'une catégorie : les mêmes sur l'étoile et sur sa carte. */
function categoryTexts(c: Category, grid: CategoryGrid | undefined) {
  const hue = disciplineHue(c.key);
  const free = c.key.free !== undefined;
  const title = grid ? cardTitle(c, grid) : c.label;
  return { hue, title, label: free ? title : `${hue.short} · ${title}`, sub: free ? `Tableau libre · ${hue.label}` : hue.label };
}

/** Règles d'un lien vues depuis `fromId`, dans l'ordre de la compétition. */
function linkLabelOf(settings: CompetitionSettings | null) {
  return (l: GalaxyLink, fromId: string): string => {
    const order = settings?.replacementRules.order ?? [];
    return [...rulesFrom(l, fromId)].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((r) => RULE_LABELS[r]).join(' + ');
  };
}

export function GalaxyView(p: {
  competitionId: string; categories: Category[]; waves: Wave[]; waveId: string | null; scope: Scope; onScope: (v: string) => void;
  readOnly: boolean; entrants: Map<string, EntrantInfo>; badges: Map<string, ProposalType>; badgeDetails: Map<string, RecasementEntry>;
  cases: Map<string, number>; aside: Map<string, number>; historyCount: number; onHistory?: () => void;
  /** Catégorie à sélectionner à l'ouverture (lien de la Réaffectation). */
  initialCategoryId: string | null;
  onSeeInPlanche: (categoryId: string) => void;
  /** Le sélecteur « Planche / Liste / Galaxie », posé dans la barre (qui flotte sur le canevas). */
  viewSwitch?: ReactNode;
}) {
  const { competitionId, categories, waves, waveId, scope, readOnly, entrants } = p;
  const { data: grid, error: gridError } = useGrid(competitionId);
  const { data: competition } = useCompetition(competitionId);
  const settings = competition?.settings ?? null;
  const { data: zones = [] } = useZones(competitionId);
  const { data: plan } = usePassages(competitionId);
  const undo = useUndoHighlight();
  // Glisser-déposer et clic-clic : le hook de la planche, sur toutes les catégories (la source peut être d'une autre session).
  const { drag, chipProps, cardProps, dialog, banner } = usePlancheDrop({ competitionId, categories, entrants, waves, readOnly });

  const [query, setQuery] = useState('');
  const [onlyLone, setOnlyLone] = useState(false);
  const [allLinks, setAllLinks] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Recadrage demandé (la sélection a disparu sans qu'on sache où sont partis ses combattants).
  const [refit, setRefit] = useState(0);

  const names = useMemo(() => new Map([...entrants].map(([id, e]) => [id, e.name])), [entrants]);
  // Les catégories que la planche montre, toutes sessions confondues : les voisines hors de la session en font partie.
  const shown = useMemo(() => categories.filter(shownOnPlanche), [categories]);
  const byId = useMemo(() => new Map(shown.map((c) => [c.id, c])), [shown]);
  // Places : ≈ 350 ms sur la grille, une fois tant qu'elle ne change pas (gardées d'une ouverture à l'autre) ; puis les
  // catégories posées sur leurs cases.
  const layout = useMemo(() => (grid ? cachedGalaxyLayout(grid) : null), [grid]);
  const base = useMemo(
    () => (grid && layout ? placeCategories(shown.map((c) => ({ id: c.id, key: c.key, label: c.label })), layout, grid) : null),
    [shown, layout, grid],
  );
  const nodes = useMemo(() => shown.map((c) => ({ id: c.id, key: c.key })), [shown]);
  const links = useMemo(() => (grid && settings ? galaxyLinks(nodes, grid, settings) : []), [nodes, grid, settings]);
  // Voisines interdites par les réglages (étape 49) : liens du calcul avec tous les réglages ouverts, absents des permis.
  const forbidden = useMemo(() => (grid && settings ? forbiddenLinks(nodes, grid, settings, links) : []), [nodes, grid, settings, links]);
  const adjacency = useMemo(() => adjacencyOf(links), [links]);
  const forbiddenAdjacency = useMemo(() => adjacencyOf(forbidden), [forbidden]);
  const legend = useMemo(() => (settings ? legendRules(settings) : []), [settings]);
  // Style de chaque lien, gardé par lien et par sens : avec « Tous les liens », le dessin le demande pour des milliers de
  // liens à chaque image. Les liens sont recréés quand les catégories ou les réglages changent : le cache part avec eux.
  const styleOf = useMemo(() => {
    const cache = new WeakMap<GalaxyLink, Map<string, { color: string; dashed: boolean }>>();
    return (l: GalaxyLink, fromId: string) => {
      if (!settings) return NO_STYLE;
      let byFrom = cache.get(l);
      if (!byFrom) cache.set(l, (byFrom = new Map()));
      let st = byFrom.get(fromId);
      if (!st) byFrom.set(fromId, (st = linkStyle(l, fromId, settings)));
      return st;
    };
  }, [settings]);
  const labelOf = useMemo(() => linkLabelOf(settings), [settings]);
  const fromOf = useCallback((l: GalaxyLink) => (settings ? bestFrom(l, settings) : l.a), [settings]);

  const scopeCats = shown.filter((c) => inScope(c, { waves, scope, waveId }));
  const waiting = categories.filter((c) => c.waveId === null).length;
  // Une sélection vidée (catégorie disparue) : plus de sélection.
  const sel = selectedId !== null && byId.has(selectedId) ? selectedId : null;
  // Une sélection vidée par un déplacement : la galaxie suit ses combattants dans leur nouvelle catégorie ; sinon, plus
  // de sélection et retour à la vue d'ensemble (pas de zoom maximal sur un ciel vide).
  const selRegs = useRef<{ id: string; regs: string[] } | null>(null);
  useEffect(() => {
    if (sel) selRegs.current = { id: sel, regs: byId.get(sel)?.registrationIds ?? [] };
  }, [sel, byId]);
  useEffect(() => {
    if (selectedId === null || sel !== null || !base) return;
    const regs = selRegs.current?.id === selectedId ? selRegs.current.regs : [];
    // D'abord dans la session affichée, puis parmi toutes les catégories montrées (une voisine d'une autre session).
    const holds = (c: Category) => regs.some((r) => c.registrationIds.includes(r));
    const dest = scopeCats.find(holds) ?? shown.find(holds);
    if (dest) setSelectedId(dest.id);
    else { setSelectedId(null); setRefit((n) => n + 1); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeCats suit shown et la portée
  }, [selectedId, sel, base, shown]);

  const neighborIds = useMemo(
    () => (sel && settings ? orderedNeighbors(sel, adjacency.get(sel) ?? [], forbiddenAdjacency.get(sel) ?? [], settings).map((n) => n.id) : []),
    [sel, adjacency, forbiddenAdjacency, settings],
  );
  // Étoiles dessinées : la portée, et la sélection avec toutes ses voisines, quelle que soit leur session.
  const scopeKey = scopeCats.map((c) => c.id).join(',');
  const drawnCats = useMemo(() => {
    const ids = new Set(scopeKey ? scopeKey.split(',') : []);
    if (sel) {
      ids.add(sel);
      for (const l of [...(adjacency.get(sel) ?? []), ...(forbiddenAdjacency.get(sel) ?? [])]) ids.add(l.a === sel ? l.b : l.a);
    }
    return shown.filter((c) => ids.has(c.id));
  }, [shown, scopeKey, sel, adjacency, forbiddenAdjacency]);
  const drawnIds = useMemo(() => new Set(drawnCats.map((c) => c.id)), [drawnCats]);
  const drawnLinks = useMemo(() => links.filter((l) => drawnIds.has(l.a) && drawnIds.has(l.b)), [links, drawnIds]);
  const drawnForbidden = useMemo(() => forbidden.filter((l) => drawnIds.has(l.a) && drawnIds.has(l.b)), [forbidden, drawnIds]);
  const forbiddenLabelOf = useCallback((l: GalaxyLink, fromId: string) => (settings ? forbiddenLabel(l, fromId, settings) : ''), [settings]);
  const stars = useMemo<Star[]>(() => {
    if (!grid) return [];
    return drawnCats.map((c) => {
      const { hue, title, label, sub } = categoryTexts(c, grid);
      return {
        id: c.id, color: hue.color, title, label, sub,
        names: c.registrationIds.filter((r) => !c.absentIds.includes(r)).map((r) => names.get(r) ?? '?'),
        lone: activeEntrantCount(c) === 1,
        pale: c.status === 'started' || c.status === 'finished',
      };
    });
  }, [drawnCats, grid, names]);
  // Recherche et « Seulement les seuls » : les étoiles trouvées gardent leur nom, les autres pâlissent.
  const matched = useMemo(() => {
    if (!query.trim() && !onlyLone) return null;
    const hits = plancheFilter(drawnCats, { query, names, onlyTodo: false, cases: p.cases }).filter((c) => !onlyLone || activeEntrantCount(c) === 1);
    return new Set(hits.map((c) => c.id));
  }, [drawnCats, query, names, onlyLone, p.cases]);
  const onQuery = (v: string) => {
    setQuery(v);
    if (!v.trim()) return;
    const hits = plancheFilter(scopeCats, { query: v, names, onlyTodo: false, cases: p.cases });
    if (hits.length === 1) setSelectedId(hits[0]!.id);
  };
  // « Seulement les seuls » recadre sur les catégories à un seul combattant.
  const loneIds = scopeCats.filter((c) => activeEntrantCount(c) === 1).map((c) => c.id);
  const fitIds = onlyLone && loneIds.length ? loneIds : scopeCats.map((c) => c.id);

  // Ouverture sur une catégorie (lien de la Réaffectation) : « Toutes » si elle n'est pas dans la session affichée.
  // Les sessions peuvent arriver après les catégories : la portée est vérifiée tant qu'elles ne sont pas connues.
  const initial = useRef(p.initialCategoryId);
  const scopeCheck = useRef<string | null>(null);
  useEffect(() => {
    const id = initial.current;
    if (id && base && byId.has(id)) {
      initial.current = null;
      scopeCheck.current = id;
      setSelectedId(id);
    }
    const c = scopeCheck.current ? byId.get(scopeCheck.current) : undefined;
    if (!c || waves.length === 0) return;
    scopeCheck.current = null;
    if (!inScope(c, { waves, scope, waveId })) p.onScope('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, base, waves]);

  // Échap : plus de sélection (sauf pendant un clic-clic, qu'Échap annule d'abord, dans un champ de saisie, ou quand une
  // fenêtre ou un tiroir est ouvert : Échap le ferme).
  const chipSelected = useRef(drag.selected);
  chipSelected.current = drag.selected;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || chipSelected.current) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, [role="dialog"]'))) return;
      if (document.querySelector('[role="dialog"]')) return;
      setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const words = normalizeName(query).split(' ').filter(Boolean);
  const renderCard = (id: string, isSel: boolean): ReactNode => {
    const c = byId.get(id);
    if (!c) return null;
    // Voisine : la règle de son lien, à sa couleur, posée sur le bord de la carte (le nom sur le lien est souvent caché).
    const touches = (l: GalaxyLink) => l.a === id || l.b === id;
    const link = sel && !isSel ? (adjacency.get(sel) ?? []).find(touches) : undefined;
    const banned = sel && !isSel && !link ? (forbiddenAdjacency.get(sel) ?? []).find(touches) : undefined;
    const rule = link && sel ? { label: labelOf(link, sel), ...styleOf(link, sel), border: styleOf(link, sel).dashed ? 'dashed' : 'solid', forbidden: false }
      : banned && sel ? { label: forbiddenLabelOf(banned, sel), color: FORBIDDEN_COLOR, border: 'dotted', forbidden: true }
      : null;
    const { title, sub } = categoryTexts(c, grid);
    const n = p.cases.get(c.id) ?? 0;
    return (
      <>
      {rule && (
        <span data-testid="galaxy-card-rule" data-forbidden={rule.forbidden || undefined} style={{
          position: 'absolute', top: -9, right: 8, zIndex: 1, maxWidth: 'calc(100% - 16px)', fontSize: 10.5, lineHeight: '16px', padding: '0 7px',
          borderRadius: 999, background: '#0b0e16', color: rule.color, border: `1px ${rule.border} ${rule.color}`,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none',
        }}>{rule.label}</span>
      )}
      <CategoryCard competitionId={competitionId} category={c} title={title} subtitle={sub}
        sessionName={sessionLabel(c, waves, waveId)} passages={categoryPassages(plan, c.id)} zones={zones} entrants={entrants}
        badges={p.badges} badgeDetails={p.badgeDetails} cases={n} aside={p.aside.get(c.id) ?? 0} readOnly={readOnly}
        expanded={false} onToggle={() => undefined} onOpenList={() => undefined} words={words} ring={undo.categories.has(c.id) ? 'undo' : null}
        cardProps={readOnly ? undefined : cardProps(c)} chipProps={readOnly ? undefined : chipProps} selectedChip={drag.selected}
        compact onTitleClick={isSel ? undefined : () => setSelectedId(c.id)}
        actions={(
          <Group gap={4}>
            <Button size="compact-xs" variant="subtle" data-testid="galaxy-see-planche" onClick={() => p.onSeeInPlanche(c.id)}>Voir dans la planche</Button>
            {isSel && n > 0 && (
              <Button size="compact-xs" variant="subtle" component={Link} to={`/competitions/${competitionId}/reaffectation`} data-testid="galaxy-reaffectation">Réaffectation ↗</Button>
            )}
          </Group>
        )} />
      </>
    );
  };

  const presentHues = [...new Map(drawnCats.map((c) => { const h = disciplineHue(c.key); return [h.key, h] as const; })).values()];

  // Changer de session (à la main) recadre (spec §4.1) : la sélection est retirée dans le même rendu, et la vue
  // d'ensemble de la nouvelle portée revient. (La portée élargie à l'ouverture sur une catégorie garde, elle, la sélection.)
  const onScope = (v: string) => {
    setSelectedId(null);
    p.onScope(v);
  };

  const toolbar = (
    <PlancheToolbar waves={waves} waveId={waveId} scope={scope} waiting={waiting} onScope={onScope} query={query} onQuery={onQuery}
      historyCount={p.historyCount} onHistory={readOnly ? undefined : p.onHistory}>
      <Group gap={6} pb={4} data-pass-through>
        <Button size="compact-sm" radius="xl" variant={onlyLone ? 'filled' : 'default'} aria-pressed={onlyLone} data-testid="galaxy-only-lone"
          onClick={() => setOnlyLone((v) => !v)}>Seulement les seuls</Button>
        <Button size="compact-sm" radius="xl" variant={allLinks ? 'filled' : 'default'} aria-pressed={allLinks} data-testid="galaxy-all-links"
          onClick={() => setAllLinks((v) => !v)}>Tous les liens</Button>
      </Group>
      {p.viewSwitch && <Box pb={6}>{p.viewSwitch}</Box>}
    </PlancheToolbar>
  );
  const staged = base !== null && scopeCats.length > 0;

  return (
    <Box data-testid="galaxy">
      {!staged && <Box mb="sm">{toolbar}</Box>}
      {banner}
      {!base && !gridError && <Center h={300}><Loader /></Center>}
      {!grid && gridError && <ApiErrorAlert error={gridError} />}
      {base && scopeCats.length === 0 && <EmptyState title="Aucune catégorie." />}
      {staged && (
        <GalaxyStage toolbar={toolbar} stars={stars} base={base} links={drawnLinks} sel={sel} neighborIds={neighborIds} matched={matched} allLinks={allLinks}
          linkStyle={styleOf} linkFrom={fromOf} linkLabel={labelOf} forbidden={drawnForbidden} forbiddenLabel={forbiddenLabelOf} fitIds={fitIds} fitKey={`${scope}|${waveId ?? ''}|${onlyLone}|${refit}`}
          onSelect={setSelectedId} chipSelected={drag.selected !== null} onCancelChip={drag.cancel} renderCard={renderCard}
          legend={<GalaxyLegend hues={presentHues} rules={legend} />} />
      )}
      {dialog}
    </Box>
  );
}
