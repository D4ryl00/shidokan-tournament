import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import type { Wave } from '../domain/waves.js';
import { useWaves } from './api.js';

/**
 * Vague choisie (adresse `?vague=`) ; à défaut ou si elle n'existe plus : la première dont la pesée n'est pas clôturée
 * (`weighIn`, Pesée et Recasement) ou celle que donne `prefer` (`undefined` : pas encore connue) ; sinon la première.
 * Écrite dans l'adresse ; null sans vague.
 */
export function useSelectedWave(id: string, prefer: 'weighIn' | ((waves: Wave[]) => string | null | undefined) = 'weighIn') {
  const { data: waves = [], isSuccess } = useWaves(id);
  const [params, setParams] = useSearchParams();
  const asked = params.get('vague');
  const askedId = waves.find((w) => w.id === asked)?.id;
  const preferred = typeof prefer === 'function' ? prefer(waves) : (waves.find((w) => !w.weighInClosed)?.id ?? null);
  const known = askedId !== undefined || preferred !== undefined || waves.length === 0;
  const waveId = askedId ?? (preferred === undefined ? null : (preferred ?? waves[0]?.id ?? null));
  const select = (v: string) => setParams((p) => { p.set('vague', v); return p; }, { replace: true });
  useEffect(() => {
    if (known && waveId && asked !== waveId) select(waveId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveId, asked, known]);
  return { waves, waveId, select, ready: isSuccess && known };
}
