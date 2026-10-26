import { useCallback, useState } from 'react';
import type { PlanChoice } from './api.js';

const keyOf = (competitionId: string, waveId: string | null) => `plan-choices:${competitionId}:${waveId ?? ''}`;

const isChoice = (c: unknown): c is PlanChoice => {
  if (typeof c !== 'object' || c === null) return false;
  const x = c as Record<string, unknown>;
  if (x.kind === 'validate') return typeof x.proposalId === 'string' && typeof x.caseId === 'string';
  if (x.kind === 'manual') return typeof x.registrationId === 'string' && typeof x.categoryId === 'string';
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

/** Oublie les choix du plan de toutes les sessions de la compétition sur ce poste (après « Repartir de zéro »). */
export function clearPlanChoices(competitionId: string): void {
  try {
    const prefix = `plan-choices:${competitionId}:`;
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).filter((k): k is string => k?.startsWith(prefix) ?? false);
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    // Stockage indisponible : rien à oublier.
  }
}

/**
 * Épingles (« Valider ») et choix (« Modifier ») du plan d'ensemble de la session : ils vivent dans la page jusqu'à
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
