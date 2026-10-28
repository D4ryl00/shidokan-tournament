import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface Highlight {
  hovered: string | null;
  pinned: string | null;
  hover: (name: string | null) => void;
  toggle: (name: string) => void;
}

const HighlightContext = createContext<Highlight | null>(null);

/**
 * Mise en valeur d'un combattant dans un aperçu : le nom survolé s'allume partout où il apparaît (d'où il vient, où il va) ;
 * cliqué, il reste allumé jusqu'à un nouveau clic sur lui ou ailleurs. Les combattants sont reconnus à leur nom (« NOM Prénom »),
 * le seul que donnent les tableaux de l'aperçu.
 */
export function FighterHighlight({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    if (pinned === null) return;
    // Un clic ailleurs que sur un nom éteint la mise en valeur gardée.
    const off = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-fighter]')) setPinned(null);
    };
    document.addEventListener('click', off);
    return () => document.removeEventListener('click', off);
  }, [pinned]);
  const value: Highlight = { hovered, pinned, hover: setHovered, toggle: (name) => setPinned((p) => (p === name ? null : name)) };
  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

/** Dans un `FighterHighlight` existant, sinon dans le sien. */
export function WithFighterHighlight({ children }: { children: ReactNode }) {
  return useContext(HighlightContext) ? <>{children}</> : <FighterHighlight>{children}</FighterHighlight>;
}

/** Ce combattant est-il mis en valeur (survolé ou gardé) ? */
export function useFighterActive(): (name: string) => boolean {
  const h = useContext(HighlightContext);
  return (name) => h !== null && (h.hovered === name || h.pinned === name);
}

/** Nom d'un combattant : survol et clic (ou Entrée, Espace) le mettent en valeur partout dans l'aperçu. */
export function FighterName({ name, bold = false }: { name: string; bold?: boolean }) {
  const h = useContext(HighlightContext);
  const active = useFighterActive()(name);
  const pinned = h?.pinned === name;
  if (!h) return bold ? <b>{name}</b> : <>{name}</>;
  return (
    <span role="button" tabIndex={0} data-fighter={name} data-active={active || undefined} aria-pressed={pinned}
      title={pinned ? 'Cliquer pour ne plus le mettre en valeur' : 'Cliquer pour le garder en valeur'}
      onMouseEnter={() => h.hover(name)} onMouseLeave={() => h.hover(null)} onFocus={() => h.hover(name)} onBlur={() => h.hover(null)}
      onClick={() => h.toggle(name)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        h.toggle(name);
      }}
      style={{
        // Pas de gras au survol : le texte ne bouge pas.
        cursor: 'pointer', borderRadius: 4, padding: '0 3px', margin: '0 -3px', fontWeight: bold ? 700 : undefined,
        // Accent plein (texte ≥ 4,5:1 dans les deux thèmes) : se repère d'un coup d'œil ; gardé, un anneau intérieur en plus
        // (à l'intérieur : il ne cache pas les « · » et « → » voisins).
        background: active ? 'var(--sk-accent)' : undefined, color: active ? 'var(--sk-on-accent)' : undefined,
        boxShadow: pinned ? 'inset 0 0 0 2px var(--sk-on-accent)' : undefined,
      }}>
      {name}
    </span>
  );
}
