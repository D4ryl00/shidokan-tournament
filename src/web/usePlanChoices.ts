import { useCallback, useState } from 'react';
import type { PlanChoice } from './api.js';

const keyOf = (competitionId: string, waveId: string | null) => `plan-choices:${competitionId}:${waveId ?? ''}`;

const isChoice = (c: unknown): c is PlanChoice => {
  if (typeof c !== 'object' || c === null) return false;
  const x = c as Record<string, unknown>;
  if (x.kind === 'validate') return typeof x.proposalId === 'string' && typeof x.caseId === 'string';
  if (x.kind === 'manual') return typeof x.registrationId === 'string' && typeof x.categoryId === 'string';
  if (x.kind === 'refuse') {
    return typeof x.proposalId === 'string' && typeof x.registrationId === 'string' && typeof x.reason === 'string'
      && (x.fromCategoryId === undefined || x.fromCategoryId === null || typeof x.fromCategoryId === 'string');
  }
  return false;
};

/** Choix gardés sur le poste ; stockage absent ou bloqué (navigation privée…) : aucun choix. */
function read(key: string): PlanChoice[] {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isChoice) : [];
  } catch {
    return [];
  }
}

function write(key: string, choices: PlanChoice[]): void {
  try {
    if (choices.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(choices));
  } catch {
    // Stockage indisponible : les choix vivent seulement dans la page.
  }
}

/** Oublie les choix du plan et la coche d'une session (`null` : sans sessions) sur ce poste, après « Repartir de zéro ». */
export function clearPlanChoices(competitionId: string, waveId: string | null): void {
  try {
    sessionStorage.removeItem(keyOf(competitionId, waveId));
    sessionStorage.removeItem(`plan-card-decisions:${competitionId}:${waveId ?? ''}`);
  } catch {
    // Stockage indisponible : rien à oublier.
  }
}

/**
 * Coche « Tenir compte des décisions prises sur les cartes » de la session, gardée sur le poste (cochée par défaut, et si le
 * stockage est absent ou bloqué).
 */
export function usePlanCardDecisions(competitionId: string, waveId: string | null): [boolean, (v: boolean) => void] {
  const key = `plan-card-decisions:${competitionId}:${waveId ?? ''}`;
  const readFlag = () => {
    try {
      return sessionStorage.getItem(key) !== 'false';
    } catch {
      return true;
    }
  };
  const [store, setStore] = useState(() => ({ key, on: readFlag() }));
  let current = store;
  if (store.key !== key) {
    current = { key, on: readFlag() };
    setStore(current);
  }
  const set = useCallback((on: boolean) => {
    try {
      if (on) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, 'false');
    } catch {
      // Stockage indisponible : la coche vit seulement dans la page.
    }
    setStore({ key, on });
  }, [key]);
  return [current.on, set];
}

/**
 * Épingles (« Valider »), choix (« Modifier ») et refus du plan d'ensemble de la session : ils vivent dans la page jusqu'à
 * l'application, gardés en `sessionStorage` du poste (une clé par compétition et par session).
 */
export function usePlanChoices(competitionId: string, waveId: string | null): [PlanChoice[], (c: PlanChoice[]) => void] {
  const key = keyOf(competitionId, waveId);
  const [store, setStore] = useState(() => ({ key, choices: read(key) }));
  let current = store;
  if (store.key !== key) {
    // Autre session (ou compétition) : ses propres choix.
    current = { key, choices: read(key) };
    setStore(current);
  }
  const set = useCallback((choices: PlanChoice[]) => {
    write(key, choices);
    setStore({ key, choices });
  }, [key]);
  return [current.choices, set];
}
