import { Box, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { FORBIDDEN_COLOR } from './scene.js';

const LEGEND_KEY = 'galaxie-legende';

/** Légende : teintes des disciplines, anneau, règles actives dans l'ordre avec leur couleur de lien. Repliable. */
export function GalaxyLegend({ hues, rules }: { hues: { key: string; color: string; label: string }[]; rules: { rule: string; label: string; color: string }[] }) {
  // Repliée par défaut (elle cache des étoiles) ; ouverte ou non, retenu sur le poste.
  const [open, setOpenState] = useState(() => {
    try { return localStorage.getItem(LEGEND_KEY) === 'ouverte'; } catch { return false; }
  });
  const setOpen = (f: (o: boolean) => boolean) => setOpenState((o) => {
    const next = f(o);
    try { localStorage.setItem(LEGEND_KEY, next ? 'ouverte' : 'repliee'); } catch { /* stockage indisponible : vaut pour cette visite */ }
    return next;
  });
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
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <i style={{ width: 18, height: 0, borderTop: `2px dotted ${FORBIDDEN_COLOR}`, display: 'inline-block', flexShrink: 0 }} />interdit par les réglages (déplacement à la main, avec confirmation)
              </span>
            </div>
          )}
        </div>
      )}
    </Box>
  );
}
