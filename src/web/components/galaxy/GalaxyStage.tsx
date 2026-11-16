import { Box } from '@mantine/core';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Point } from '../../../domain/galaxy/layout.js';
import type { GalaxyLink } from '../../../domain/galaxy/links.js';
import { drawGalaxy, fitCamera, SKY, starAt, toScreen, type Star } from './drawGalaxy.js';
import { cardScale, displayedPositions, pullFactor, slotLayout, type Camera, type SlotLayout } from './scene.js';
import { K_MIN, useGalaxyCamera } from './useGalaxyCamera.js';

// Le canevas de la galaxie, les cartes posées dessus, la barre d'outils et la légende (spec étape 48, §3 et §4).

const NO_OVERLAY: ReadonlySet<string> = new Set();
/** Largeur des cartes posées sur le canevas (celle de la sélection, un peu plus large). */
export const CARD_PX = 220;
export const SELECTED_CARD_PX = 240;
/** En dessous de cette largeur (téléphone) : barre au-dessus du canevas, cartes jusqu'à 0,6. */
export const NARROW_PX = 600;
/**
 * Téléphone : bande de page laissée au-dessus du canevas quand la page défile jusqu'à lui. Le canevas prend le doigt
 * (déplacement de la galaxie) ; cette bande permet de faire défiler la page pour revenir à la barre.
 */
export const PHONE_STRIP_PX = 64;
/** Hauteur de la barre collante de l'appli (publiée par CompetitionLayout ; elle passe sur plusieurs lignes au téléphone). */
const appBarHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sk-bar-h')) || 0;

export function GalaxyStage(p: {
  toolbar: ReactNode;
  stars: Star[]; base: Map<string, Point>; links: GalaxyLink[]; sel: string | null; neighborIds: string[];
  matched: ReadonlySet<string> | null; allLinks: boolean;
  linkStyle: (l: GalaxyLink, fromId: string) => { color: string; dashed: boolean };
  linkFrom: (l: GalaxyLink) => string;
  linkLabel: (l: GalaxyLink, fromId: string) => string;
  /** Liens interdits par les réglages, entre étoiles dessinées (étape 49). */
  forbidden: GalaxyLink[];
  forbiddenLabel: (l: GalaxyLink, fromId: string) => string;
  fitIds: string[]; fitKey: string;
  onSelect: (id: string | null) => void; chipSelected: boolean; onCancelChip: () => void;
  renderCard: (id: string, selected: boolean) => ReactNode; legend: ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Bureau : la barre flotte sur le haut du canevas (comme la maquette) ; sa hauteur est retirée de la place des cartes.
  // Téléphone : elle passe au-dessus du canevas. Toujours le même élément : la barre n'est pas recréée en passant de
  // l'un à l'autre (le champ de recherche garde la main).
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < NARROW_PX);
  const [topInset, setTopInset] = useState(0);
  const scene = useRef(p);
  scene.current = p;
  const inset = useRef(topInset);
  inset.current = topInset;
  const isNarrow = useRef(narrow);
  isNarrow.current = narrow;
  const hover = useRef<string | null>(null);
  // Dernières places affichées et cartes posées : pour savoir sur quelle étoile tombe un clic.
  const shownPos = useRef<Map<string, Point>>(p.base);
  const overlaid = useRef<ReadonlySet<string>>(NO_OVERLAY);

  // Cases des voisines figées par (sélection, voisines, taille) : mesurées quand les cartes changent de taille
  // (ResizeObserver), jamais pendant un glisser (l'indication de dépôt agrandit la carte survolée ; sans cela la carte
  // bougerait sous le pointeur).
  // Les hauteurs mesurées alors servent aussi d'ancre aux cartes : une carte qui grandit pendant un glisser grandit vers
  // le bas, son haut reste sous le pointeur (centrée sur sa hauteur du moment, son titre remonterait et le dépôt
  // tomberait sur une pastille : un échange au lieu d'un déplacement).
  const frozen = useRef<{ key: string; layout: SlotLayout; heights: Map<string, number> } | null>(null);
  const remeasure = useRef(true);
  const dragging = useRef(false);
  const redraw = useRef<() => void>(() => undefined);
  // L'observateur des cartes : créé à la demande (les refs des cartes arrivent avant les effets), retiré au démontage.
  const sizeObserver = useRef<ResizeObserver | null>(null);
  const observer = (): ResizeObserver | null => {
    if (!sizeObserver.current && typeof ResizeObserver !== 'undefined') {
      sizeObserver.current = new ResizeObserver(() => {
        if (dragging.current) return;
        remeasure.current = true;
        redraw.current();
      });
    }
    return sizeObserver.current;
  };
  useEffect(() => {
    // Cartes déjà là (remontage en mode strict) : observées de nouveau.
    const ro = observer();
    for (const el of cardEls.current.values()) ro?.observe(el);
    const start = () => { dragging.current = true; };
    const end = () => { dragging.current = false; remeasure.current = true; redraw.current(); };
    // Ni `dragend` ni `drop` (glisser abandonné hors de la fenêtre, par exemple) : le premier geste suivant, sans bouton
    // tenu, clôt le glisser (pendant un glisser, le bouton reste enfoncé).
    const stray = (e: PointerEvent) => { if (dragging.current && (e.type === 'pointerdown' || e.buttons === 0)) end(); };
    // En capture : les pastilles et les cartes arrêtent la propagation de leurs événements de glisser.
    document.addEventListener('dragstart', start, true);
    document.addEventListener('dragend', end, true);
    document.addEventListener('drop', end, true);
    document.addEventListener('pointerdown', stray, true);
    document.addEventListener('pointermove', stray, true);
    return () => {
      document.removeEventListener('dragstart', start, true);
      document.removeEventListener('dragend', end, true);
      document.removeEventListener('drop', end, true);
      document.removeEventListener('pointerdown', stray, true);
      document.removeEventListener('pointermove', stray, true);
      sizeObserver.current?.disconnect();
      sizeObserver.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Une fonction de ref stable par carte : la carte est observée une fois, à son arrivée.
  const refs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const cardRef = (id: string) => {
    let f = refs.current.get(id);
    if (!f) {
      f = (el) => {
        const old = cardEls.current.get(id);
        if (old && old !== el) { sizeObserver.current?.unobserve(old); cardEls.current.delete(id); }
        if (el) { cardEls.current.set(id, el); observer()?.observe(el); } else refs.current.delete(id);
      };
      refs.current.set(id, f);
    }
    return f;
  };

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
      const phone = window.innerWidth < NARROW_PX;
      // Au téléphone, la barre de l'appli (collante) prend une bonne part de l'écran : le canevas a la hauteur de l'écran
      // sous elle, moins une bande (pour faire défiler la page) ; la page défile jusqu'à lui quand on choisit une étoile.
      const floor = phone ? Math.floor(window.innerHeight - below - appBarHeight() - PHONE_STRIP_PX) : 300;
      const h = Math.max(floor, Math.floor(window.innerHeight - (r.top + window.scrollY) - below));
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
      setNarrow(phone);
      const t = toolbarRef.current;
      setTopInset(t && !phone ? Math.ceil(t.getBoundingClientRect().height) + 16 : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (toolbarRef.current) ro.observe(toolbarRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const draw = (cam: Camera, now: number): boolean => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { w, h } = size;
    if (!canvas || !ctx || w === 0) return false;
    // Densité de l'écran lue à chaque image : la fenêtre peut passer sur un autre écran.
    const dpr = window.devicePixelRatio || 1;
    const [cw, ch] = [Math.round(w * dpr), Math.round(h * dpr)];
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const s = scene.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pull = s.sel ? pullFactor(cam.k) : 0;
    // Cases des voisines : selon la place sous la barre et la taille des cartes (à l'échelle 1), figées (voir plus haut).
    let lay: SlotLayout | null = null;
    let heights: Map<string, number> | null = null;
    if (s.sel) {
      const key = `${s.sel}|${s.neighborIds.join(',')}|${w}|${h}|${inset.current}`;
      const f = frozen.current;
      if (f && f.key === key && (!remeasure.current || dragging.current)) ({ layout: lay, heights } = f);
      else {
        let missing = false;
        const measured = new Map<string, number>();
        const heightOf = (id: string, fallback: number) => {
          const v = cardEls.current.get(id)?.offsetHeight;
          if (!v) missing = true;
          else measured.set(id, v);
          return v || fallback;
        };
        lay = slotLayout({ sel: { w: SELECTED_CARD_PX, h: heightOf(s.sel, 200) }, neighbors: s.neighborIds.map((id) => ({ w: CARD_PX, h: heightOf(id, 180) })) },
          { w, h: h - inset.current }, w < NARROW_PX ? 0.6 : 0.75);
        frozen.current = { key, layout: lay, heights: measured };
        heights = measured;
        remeasure.current = missing;
      }
    }
    const pos = displayedPositions(s.base, s.sel, s.neighborIds, cam, { w, h }, lay?.slots);
    // Cartes posées par-dessus : la sélection et ses voisines rapprochées, à leur place affichée, à l'échelle.
    const show = s.sel !== null && pull > 0.2 && cardScale(cam.k, pull) * CARD_PX >= 70;
    const sc = cardScale(cam.k, pull) * (show && lay ? 1 - pull * (1 - lay.scale) : 1);
    const over: ReadonlySet<string> = show ? new Set([s.sel!, ...s.neighborIds]) : NO_OVERLAY;
    for (const [id, el] of cardEls.current) {
      const q = pos.get(id);
      if (show && q && over.has(id)) {
        const sp = toScreen(q, cam, w, h);
        const h0 = heights?.get(id) ?? el.offsetHeight;
        el.style.transform = `translate(${sp.x}px, ${sp.y}px) scale(${sc}) translate(-50%, ${-h0 / 2}px)`;
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
      matched: s.matched, allLinks: s.allLinks, pull, linkStyle: s.linkStyle, linkFrom: s.linkFrom, linkLabel: s.linkLabel,
      forbidden: s.forbidden, forbiddenLabel: s.forbiddenLabel,
    }, now);
  };

  const hit = (x: number, y: number) => starAt({ stars: scene.current.stars, pos: shownPos.current, overlaid: overlaid.current }, camera.cam.current, size.w, size.h, x, y);
  const camera = useGalaxyCamera({
    canvasRef, wheelRef: outerRef, size, draw,
    // Téléphone : la molette sur la barre (au-dessus du canevas) fait défiler la page, pas la galaxie.
    ignoreWheel: (t) => isNarrow.current && t instanceof Node && (toolbarRef.current?.contains(t) ?? false),
    onTap: (x, y) => {
      // Pendant un clic-clic, un clic à côté des cartes l'annule ; sinon : l'étoile touchée, ou plus de sélection.
      if (scene.current.chipSelected) { scene.current.onCancelChip(); return; }
      const id = hit(x, y);
      // L'étoile déjà choisie (après un dézoom) : on y retourne, comme à la première sélection.
      const q = id !== null && id === scene.current.sel ? scene.current.base.get(id) : undefined;
      if (q) camera.flyTo(q, inset.current / 2);
      else scene.current.onSelect(id);
    },
    onHover: (x, y) => {
      const id = x === null || y === null ? null : hit(x, y);
      // Le curseur suit l'étoile sous le pointeur, même quand elle ne change pas (fin d'un déplacement de la galaxie).
      if (canvasRef.current) canvasRef.current.style.cursor = id ? 'pointer' : 'grab';
      if (id === hover.current) return;
      hover.current = id;
      camera.requestDraw();
    },
  });

  redraw.current = camera.requestDraw;

  // Chaque rendu (données, taille) : une image.
  useEffect(() => { camera.requestDraw(); });

  // La fenêtre change de densité d'écran (passage sur un autre écran, zoom du navigateur) : une image, à la nouvelle
  // densité.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    let mq: MediaQueryList | null = null;
    const onChange = () => { watch(); camera.requestDraw(); };
    const watch = () => {
      mq?.removeEventListener('change', onChange);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', onChange);
    };
    watch();
    return () => mq?.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cadrage : à l'ouverture, au changement de session (qui retire la sélection), avec « Seulement les seuls », et quand
  // la largeur change. Une sélection en cours est gardée (« Seulement les seuls », portée élargie à l'ouverture sur une
  // catégorie, fenêtre redimensionnée). La hauteur seule ne recadre pas : au téléphone, la barre du navigateur qui
  // apparaît ou disparaît en faisant défiler la page la change sans cesse.
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
  }, [p.fitKey, size.w]);

  // Nouvelle sélection : vol jusqu'à elle.
  useEffect(() => {
    hover.current = null;
    const q = p.sel ? scene.current.base.get(p.sel) : undefined;
    if (q && size.w > 0) camera.flyTo(q, inset.current / 2);
    // Téléphone : le canevas commence bas dans la page ; on le fait monter jusque sous la barre de l'appli et la bande,
    // pour que les cartes ne finissent pas sous la barre du navigateur (seulement s'il dépasse de l'écran, ou passe
    // sous la barre de l'appli : pas de saut quand il est déjà en place).
    const el = frameRef.current;
    const r = el?.getBoundingClientRect();
    const bar = appBarHeight();
    if (q && el && r && window.innerWidth < NARROW_PX && (r.top < bar - 1 || r.bottom > window.innerHeight + 1)) {
      el.style.scrollMarginTop = `${bar + PHONE_STRIP_PX}px`;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
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

  const cards = p.sel ? [p.sel, ...p.neighborIds] : [];
  // Au-dessus des autres : la carte sous le pointeur, ou celle que survole un glisser.
  const raise = (el: HTMLElement, on: boolean, id: string) => { el.style.zIndex = on ? '3' : id === p.sel ? '2' : '1'; };
  return (
    <div ref={outerRef} style={{ position: 'relative' }}>
      {/* Bureau : la bande de la barre laisse passer les clics entre ses boutons jusqu'au canevas (classe sk-pass-through). */}
      <div ref={toolbarRef} data-testid="galaxy-toolbar" className={narrow ? undefined : 'sk-pass-through'}
        style={narrow ? { marginBottom: 'var(--mantine-spacing-sm)' } : { position: 'absolute', top: 10, left: 10, right: 10, zIndex: 5 }}>
        {p.toolbar}
      </div>
      <Box ref={frameRef} data-testid="galaxy-frame"
        style={{ position: 'relative', height: size.h || 300, overflow: 'hidden', borderRadius: 'var(--mantine-radius-md)', backgroundColor: SKY, touchAction: 'none' }}>
        <canvas ref={canvasRef} data-testid="galaxy-canvas" data-selected={p.sel ?? ''} data-stars={p.stars.length} data-flying="false"
          {...camera.handlers}
          style={{ display: 'block', width: size.w, height: size.h, cursor: 'grab' }}
          aria-label="Galaxie des catégories : cliquez sur une étoile pour voir ses voisines" role="img" />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {cards.map((id) => (
            <div key={id} data-testid="galaxy-card" data-category={id}
              ref={cardRef(id)}
              onMouseEnter={(e) => raise(e.currentTarget, true, id)}
              onMouseLeave={(e) => raise(e.currentTarget, false, id)}
              onDragEnter={(e) => raise(e.currentTarget, true, id)}
              onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) raise(e.currentTarget, false, id); }}
              onDrop={(e) => raise(e.currentTarget, false, id)}
              style={{
                position: 'absolute', left: 0, top: 0, width: id === p.sel ? SELECTED_CARD_PX : CARD_PX, visibility: 'hidden', pointerEvents: 'auto', transformOrigin: '0 0',
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
      </Box>
    </div>
  );
}
