import { useCallback, useEffect, useState } from 'react';
import { COMPETITION_TABS } from './tabs.js';

/**
 * Poste de ce navigateur pour une compétition (gardé dans le navigateur) : il simplifie l'écran, il ne protège rien
 * (la protection vient du Wi-Fi fermé, ou des comptes en ligne).
 */
export type Poste = { kind: 'organisation' } | { kind: 'table' } | { kind: 'zone'; zoneId: string };

const TABLE_TABS = new Set(['inscriptions', 'clubs', 'pesee', 'reaffectation', 'tableaux', 'combats', 'podiums']);
const ZONE_TABS = new Set(['combats', 'tableaux']);

export function posteTabs(p: Poste): string[] {
  const all = COMPETITION_TABS.map((t) => t.path as string);
  if (p.kind === 'table') return all.filter((t) => TABLE_TABS.has(t));
  if (p.kind === 'zone') return all.filter((t) => ZONE_TABS.has(t));
  return all;
}

export const defaultTab = (p: Poste) => (p.kind === 'zone' ? 'combats' : p.kind === 'table' ? 'inscriptions' : 'reglages');
/** L'onglet demandé s'il est permis à ce poste, sinon son onglet par défaut. */
export const tabFor = (p: Poste, current: string) => (posteTabs(p).includes(current) ? current : defaultTab(p));

export function parsePoste(raw: string | null): Poste {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<Poste> & { zoneId?: unknown };
    if (v?.kind === 'table') return { kind: 'table' };
    if (v?.kind === 'zone' && typeof v.zoneId === 'string' && v.zoneId) return { kind: 'zone', zoneId: v.zoneId };
  } catch {
    /* illisible : poste par défaut */
  }
  return { kind: 'organisation' };
}

const key = (competitionId: string) => `poste:${competitionId}`;
const read = (competitionId: string) => {
  try {
    return parsePoste(localStorage.getItem(key(competitionId)));
  } catch {
    return parsePoste(null);
  }
};

/** Poste de ce navigateur pour la compétition, et son changement (partagé entre les onglets du navigateur). */
export function usePoste(competitionId: string): [Poste, (p: Poste) => void] {
  const [poste, setPoste] = useState<Poste>(() => read(competitionId));
  useEffect(() => {
    setPoste(read(competitionId));
    const reload = () => setPoste(read(competitionId));
    const onStorage = (e: StorageEvent) => e.key === key(competitionId) && reload();
    window.addEventListener('storage', onStorage);
    window.addEventListener('poste-change', reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('poste-change', reload);
    };
  }, [competitionId]);
  const change = useCallback(
    (p: Poste) => {
      try {
        localStorage.setItem(key(competitionId), JSON.stringify(p));
      } catch {
        /* navigateur sans stockage : le choix vaut pour cette page seulement */
      }
      setPoste(p);
      window.dispatchEvent(new Event('poste-change'));
    },
    [competitionId],
  );
  return [poste, change];
}
