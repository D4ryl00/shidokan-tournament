import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import type { Wave } from '../domain/waves.js';
import { useWaves } from './api.js';

/**
 * Vague choisie (adresse `?session=`) ; à défaut ou si elle n'existe plus : la première dont la pesée n'est pas clôturée
 * (`weighIn`, Pesée et Recasement) ou celle que donne `prefer` (`undefined` : pas encore connue) ; sinon la première.
 * Écrite dans l'adresse ; null sans vague.
 */
/** Session choisie dans l'adresse : `?session=`, ou `?vague=` des anciens liens (onglets renommés le 2026-10-23). */
export function sessionParam(params: URLSearchParams): string | null {
  return params.get('session') ?? params.get('vague');
}

export function useSelectedWave(id: string, prefer: 'weighIn' | ((waves: Wave[]) => string | null | undefined) = 'weighIn') {
  const { data: waves = [], isSuccess } = useWaves(id);
  const [params, setParams] = useSearchParams();
  const asked = sessionParam(params);
  const askedId = waves.find((w) => w.id === asked)?.id;
  const preferred = typeof prefer === 'function' ? prefer(waves) : (waves.find((w) => !w.weighInClosed)?.id ?? null);
  const known = askedId !== undefined || preferred !== undefined || waves.length === 0;
  const waveId = askedId ?? (preferred === undefined ? null : (preferred ?? waves[0]?.id ?? null));
  const select = (v: string) => setParams((p) => { p.delete('vague'); p.set('session', v); return p; }, { replace: true });
  useEffect(() => {
    // Un ancien lien (`?vague=`) est réécrit en `?session=`.
    if (known && waveId && (asked !== waveId || params.has('vague'))) select(waveId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveId, asked, known]);
  return { waves, waveId, select, ready: isSuccess && known };
}
