import { Box, Button, Center, Group, Loader, Paper, Text, UnstyledButton } from '@mantine/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { activeEntrantCount, type Category } from '../../../domain/categories.js';
import { galaxyLayout, placeCategories, type Point } from '../../../domain/galaxy/layout.js';
import { galaxyLinks, rulesFrom, type GalaxyLink } from '../../../domain/galaxy/links.js';
import { normalizeName } from '../../../domain/names.js';
import { RULE_LABELS } from '../../../domain/replacement/rules.js';
import type { ProposalType } from '../../../domain/replacement/index.js';
import type { CompetitionSettings } from '../../../domain/settings.js';
import type { Wave } from '../../../domain/waves.js';
import { useCompetition, useGrid, usePassages, useZones, type RecasementEntry } from '../../api.js';
import { categoryPassages } from '../../passages.js';
import type { EntrantInfo } from '../BracketView.js';
import { useUndoHighlight } from '../history/highlight.js';
import { CategoryCard } from '../planche/CategoryCard.js';
import { cardTitle, plancheFilter, sessionLabel, shownOnPlanche } from '../planche/model.js';
import { PlancheToolbar, type Scope } from '../planche/PlancheToolbar.js';
import { usePlancheDrop } from '../planche/usePlancheDrop.js';
import { EmptyState } from '../ui/EmptyState.js';
import { disciplineHue, drawGalaxy, fitCamera, SKY, starAt, toScreen, type Star } from './drawGalaxy.js';
import { cardScale, displayedPositions, legendRules, linkStyle, pullFactor, slotLayout, sortedNeighbors, type Camera } from './scene.js';
import { K_MIN, useGalaxyCamera } from './useGalaxyCamera.js';

// Vue « Galaxie » de Jour J → Tableaux (spec étape 48, §3 et §4) : chaque catégorie est une étoile près de ses voisines ;
// la sélection et ses voisines rapprochées sont de vraies cartes de la planche, où l'on glisse un combattant.

const NO_OVERLAY: ReadonlySet<string> = new Set();
/** Largeur des cartes posées sur le canevas (celle de la sélection, un peu plus large). */
const CARD_PX = 220;
const SELECTED_CARD_PX = 240;
/** En dessous de cette largeur (téléphone) : barre au-dessus du canevas, cartes jusqu'à 0,6. */
const NARROW_PX = 600;

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
  const { data: grid } = useGrid(competitionId);
  const { data: competition } = useCompetition(competitionId);
  const settings = competition?.settings ?? null;
  const { data: zones = [] } = useZones(competitionId);
  const { data: plan } = usePassages(competitionId);
  const undo = useUndoHighlight();
  // Glisser-déposer et clic-clic : le hook de la planche, sur toutes les catégories (la source peut être d'une autre session).
  const { drag, chipProps, cardProps, dialog, nameOf } = usePlancheDrop({ competitionId, categories, entrants, waves, readOnly });

  const [query, setQuery] = useState('');
  const [onlyLone, setOnlyLone] = useState(false);
  const [allLinks, setAllLinks] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const names = useMemo(() => new Map([...entrants].map(([id, e]) => [id, e.name])), [entrants]);
  // Les catégories que la planche montre, toutes sessions confondues : les voisines hors de la session en font partie.
  const shown = useMemo(() => categories.filter(shownOnPlanche), [categories]);
  const byId = useMemo(() => new Map(shown.map((c) => [c.id, c])), [shown]);
  // Places : ≈ 350 ms sur la grille, une fois ; puis les catégories posées sur leurs cases.
  const layout = useMemo(() => (grid ? galaxyLayout(grid) : null), [grid]);
  const base = useMemo(
    () => (grid && layout ? placeCategories(shown.map((c) => ({ id: c.id, key: c.key, label: c.label })), layout, grid) : null),
    [shown, layout, grid],
  );
  const links = useMemo(() => (grid && settings ? galaxyLinks(shown.map((c) => ({ id: c.id, key: c.key })), grid, settings) : []), [shown, grid, settings]);
  const adjacency = useMemo(() => {
    const out = new Map<string, GalaxyLink[]>();
    for (const l of links) for (const id of [l.a, l.b]) out.set(id, [...(out.get(id) ?? []), l]);
    return out;
  }, [links]);
  const legend = useMemo(() => (settings ? legendRules(settings) : []), [settings]);
  const styleOf = useCallback(
    (l: GalaxyLink, fromId: string) => (settings ? linkStyle(l, fromId, settings, legend) : { color: '#2fd27a', dashed: false }),
    [settings, legend],
  );
  const labelOf = useMemo(() => linkLabelOf(settings), [settings]);

  const inScope = (c: Category) => waves.length === 0 || scope === 'all' || (scope === 'waiting' ? c.waveId === null : c.waveId === waveId);
  const scopeCats = shown.filter(inScope);
  const waiting = categories.filter((c) => c.waveId === null).length;
  // Une sélection vidée (catégorie disparue) : plus de sélection.
  const sel = selectedId !== null && byId.has(selectedId) ? selectedId : null;
  useEffect(() => { if (selectedId !== null && sel === null && base) setSelectedId(null); }, [selectedId, sel, base]);

  const neighborIds = useMemo(() => (sel && settings ? sortedNeighbors(sel, adjacency.get(sel) ?? [], settings).map((n) => n.id) : []), [sel, adjacency, settings]);
  // Étoiles dessinées : la portée, et la sélection avec toutes ses voisines, quelle que soit leur session.
  const scopeKey = scopeCats.map((c) => c.id).join(',');
  const drawnCats = useMemo(() => {
    const ids = new Set(scopeKey ? scopeKey.split(',') : []);
    if (sel) {
      ids.add(sel);
      for (const l of adjacency.get(sel) ?? []) ids.add(l.a === sel ? l.b : l.a);
    }
    return shown.filter((c) => ids.has(c.id));
  }, [shown, scopeKey, sel, adjacency]);
  const drawnLinks = useMemo(() => {
    const ids = new Set(drawnCats.map((c) => c.id));
    return links.filter((l) => ids.has(l.a) && ids.has(l.b));
  }, [links, drawnCats]);
  const stars = useMemo<Star[]>(() => {
    if (!grid) return [];
    return drawnCats.map((c) => {
      const hue = disciplineHue(c.key);
      const free = c.key.free !== undefined;
      const title = cardTitle(c, grid);
      return {
        id: c.id, color: hue.color, title,
        label: free ? title : `${hue.short} · ${title}`,
        sub: free ? `Tableau libre · ${hue.label}` : hue.label,
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
    if (!inScope(c)) p.onScope('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, base, waves]);

  // Échap : plus de sélection (sauf pendant un clic-clic, qu'Échap annule d'abord, ou dans une fenêtre).
  const chipSelected = useRef(drag.selected);
  chipSelected.current = drag.selected;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || chipSelected.current) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return;
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
    const link = sel && !isSel ? (adjacency.get(sel) ?? []).find((l) => l.a === id || l.b === id) : undefined;
    const rule = link && sel ? { label: labelOf(link, sel), ...styleOf(link, sel) } : null;
    const free = c.key.free !== undefined;
    const hue = disciplineHue(c.key);
    const n = p.cases.get(c.id) ?? 0;
    return (
      <>
      {rule && (
        <span data-testid="galaxy-card-rule" style={{
          position: 'absolute', top: -9, right: 8, zIndex: 1, maxWidth: 'calc(100% - 16px)', fontSize: 10.5, lineHeight: '16px', padding: '0 7px',
          borderRadius: 999, background: '#0b0e16', color: rule.color, border: `1px ${rule.dashed ? 'dashed' : 'solid'} ${rule.color}`,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none',
        }}>{rule.label}</span>
      )}
      <CategoryCard competitionId={competitionId} category={c} title={grid ? cardTitle(c, grid) : c.label} subtitle={free ? `Tableau libre · ${hue.label}` : hue.label}
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

  const toolbar = (
    <PlancheToolbar waves={waves} waveId={waveId} scope={scope} waiting={waiting} onScope={p.onScope} query={query} onQuery={onQuery}
      historyCount={p.historyCount} onHistory={readOnly ? undefined : p.onHistory}>
      <Group gap={6} pb={4}>
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
      {drag.selected && (
        <Paper data-testid="planche-banner" role="status" px="sm" py={6} radius="sm"
          style={{ position: 'fixed', top: 'calc(var(--sk-bar-h, 56px) + 8px)', left: '50%', transform: 'translateX(-50%)', width: 'min(900px, calc(100vw - 32px))', zIndex: 90, pointerEvents: 'none', boxShadow: 'var(--mantine-shadow-md)', backgroundColor: 'var(--sk-chip)', color: 'var(--sk-chip-text)', border: '1px solid var(--sk-accent)' }}>
          <Text size="sm" fw={500}>Sélection : {nameOf(drag.selected)}. Cliquez sur un autre combattant pour échanger, ou sur une catégorie pour l’y déplacer. (Échap pour annuler)</Text>
        </Paper>
      )}
      {!base && <Center h={300}><Loader /></Center>}
      {base && scopeCats.length === 0 && <EmptyState title="Aucune catégorie." />}
      {staged && (
        <GalaxyStage toolbar={toolbar} stars={stars} base={base} links={drawnLinks} sel={sel} neighborIds={neighborIds} matched={matched} allLinks={allLinks}
          linkStyle={styleOf} linkLabel={labelOf} fitIds={fitIds} fitKey={`${scope}|${waveId ?? ''}|${onlyLone}`}
          onSelect={setSelectedId} chipSelected={drag.selected !== null} onCancelChip={drag.cancel} renderCard={renderCard}
          legend={<GalaxyLegend hues={presentHues} rules={legend} />} />
      )}
      {dialog}
    </Box>
  );
}

/** Le canevas, les cartes posées dessus et la légende. Monté seulement quand la portée a des étoiles. */
function GalaxyStage(p: {
  toolbar: ReactNode;
  stars: Star[]; base: Map<string, Point>; links: GalaxyLink[]; sel: string | null; neighborIds: string[];
  matched: ReadonlySet<string> | null; allLinks: boolean;
  linkStyle: (l: GalaxyLink, fromId: string) => { color: string; dashed: boolean };
  linkLabel: (l: GalaxyLink, fromId: string) => string;
  fitIds: string[]; fitKey: string;
  onSelect: (id: string | null) => void; chipSelected: boolean; onCancelChip: () => void;
  renderCard: (id: string, selected: boolean) => ReactNode; legend: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Bureau : la barre flotte sur le haut du canevas (comme la maquette) ; sa hauteur est retirée de la place des cartes.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < NARROW_PX);
  const [topInset, setTopInset] = useState(0);
  const scene = useRef(p);
  scene.current = p;
  const inset = useRef(topInset);
  inset.current = topInset;
  const hover = useRef<string | null>(null);
  // Dernières places affichées et cartes posées : pour savoir sur quelle étoile tombe un clic.
  const shownPos = useRef<Map<string, Point>>(p.base);
  const overlaid = useRef<ReadonlySet<string>>(NO_OVERLAY);

  // Taille : toute la largeur, et toute la hauteur sous la barre de l'appli, sans faire défiler la page (les marges du bas
  // des conteneurs sont retirées).
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      let below = 0;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        below += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      }
      const isNarrow = window.innerWidth < NARROW_PX;
      // Au téléphone, la barre de l'appli prend la moitié de l'écran : le canevas garde au moins 70 % de la hauteur (on
      // fait défiler la page jusqu'à lui).
      const floor = isNarrow ? Math.min(560, Math.round(window.innerHeight * 0.7)) : 300;
      const h = Math.max(floor, Math.floor(window.innerHeight - (r.top + window.scrollY) - below));
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
      setNarrow(isNarrow);
      const t = toolbarRef.current;
      setTopInset(t && !isNarrow ? Math.ceil(t.getBoundingClientRect().height) + 16 : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (toolbarRef.current) ro.observe(toolbarRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [narrow]);

  const draw = (cam: Camera, now: number): boolean => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { w, h } = size;
    if (!canvas || !ctx || w === 0) return false;
    const s = scene.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pull = s.sel ? pullFactor(cam.k) : 0;
    // Cases des voisines : selon la place sous la barre et la taille mesurée des cartes (à l'échelle 1).
    const heightOf = (id: string, fallback: number) => cardEls.current.get(id)?.offsetHeight || fallback;
    const lay = s.sel
      ? slotLayout({ sel: { w: SELECTED_CARD_PX, h: heightOf(s.sel, 200) }, neighbors: s.neighborIds.map((id) => ({ w: CARD_PX, h: heightOf(id, 180) })) },
        { w, h: h - inset.current }, w < NARROW_PX ? 0.6 : 0.75)
      : null;
    const pos = displayedPositions(s.base, s.sel, s.neighborIds, cam, { w, h }, lay?.slots);
    // Cartes posées par-dessus : la sélection et ses voisines rapprochées, à leur place affichée, à l'échelle.
    const show = s.sel !== null && pull > 0.2 && cardScale(cam.k, pull) * CARD_PX >= 70;
    const sc = cardScale(cam.k, pull) * (show && lay ? 1 - pull * (1 - lay.scale) : 1);
    const over: ReadonlySet<string> = show ? new Set([s.sel!, ...s.neighborIds]) : NO_OVERLAY;
    for (const [id, el] of cardEls.current) {
      const q = pos.get(id);
      if (show && q && over.has(id)) {
        const sp = toScreen(q, cam, w, h);
        el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, -50%) scale(${sc})`;
        el.style.visibility = 'visible';
      } else el.style.visibility = 'hidden';
    }
    if (legendRef.current) {
      const hide = pull > 0.5;
      legendRef.current.style.opacity = hide ? '0' : '1';
      legendRef.current.style.pointerEvents = hide ? 'none' : 'auto';
    }
    shownPos.current = pos;
    overlaid.current = over;
    return drawGalaxy(ctx, w, h, cam, {
      stars: s.stars, pos, links: s.links, selectedId: s.sel, hoverId: hover.current, overlaid: over, pulledIds: s.neighborIds,
      matched: s.matched, allLinks: s.allLinks, pull, linkStyle: s.linkStyle, linkLabel: s.linkLabel,
    }, now);
  };

  const hit = (x: number, y: number) => starAt({ stars: scene.current.stars, pos: shownPos.current, overlaid: overlaid.current }, camera.cam.current, size.w, size.h, x, y);
  const camera = useGalaxyCamera({
    canvasRef, wheelRef: frameRef, size, draw,
    onTap: (x, y) => {
      // Pendant un clic-clic, un clic à côté des cartes l'annule ; sinon : l'étoile touchée, ou plus de sélection.
      if (scene.current.chipSelected) { scene.current.onCancelChip(); return; }
      scene.current.onSelect(hit(x, y));
    },
    onHover: (x, y) => {
      const id = x === null || y === null ? null : hit(x, y);
      if (id === hover.current) return;
      hover.current = id;
      if (canvasRef.current) canvasRef.current.style.cursor = id ? 'pointer' : '';
      camera.requestDraw();
    },
  });

  // Chaque rendu (données, taille) : une image.
  useEffect(() => { camera.requestDraw(); });

  // Cadrage : à l'ouverture, au changement de session, avec « Seulement les seuls ». Une sélection en cours est gardée.
  const fitted = useRef(false);
  useEffect(() => {
    if (size.w === 0) return;
    if (fitted.current && scene.current.sel) return;
    const pts = scene.current.fitIds.map((id) => scene.current.base.get(id)).filter((q): q is Point => q !== undefined);
    // La place sous la barre : cadrée plus bas d'une demi-barre.
    const cam = fitCamera(pts, size.w, size.h - inset.current, K_MIN);
    camera.setCamera({ ...cam, py: cam.py + inset.current / 2 }, !fitted.current);
    fitted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fitKey, size.w > 0]);

  // Nouvelle sélection : vol jusqu'à elle.
  useEffect(() => {
    hover.current = null;
    const q = p.sel ? scene.current.base.get(p.sel) : undefined;
    if (q && size.w > 0) camera.flyTo(q, inset.current / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.sel, size.w > 0]);

  // Après un déplacement, la sélection garde sa catégorie ; si sa clé s'est élargie, sa place change : la caméra suit.
  const selAt = useRef<{ id: string; at: Point } | null>(null);
  useEffect(() => {
    const at = p.sel ? p.base.get(p.sel) : undefined;
    const prev = selAt.current;
    if (p.sel && at && prev && prev.id === p.sel && (prev.at.x !== at.x || prev.at.y !== at.y)) camera.follow(at.x - prev.at.x, at.y - prev.at.y);
    selAt.current = p.sel && at ? { id: p.sel, at } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.base, p.sel]);

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const cards = p.sel ? [p.sel, ...p.neighborIds] : [];
  // Au-dessus des autres : la carte sous le pointeur, ou celle que survole un glisser.
  const raise = (el: HTMLElement, on: boolean, id: string) => { el.style.zIndex = on ? '3' : id === p.sel ? '2' : '1'; };
  return (
    <>
    {narrow && <Box mb="sm">{p.toolbar}</Box>}
    <Box ref={frameRef} data-testid="galaxy-frame"
      style={{ position: 'relative', height: size.h || 300, overflow: 'hidden', borderRadius: 'var(--mantine-radius-md)', backgroundColor: SKY, touchAction: 'none' }}>
      <canvas ref={canvasRef} data-testid="galaxy-canvas" data-selected={p.sel ?? ''} data-stars={p.stars.length}
        width={Math.round(size.w * dpr)} height={Math.round(size.h * dpr)} {...camera.handlers}
        style={{ display: 'block', width: size.w, height: size.h, cursor: 'grab' }}
        aria-label="Galaxie des catégories : cliquez sur une étoile pour voir ses voisines" role="img" />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {cards.map((id) => (
          <div key={id} data-testid="galaxy-card" data-category={id}
            ref={(el) => { if (el) cardEls.current.set(id, el); else cardEls.current.delete(id); }}
            onMouseEnter={(e) => raise(e.currentTarget, true, id)}
            onMouseLeave={(e) => raise(e.currentTarget, false, id)}
            onDragEnter={(e) => raise(e.currentTarget, true, id)}
            onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) raise(e.currentTarget, false, id); }}
            onDrop={(e) => raise(e.currentTarget, false, id)}
            style={{
              position: 'absolute', left: 0, top: 0, width: id === p.sel ? SELECTED_CARD_PX : CARD_PX, visibility: 'hidden', pointerEvents: 'auto',
              zIndex: id === p.sel ? 2 : 1, willChange: 'transform', borderRadius: 'var(--mantine-radius-md)',
              boxShadow: id === p.sel ? '0 0 0 2px var(--sk-accent), 0 10px 30px #000a' : '0 8px 24px #0008',
            }}>
            {p.renderCard(id, id === p.sel)}
          </div>
        ))}
      </div>
      <div ref={legendRef} data-testid="galaxy-legend" style={{ position: 'absolute', right: 10, bottom: 10, maxWidth: 'calc(100% - 20px)', transition: 'opacity .3s' }}>
        {p.legend}
      </div>
      {!narrow && (
        <div ref={toolbarRef} data-testid="galaxy-toolbar" style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 5 }}>
          {p.toolbar}
        </div>
      )}
    </Box>
    </>
  );
}

/** Légende : teintes des disciplines, anneau, règles actives dans l'ordre avec leur couleur de lien. Repliable. */
function GalaxyLegend({ hues, rules }: { hues: { key: string; color: string; label: string }[]; rules: { rule: string; label: string; color: string }[] }) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 600);
  const muted = '#9aa3bd';
  return (
    <Box style={{ background: '#0e1119ee', border: '1px solid #262b3a', borderRadius: 8, padding: '6px 10px', color: '#d5dae8', fontSize: 12, maxWidth: 420 }}>
      <UnstyledButton onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="galaxy-legend-toggle" style={{ color: muted, fontSize: 12, fontWeight: 600 }}>
        Légende {open ? '▾' : '▸'}
      </UnstyledButton>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
            {hues.map((h) => (
              <span key={h.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 9, height: 9, borderRadius: '50%', background: h.color, display: 'inline-block' }} />{h.label}
              </span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <i style={{ width: 9, height: 9, borderRadius: '50%', border: '2px solid #fff', display: 'inline-block' }} />un seul combattant (anneau qui pulse)
            </span>
          </div>
          {rules.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: muted }}>Liens, du plus proche au plus loin :</span>
              {rules.map((r) => (
                <span key={r.rule} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <i style={{ width: 18, height: 3, borderRadius: 2, background: r.color, display: 'inline-block', flexShrink: 0 }} />{r.label}
                </span>
              ))}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <i style={{ width: 18, height: 0, borderTop: '3px dashed #ff3b3b', display: 'inline-block', flexShrink: 0 }} />au-delà de la coupure
              </span>
            </div>
          )}
        </div>
      )}
    </Box>
  );
}
