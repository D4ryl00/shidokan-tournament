import { useCallback, useState } from 'react';
import type { PublicCompetition } from '../domain/public/types.js';

/** Suivis gardés sur ce téléphone : combattants épinglés et clubs suivis en entier. */
export type Pins = { fighters: string[]; clubs: string[] };

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

/** `window.localStorage`, ou null s'il est absent ou refusé (navigation privée, données bloquées). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const key = (competitionId: string) => `spectateur:${competitionId}`;
const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []);

/** Lit les suivis d'une compétition ; stockage absent, refusé ou valeur invalide : rien de suivi. */
export function readPins(competitionId: string, storage: ReadStorage | null = browserStorage()): Pins {
  try {
    const raw = storage?.getItem(key(competitionId));
    if (!raw) return { fighters: [], clubs: [] };
    const v: unknown = JSON.parse(raw);
    const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
    return { fighters: strings(o.fighters), clubs: strings(o.clubs) };
  } catch {
    return { fighters: [], clubs: [] };
  }
}

/** Garde les suivis ; sans stockage ou s'il refuse, ils ne durent que le temps de la page. */
export function writePins(competitionId: string, pins: Pins, storage: WriteStorage | null = browserStorage()): void {
  try {
    storage?.setItem(key(competitionId), JSON.stringify(pins));
  } catch {
    /* ignoré : les suivis restent à l'écran */
  }
}

/** Suivis d'une compétition, relus au changement de compétition et gardés à chaque modification. */
export function usePins(competitionId: string): [Pins, (next: Pins) => void] {
  const [state, setState] = useState(() => ({ id: competitionId, pins: readPins(competitionId) }));
  let pins = state.pins;
  if (state.id !== competitionId) {
    pins = readPins(competitionId);
    setState({ id: competitionId, pins });
  }
  const update = useCallback((next: Pins) => {
    writePins(competitionId, next);
    setState({ id: competitionId, pins: next });
  }, [competitionId]);
  return [pins, update];
}

/** Combattants suivis : les épinglés, plus tous les combattants non masqués des clubs suivis, sans doublon. */
export function followedFighters(pub: PublicCompetition, pins: Pins): string[] {
  const out = new Set(pins.fighters);
  const clubs = new Set(pins.clubs);
  for (const e of Object.values(pub.entrants)) {
    if (!e.hidden && e.fighterId !== null && e.clubId !== null && clubs.has(e.clubId)) out.add(e.fighterId);
  }
  return [...out];
}
