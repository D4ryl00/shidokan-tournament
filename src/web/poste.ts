import { useCallback, useEffect, useState } from 'react';
import { useAuthMe, useZoneLink, type AuthMe, type ZoneLinkView } from './api.js';
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
/** L'onglet demandé s'il est permis à ce poste, sinon son onglet par défaut (une adresse qui n'est pas un onglet n'est pas touchée). */
export const tabFor = (p: Poste, current: string) =>
  !COMPETITION_TABS.some((t) => t.path === current) || posteTabs(p).includes(current) ? current : defaultTab(p);

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

/**
 * Poste imposé par le compte connecté (rôle serveur) : Table centrale, ou la zone d'un compte Zone (sans zone hors de sa compétition :
 * rien n'y est permis). Null : organisateur, ou rôle local (le navigateur choisit son poste).
 */
export function accountPoste(me: AuthMe | undefined, competitionId: string): Poste | null {
  const user = me?.user;
  if (!user || user.role === 'organisateur') return null;
  if (user.role === 'table') return { kind: 'table' };
  return { kind: 'zone', zoneId: user.competitionId === competitionId ? (user.zoneId ?? '') : '' };
}

/** Portable de zone en zone autonome : sa zone est imposée sur la compétition qu'il suit (le reste est en lecture seule). */
export function zoneLinkPoste(link: ZoneLinkView['link'] | undefined, competitionId: string): Poste | null {
  return link?.autonomous && link.competitionId === competitionId ? { kind: 'zone', zoneId: link.zoneId } : null;
}

const key = (competitionId: string) => `poste:${competitionId}`;
const read = (competitionId: string) => {
  try {
    return parsePoste(localStorage.getItem(key(competitionId)));
  } catch {
    return parsePoste(null);
  }
};

/**
 * Poste de ce navigateur pour la compétition, et son changement (partagé entre les onglets du navigateur) ; le troisième élément
 * est vrai quand le poste est imposé par le compte connecté ou par la zone autonome (il ne se change pas).
 */
export function usePoste(competitionId: string): [Poste, (p: Poste) => void, boolean] {
  const me = useAuthMe().data;
  const { data: zoneLink } = useZoneLink(me?.role === 'local');
  const imposed = accountPoste(me, competitionId) ?? zoneLinkPoste(zoneLink?.link, competitionId);
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
  return imposed ? [imposed, () => {}, true] : [poste, change, false];
}
